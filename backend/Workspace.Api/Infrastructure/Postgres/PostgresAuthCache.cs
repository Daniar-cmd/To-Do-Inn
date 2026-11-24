using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Caching.Distributed;
using Npgsql;
using NpgsqlTypes;

namespace Workspace.Api.Infrastructure.Postgres;

internal sealed class PostgresAuthCache(IConfiguration configuration, IDataProtectionProvider keys) : IDistributedCache
{
    private readonly IDataProtector protector = keys.CreateProtector("ToDoInn.AuthCache.v1");
    private string ConnectionString => configuration.GetConnectionString("Workspace")!;

    public byte[]? Get(string key) => GetAsync(key).GetAwaiter().GetResult();
    public void Set(string key, byte[] value, DistributedCacheEntryOptions options) =>
        SetAsync(key, value, options).GetAwaiter().GetResult();
    public void Refresh(string key) => RefreshAsync(key).GetAwaiter().GetResult();
    public void Remove(string key) => RemoveAsync(key).GetAwaiter().GetResult();

    public async Task<byte[]?> GetAsync(string key, CancellationToken token = default)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync(token);
        return await Read(key, connection, null, token);
    }

    internal Task<byte[]?> GetAsync(string key, NpgsqlTransaction transaction, CancellationToken token) =>
        Read(key, transaction.Connection!, transaction, token);

    private async Task<byte[]?> Read(string key, NpgsqlConnection connection, NpgsqlTransaction? transaction, CancellationToken token)
    {
        await using var command = new NpgsqlCommand(GetSql, connection, transaction);
        command.Parameters.AddWithValue("key", key);
        return await command.ExecuteScalarAsync(token) is byte[] data ? protector.CreateProtector(key).Unprotect(data) : null;
    }

    public async Task SetAsync(string key, byte[] value, DistributedCacheEntryOptions options, CancellationToken token = default)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync(token);
        await Write(key, value, options, connection, null, token);
    }

    internal Task SetAsync(string key, byte[] value, DateTimeOffset expiresAt, NpgsqlTransaction transaction, CancellationToken token) =>
        Write(key, value, new DistributedCacheEntryOptions { AbsoluteExpiration = expiresAt }, transaction.Connection!, transaction, token);

    private async Task Write(string key, byte[] value, DistributedCacheEntryOptions options, NpgsqlConnection connection,
        NpgsqlTransaction? transaction, CancellationToken token)
    {
        var now = DateTimeOffset.UtcNow;
        var absolute = options.AbsoluteExpiration;
        if (options.AbsoluteExpirationRelativeToNow is TimeSpan relative)
            absolute = now.Add(relative);
        if (absolute is { } deadline && deadline <= now)
            throw new ArgumentOutOfRangeException(nameof(options), "The absolute cache expiration must be in the future.");

        await using var command = new NpgsqlCommand(SetSql, connection, transaction);
        command.Parameters.AddWithValue("key", key);
        command.Parameters.AddWithValue("data", protector.CreateProtector(key).Protect(value));
        command.Parameters.Add("absolute", NpgsqlDbType.TimestampTz).Value = (object?)absolute?.UtcDateTime ?? DBNull.Value;
        command.Parameters.Add("sliding", NpgsqlDbType.Double).Value = (object?)options.SlidingExpiration?.TotalSeconds ?? DBNull.Value;
        await command.ExecuteNonQueryAsync(token);
    }

    public Task RefreshAsync(string key, CancellationToken token = default) => ExecuteForKey(RefreshSql, key, token);

    public Task RemoveAsync(string key, CancellationToken token = default) => ExecuteForKey(DeleteSql, key, token);

    internal async Task<bool> ConsumeAsync(string key, NpgsqlTransaction transaction, CancellationToken token)
    {
        await using var command = new NpgsqlCommand(DeleteSql + " AND expires_at > statement_timestamp()",
            transaction.Connection!, transaction);
        command.Parameters.AddWithValue("key", key);
        return await command.ExecuteNonQueryAsync(token) == 1;
    }

    internal async Task RemoveAsync(string key, NpgsqlTransaction transaction, CancellationToken token)
    {
        await using var command = new NpgsqlCommand(DeleteSql, transaction.Connection!, transaction);
        command.Parameters.AddWithValue("key", key);
        await command.ExecuteNonQueryAsync(token);
    }

    private const string DeleteSql = "DELETE FROM public.todo_inn_auth_sessions WHERE cache_key = @key";

    internal async Task<int> DeleteExpired(CancellationToken token)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync(token);
        await using var command = new NpgsqlCommand("""
            DELETE FROM public.todo_inn_auth_sessions WHERE cache_key IN (
                SELECT cache_key FROM public.todo_inn_auth_sessions WHERE expires_at <= statement_timestamp()
                ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
            );
            DELETE FROM public.todo_inn_auth_rate_limits WHERE bucket_key IN (
                SELECT bucket_key FROM public.todo_inn_auth_rate_limits WHERE expires_at <= statement_timestamp()
                ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
            )
            """, connection);
        return await command.ExecuteNonQueryAsync(token);
    }

    private async Task ExecuteForKey(string sql, string key, CancellationToken token)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync(token);
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue("key", key);
        await command.ExecuteNonQueryAsync(token);
    }

    private const string RefreshSql = """
        UPDATE public.todo_inn_auth_sessions
        SET expires_at = LEAST(absolute_expires_at, statement_timestamp() + sliding_seconds * interval '1 second')
        WHERE cache_key = @key AND expires_at > statement_timestamp() AND sliding_seconds IS NOT NULL
        """;

    private const string GetSql = """
        WITH active_session AS (
        """ + "\n" + RefreshSql + """
         RETURNING data
        )
        SELECT data FROM active_session
        UNION ALL
        SELECT data FROM public.todo_inn_auth_sessions
        WHERE cache_key = @key AND expires_at > statement_timestamp() AND sliding_seconds IS NULL
        """;

    private const string SetSql = """
        INSERT INTO public.todo_inn_auth_sessions (cache_key, data, expires_at, absolute_expires_at, sliding_seconds)
        VALUES (@key, @data,
            COALESCE(LEAST(@absolute, statement_timestamp() + @sliding * interval '1 second'), 'infinity'::timestamptz),
            @absolute, @sliding)
        ON CONFLICT (cache_key) DO UPDATE SET
            data = EXCLUDED.data, expires_at = EXCLUDED.expires_at,
            absolute_expires_at = EXCLUDED.absolute_expires_at, sliding_seconds = EXCLUDED.sliding_seconds
        """;
}

internal sealed class AuthStorageCleanup(PostgresAuthCache cache, ILogger<AuthStorageCleanup> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(30));
        do
        {
            try
            {
                while (await cache.DeleteExpired(stoppingToken) >= 1000)
                    stoppingToken.ThrowIfCancellationRequested();
            }
            catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
            {
                logger.LogWarning("Expired auth cache cleanup failed: {ErrorType}", exception.GetType().Name);
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
