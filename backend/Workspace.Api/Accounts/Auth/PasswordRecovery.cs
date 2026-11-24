using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Npgsql;
using Workspace.Api.Infrastructure.Mail;

namespace Workspace.Api.Accounts.Auth;

internal sealed class PasswordRecovery(AuthChallengeStore store, IConfiguration configuration, PreviewMail mail,
    TimeProvider clock, ILogger<PasswordRecovery> logger)
{
    private const string InvalidLink = "Ссылка недействительна или срок её действия истёк. Запросите новую.";
    internal sealed record Input(string? Token, string? Password, string? Confirmation);
    private sealed record Challenge(long UserId, string Email, DateTimeOffset ExpiresAt);

    internal static Input ReadInput(JsonElement input) => new(
        RegistrationPreviewChecks.Value(input, "token"),
        RegistrationPreviewChecks.Value(input, "password"),
        RegistrationPreviewChecks.Value(input, "confirm_password"));

    internal async Task<IResult> RequestLink(HttpContext context, string? value)
    {
        var email = RegistrationPreviewChecks.NormalizeEmail(value);
        if (email is null) return Error(422, "Проверьте формат e-mail.");
        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString)) return Unavailable();

        var cancellation = context.RequestAborted;
        try
        {
            long userId;
            string greeting;
            await using (var connection = new NpgsqlConnection(connectionString))
            {
                await connection.OpenAsync(cancellation);
                await using var find = new NpgsqlCommand(RecipientSql, connection);
                find.Parameters.AddWithValue("email", email);
                await using var row = await find.ExecuteReaderAsync(cancellation);
                if (!await row.ReadAsync(cancellation)) return Sent();
                userId = row.GetInt64(0);
                greeting = row.GetString(1);
            }

            var addressKey = AddressKey(email);
            var token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
            var hash = Hash(token);
            var expiresAt = clock.GetUtcNow().AddMinutes(30);
            await store.WithLock(addressKey, async transaction =>
            {
                if (await store.Get<string>(addressKey, transaction, cancellation) is { } previousHash)
                    await store.Remove(TokenKey(previousHash), transaction, cancellation);
                await store.Set(TokenKey(hash), new Challenge(userId, email, expiresAt), expiresAt, transaction, cancellation);
                await store.Set(addressKey, hash, expiresAt, transaction, cancellation);
                return true;
            }, cancellation);
            if (!await mail.SendPasswordReset(email, token, greeting, cancellation))
            {
                await store.WithLock(addressKey, async transaction =>
                {
                    if (await store.Get<string>(addressKey, transaction, cancellation) == hash)
                    {
                        await store.Remove(TokenKey(hash), transaction, cancellation);
                        await store.Remove(addressKey, transaction, cancellation);
                    }
                    return true;
                }, cancellation);
            }
            return Sent();
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            logger.LogError("Preview password recovery lookup failed: {ErrorType}", exception.GetType().Name);
            return Unavailable();
        }
    }

    internal async Task<IResult> Reset(HttpContext context, Input input)
    {
        if (input.Token is not { Length: 64 } token || !token.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f')
            || input.Password is not { } password || input.Confirmation is null)
            return Error(422, InvalidLink);
        if (password != input.Confirmation || !LegacyPasswordVerifier.MeetsRegistrationPolicy(password))
            return Error(422, "Пароль должен содержать от 8 до 128 символов латиницей, включая строчную и заглавную буквы, цифру и специальный символ; пароли должны совпадать.");

        var hash = Hash(token);
        var key = TokenKey(hash);
        var cancellation = context.RequestAborted;
        long userId;
        try
        {
            var challenge = await store.Get<Challenge>(key, null, cancellation);
            if (challenge is null || challenge.ExpiresAt <= clock.GetUtcNow()) return Error(422, InvalidLink);
            var connectionString = configuration.GetConnectionString("Workspace");
            if (string.IsNullOrWhiteSpace(connectionString)) return Unavailable();
            var addressKey = AddressKey(challenge.Email);
            var changed = await store.WithLock(addressKey, async transaction =>
            {
                var current = await store.Get<Challenge>(key, transaction, cancellation);
                if (current != challenge || challenge.ExpiresAt <= clock.GetUtcNow()
                    || await store.Get<string>(addressKey, transaction, cancellation) != hash)
                    return false;

                var passwordHash = LegacyPasswordVerifier.Hash(password);
                if (transaction is null)
                {
                    await using var connection = new NpgsqlConnection(connectionString);
                    await connection.OpenAsync(cancellation);
                    await using var write = await connection.BeginTransactionAsync(cancellation);
                    if (!await UpdatePassword(write, challenge, passwordHash, cancellation)) return false;
                    cancellation.ThrowIfCancellationRequested();
                    await write.CommitAsync(CancellationToken.None);
                }
                else if (!await UpdatePassword(transaction, challenge, passwordHash, cancellation))
                    return false;

                await store.Remove(key, transaction, cancellation);
                await store.Remove(addressKey, transaction, cancellation);
                return true;
            }, cancellation);
            if (!changed) return Error(422, InvalidLink);
            userId = challenge.UserId;
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            logger.LogError("Preview password reset failed: {ErrorType}", exception.GetType().Name);
            return Unavailable();
        }

        await AuthPreviewIdentity.SignOutIfPersonal(context, userId);
        return Results.Json(new { success = true, data = new { reset = true } });
    }

    private static async Task<bool> UpdatePassword(NpgsqlTransaction transaction, Challenge challenge,
        string passwordHash, CancellationToken cancellation)
    {
        await using var update = new NpgsqlCommand(UpdateSql, transaction.Connection!, transaction);
        update.Parameters.AddWithValue("id", challenge.UserId);
        update.Parameters.AddWithValue("email", challenge.Email);
        update.Parameters.AddWithValue("hash", passwordHash);
        return await update.ExecuteNonQueryAsync(cancellation) == 1;
    }

    internal static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static string AddressKey(string email) => "preview-password-reset-address:" + Hash(email);
    private static string TokenKey(string hash) => "preview-password-reset-token:" + hash;
    private static IResult Sent() => Results.Json(new { success = true, data = new { sent = true } });
    private static IResult Unavailable() => Error(503, "Сервис восстановления пароля временно недоступен.");
    private static IResult Error(int status, string error) => Results.Json(new { success = false, error }, statusCode: status);

    private const string RecipientSql = """
        SELECT id, concat_ws(' ', nullif(btrim(first_name), ''), nullif(btrim(middle_name), ''))
        FROM users WHERE account_type = 'individual' AND LOWER(email) = @email LIMIT 1
        """;

    private const string UpdateSql = """
        UPDATE users SET password_hash = @hash, password_version = password_version + 1
        WHERE id = @id AND account_type = 'individual' AND LOWER(email) = @email
        """;
}
