using System.Buffers.Binary;
using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Caching.Memory;
using Npgsql;

namespace Workspace.Api.Accounts.Auth;

internal sealed class AuthPreviewLimits(IMemoryCache cache, string? connectionString = null)
{
    private readonly object gate = new();
    private sealed record Rule(string Key, int Limit, int WindowSeconds);
    private sealed record Window(DateTimeOffset EndsAt, int Count);
    private sealed record Decision(int Limit, int Remaining, DateTimeOffset? RetryAt = null);

    internal Task<IResult?> RejectAsync(HttpContext context, string? action = null, string? username = null,
        string? email = null, string? resetToken = null)
    {
        var ip = ConnectionIp(context);
        var rules = new List<Rule>(3) { new($"preview-limit:auth:{ip}", 60, 60) };
        if (action == "login")
        {
            rules.Add(new($"preview-limit:login:{ip}", 30, 60));
            rules.Add(new($"preview-limit:login-user:{HashLowerAscii(username ?? "")}:{ip}", 5, 60));
        }
        if (action is "check_login_email" or "check_registration_email")
        {
            var login = action == "check_login_email";
            rules.Add(new($"preview-limit:{action}:{ip}", login ? 20 : 30, 60));
            var address = email?.Trim(' ', '\t', '\n', '\r', '\v', '\0');
            if (!string.IsNullOrEmpty(address))
                rules.Add(new($"preview-limit:{action}-address:{HashLowerAscii(address)}", 10, 3600));
        }
        if (action == "validate_corporate_admin_identifier")
            rules.Add(new($"preview-limit:corporate-admin:{ip}", 20, 60));
        if (action == "register")
        {
            rules.Add(new($"preview-limit:register-hour:{ip}", 5, 3600));
            rules.Add(new($"preview-limit:register-day:{ip}", 20, 86400));
        }
        if (action is "send_verification_code" or "verify_email_code")
        {
            var sending = action == "send_verification_code";
            rules.Add(new($"preview-limit:{action}:{ip}", sending ? 20 : 10, sending ? 3600 : 60));
            var address = email?.Trim(' ', '\t', '\n', '\r', '\v', '\0');
            if (!string.IsNullOrEmpty(address))
            {
                var hash = HashLowerAscii(address);
                if (sending) rules.Add(new($"preview-limit:email-code-cooldown:{hash}", 1, 60));
                rules.Add(new($"preview-limit:{action}-address:{hash}", 10, 3600));
            }
        }
        if (action == "request_password_reset")
        {
            rules.Add(new($"preview-limit:password-reset-ip:{ip}", 10, 3600));
            var address = email?.Trim(' ', '\t', '\n', '\r', '\v', '\0');
            if (!string.IsNullOrEmpty(address))
            {
                var hash = HashLowerAscii(address);
                rules.Add(new($"preview-limit:password-reset-cooldown:{hash}", 1, 60));
                rules.Add(new($"preview-limit:password-reset-address:{hash}", 5, 3600));
            }
        }
        if (action == "reset_password")
        {
            rules.Add(new($"preview-limit:password-reset-submit-ip:{ip}", 10, 60));
            if (resetToken is not null)
                rules.Add(new($"preview-limit:password-reset-submit-token:{PasswordRecovery.Hash(resetToken)}", 10, 3600));
        }

        return ApplyAsync(context, rules);
    }

    internal Task<IResult?> RejectProfileAsync(HttpContext context, long userId, bool write) => ApplyAsync(context,
    [
        new($"preview-limit:profile:{ConnectionIp(context)}", 60, 60),
        new($"preview-limit:profile-{(write ? "write" : "read")}:{Number(userId)}", write ? 30 : 60, 60),
    ]);

    internal Task<IResult?> RejectProfilePasswordAsync(HttpContext context, long userId) =>
        ApplyAsync(context, [new($"preview-limit:profile-password:{Number(userId)}", 5, 60)], reportLimitHeaders: false);

    internal Task<IResult?> RejectWorkspaceAsync(HttpContext context, long userId, bool write = false, bool invite = false)
    {
        var rules = new List<Rule>(3)
        {
            new($"preview-limit:workspace:{ConnectionIp(context)}", 300, 60),
            new($"preview-limit:workspace-{(write ? "write" : "read")}:{Number(userId)}", write ? 90 : 120, 60),
        };
        if (invite) rules.Add(new($"preview-limit:workspace-invite:{Number(userId)}", 20, 3600));
        return ApplyAsync(context, rules);
    }

    private async Task<IResult?> ApplyAsync(HttpContext context, IReadOnlyList<Rule> rules, bool reportLimitHeaders = true)
    {
        var (decision, now) = connectionString is null
            ? ReserveInMemory(rules)
            : await ReserveInPostgres(rules, context.RequestAborted);
        if (reportLimitHeaders) SetHeaders(context, decision.Limit, decision.Remaining);
        if (decision.RetryAt is not { } retryAt) return null;

        var retryAfter = (int)Math.Ceiling((retryAt - now).TotalSeconds);
        context.Response.Headers.RetryAfter = Number(retryAfter);
        if (reportLimitHeaders)
            context.Response.Headers["X-RateLimit-Reset"] = Number(now.ToUnixTimeSeconds() + retryAfter);
        return Results.Json(new { success = false, error = "Слишком много запросов. Попробуйте позже." }, statusCode: 429);
    }

    private (Decision, DateTimeOffset) ReserveInMemory(IReadOnlyList<Rule> rules)
    {
        lock (gate)
        {
            var now = DateTimeOffset.UtcNow;
            var windows = rules.Select(rule => cache.TryGetValue<Window>(rule.Key, out var window) ? window : null).ToArray();
            var decision = Reserve(rules, windows, now);
            if (decision.RetryAt is null)
                for (var i = 0; i < rules.Count; i++)
                    cache.Set(rules[i].Key, windows[i]!, windows[i]!.EndsAt);
            return (decision, now);
        }
    }

    private async Task<(Decision, DateTimeOffset)> ReserveInPostgres(IReadOnlyList<Rule> rules, CancellationToken cancellation)
    {
        var hashes = rules.Select(rule => SHA256.HashData(Encoding.UTF8.GetBytes(rule.Key))).ToArray();
        var keys = hashes.Select(hash => Convert.ToHexStringLower(hash)).ToArray();
        var windows = new Window?[keys.Length];
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(cancellation);
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellation);
        await using var read = new NpgsqlBatch(connection, transaction) { Timeout = 5 };
        // Negative bigint advisory locks keep this namespace separate from positive list IDs.
        // Every request acquires its complete set in database-independent order.
        foreach (var id in hashes.Select(hash => BinaryPrimitives.ReadInt64BigEndian(hash) | long.MinValue).Distinct().Order())
        {
            var take = new NpgsqlBatchCommand("SELECT pg_advisory_xact_lock(@id)");
            take.Parameters.AddWithValue("id", id);
            read.BatchCommands.Add(take);
        }
        var load = new NpgsqlBatchCommand(ReadSql);
        load.Parameters.AddWithValue("keys", keys);
        read.BatchCommands.Add(load);

        DateTimeOffset now = default;
        await using (var rows = await read.ExecuteReaderAsync(cancellation))
        {
            for (var i = 0; i < read.BatchCommands.Count - 1; i++)
                await rows.NextResultAsync(cancellation);
            while (await rows.ReadAsync(cancellation))
            {
                var index = (int)rows.GetInt64(0) - 1;
                now = rows.GetFieldValue<DateTime>(1);
                if (!rows.IsDBNull(2))
                    windows[index] = new Window(rows.GetFieldValue<DateTime>(3), rows.GetInt32(2));
            }
        }

        var decision = Reserve(rules, windows, now);
        if (decision.RetryAt is null)
        {
            await using var write = new NpgsqlCommand(WriteSql, connection, transaction);
            write.Parameters.AddWithValue("keys", keys);
            write.Parameters.AddWithValue("counts", windows.Select(window => window!.Count).ToArray());
            write.Parameters.AddWithValue("ends", windows.Select(window => window!.EndsAt.UtcDateTime).ToArray());
            await write.ExecuteNonQueryAsync(cancellation);
            await transaction.CommitAsync(cancellation);
        }
        return (decision, now);
    }

    private static Decision Reserve(IReadOnlyList<Rule> rules, Window?[] windows, DateTimeOffset now)
    {
        // Evaluate all limits before consuming any allowance.
        for (var index = 0; index < rules.Count; index++)
        {
            var rule = rules[index];
            var window = windows[index];
            if (window is null || window.EndsAt <= now)
                windows[index] = new Window(now.AddSeconds(rule.WindowSeconds), 0);
            else if (window.Count >= rule.Limit)
                return new Decision(rule.Limit, 0, window.EndsAt);
        }

        var remaining = int.MaxValue;
        var limit = rules[0].Limit;
        for (var index = 0; index < rules.Count; index++)
        {
            var rule = rules[index];
            var window = windows[index]!;
            windows[index] = window with { Count = window.Count + 1 };
            var available = rule.Limit - window.Count - 1;
            if (available >= remaining) continue;
            remaining = available;
            limit = rule.Limit;
        }
        return new Decision(limit, remaining);
    }

    private const string ReadSql = """
        WITH snapshot_clock AS MATERIALIZED (SELECT clock_timestamp() AS utc_now)
        SELECT requested.ordinality, snapshot_clock.utc_now, stored.request_count, stored.expires_at
        FROM unnest(@keys) WITH ORDINALITY AS requested(key, ordinality)
        CROSS JOIN snapshot_clock
        LEFT JOIN public.todo_inn_auth_rate_limits stored ON stored.bucket_key = requested.key
        """;

    private const string WriteSql = """
        INSERT INTO public.todo_inn_auth_rate_limits (bucket_key, request_count, expires_at)
        SELECT key, count, expires FROM unnest(@keys, @counts, @ends) AS next(key, count, expires)
        ON CONFLICT (bucket_key) DO UPDATE SET
            request_count = EXCLUDED.request_count, expires_at = EXCLUDED.expires_at
        """;

    private static string ConnectionIp(HttpContext context)
    {
        var remote = context.Connection.RemoteIpAddress!;
        return (remote.IsIPv4MappedToIPv6 ? remote.MapToIPv4() : remote).ToString();
    }

    private static string HashLowerAscii(string value)
    {
        // PHP strtolower folds ASCII only and does not trim login usernames.
        var normalized = string.Create(value.Length, value, static (destination, source) =>
        {
            for (var index = 0; index < source.Length; index++)
                destination[index] = char.IsAsciiLetterUpper(source[index]) ? (char)(source[index] + ('a' - 'A')) : source[index];
        });
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(normalized)));
    }

    private static string Number(long value) => value.ToString(CultureInfo.InvariantCulture);

    private static void SetHeaders(HttpContext context, int limit, int remaining)
    {
        context.Response.Headers["X-RateLimit-Limit"] = Number(limit);
        context.Response.Headers["X-RateLimit-Remaining"] = Number(remaining);
    }
}
