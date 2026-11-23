using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Npgsql;

internal sealed class RegistrationEmailCodes(
    AuthChallengeStore store, IMemoryCache cache, IConfiguration configuration, PreviewMail mail, ILogger<RegistrationEmailCodes> logger)
{
    internal const string VerifiedEmailKey = "registration_verified_email";
    private const string ProofSessionKey = "registration_verification_proof";
    private const string LocalCode = "285868";
    private const int MaxAttempts = 5;
    private readonly object gate = new();

    internal sealed record Input(string? Email, string? Code);
    private sealed record Challenge(Guid Id, byte[] SigningKey, byte[] Hash, int Attempts, DateTimeOffset ExpiresAt, string[] Accounts);
    private sealed record Proof(DateTimeOffset ExpiresAt, bool InUse = false);

    internal static Input ReadInput(JsonElement input) => new(
        RegistrationPreviewChecks.Value(input, "email"), RegistrationPreviewChecks.Value(input, "code"));

    internal async Task<IResult> Send(HttpContext context, string? value, AuthPreviewIdentity.PersonalSession? personal)
    {
        var email = RegistrationPreviewChecks.NormalizeEmail(value);
        if (email is null) return Error(422, "Проверьте формат e-mail.");

        var key = CacheKey(email);

        var exclude = personal is { RequiresUpgrade: true } legacy ? legacy.Id : (long?)null;
        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString)) return Unavailable();

        var cancellation = context.RequestAborted;
        try
        {
            if (context.Session.GetString(ProofSessionKey) is { } oldProof)
                await store.Remove(oldProof, null, cancellation);
            context.Session.Remove(ProofSessionKey);
            context.Session.Remove(VerifiedEmailKey);
            await store.WithLock(key, async transaction =>
            {
                await store.Remove(key, transaction, cancellation);
                return true;
            }, cancellation);

            string[] accounts;
            string greeting;
            await using (var connection = new NpgsqlConnection(connectionString))
            {
                await connection.OpenAsync(cancellation);
                (accounts, greeting) = await RegistrationPreviewChecks.LookupEmail(connection, email, exclude, cancellation);
            }
            if (accounts.Length > 1)
                return Error(409, "Этот e-mail уже связан с личным и корпоративным аккаунтами. Войдите в нужный аккаунт или восстановите пароль.");

            var local = configuration.GetValue<bool>("AuthPreview:UseLocalVerificationCode");
            var code = local ? LocalCode : RandomNumberGenerator.GetInt32(100000, 1000000).ToString(CultureInfo.InvariantCulture);
            var expiresAt = DateTimeOffset.UtcNow.AddMinutes(10);
            var signingKey = RandomNumberGenerator.GetBytes(32);
            var challenge = new Challenge(Guid.NewGuid(), signingKey, Hash(signingKey, code), 0, expiresAt, accounts);
            await store.WithLock(key, async transaction =>
            {
                await store.Set(key, challenge, expiresAt, transaction, cancellation);
                return true;
            }, cancellation);
            if (!local && !await mail.SendVerification(email, code, greeting, cancellation))
            {
                await store.WithLock(key, async transaction =>
                {
                    if ((await store.Get<Challenge>(key, transaction, cancellation))?.Id == challenge.Id)
                        await store.Remove(key, transaction, cancellation);
                    return true;
                }, cancellation);
                return Unavailable();
            }
            return Success("sent", accounts, local ? code : null);
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            logger.LogError("Preview verification code lookup failed: {ErrorType}", exception.GetType().Name);
            return Unavailable();
        }
    }

    internal async Task<IResult> Verify(HttpContext context, Input input)
    {
        var email = RegistrationPreviewChecks.NormalizeEmail(input.Email);
        if (email is null || input.Code is not { Length: 6 } code || !code.All(char.IsAsciiDigit))
            return Error(422, "Проверьте e-mail и шестизначный код.");

        var key = CacheKey(email);
        var previousProof = context.Session.GetString(ProofSessionKey);
        var cancellation = context.RequestAborted;
        string? newProof = null;
        var result = await store.WithLock(key, async transaction =>
        {
            var challenge = await store.Get<Challenge>(key, transaction, cancellation);
            if (challenge is null || challenge.ExpiresAt <= DateTimeOffset.UtcNow)
                return Error(422, "Код истёк. Запросите новый код.");
            if (CryptographicOperations.FixedTimeEquals(challenge.Hash, Hash(challenge.SigningKey, code)))
            {
                await store.Remove(key, transaction, cancellation);
                if (previousProof is not null) await store.Remove(previousProof, transaction, cancellation);
                newProof = "preview-registration-proof:" + Guid.NewGuid().ToString("N");
                var expiresAt = DateTimeOffset.UtcNow.AddHours(2);
                await store.Set(newProof, new Proof(expiresAt), expiresAt, transaction, cancellation);
                return Success("verified", challenge.Accounts);
            }
            if (challenge.Attempts + 1 >= MaxAttempts)
            {
                await store.Remove(key, transaction, cancellation);
                return Error(429, "Слишком много попыток. Запросите новый код.");
            }
            await store.Set(key, challenge with { Attempts = challenge.Attempts + 1 }, challenge.ExpiresAt, transaction, cancellation);
            return Error(422, "Неверный код. Проверьте письмо и попробуйте ещё раз.");
        }, cancellation);
        if (newProof is not null)
        {
            context.Session.SetString(VerifiedEmailKey, email);
            context.Session.SetString(ProofSessionKey, newProof);
        }
        return result;
    }

    internal static string? ReadProof(HttpContext context, string email) =>
        context.Session.GetString(VerifiedEmailKey) == email ? context.Session.GetString(ProofSessionKey) : null;

    internal bool UsesPersistentProof => store.Persistent;

    internal Task<bool> ConsumeProof(string key, NpgsqlTransaction transaction, CancellationToken cancellation) =>
        store.ConsumeProof(key, transaction, cancellation);

    internal bool ReserveMemoryProof(string key)
    {
        lock (gate)
        {
            if (!cache.TryGetValue<Proof>(key, out var proof) || proof is null || proof.InUse) return false;
            cache.Set(key, proof with { InUse = true }, proof.ExpiresAt);
            return true;
        }
    }

    internal void FinishRegistration(string key, bool committed)
    {
        lock (gate)
        {
            if (committed) cache.Remove(key);
            else if (cache.TryGetValue<Proof>(key, out var proof) && proof is not null)
                cache.Set(key, proof with { InUse = false }, proof.ExpiresAt);
        }
    }

    private static byte[] Hash(byte[] signingKey, string code) => HMACSHA256.HashData(signingKey, Encoding.ASCII.GetBytes(code));
    private static string CacheKey(string email) => "preview-email-code:" + Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(email)));

    private static IResult Success(string status, string[] accounts, string? testCode = null)
    {
        var data = new Dictionary<string, object> { [status] = true };
        if (testCode is not null) data["test_code"] = testCode;
        if (accounts.Length > 0) data["existing_accounts"] = accounts;
        return Results.Json(new { success = true, data });
    }

    private static IResult Unavailable() => Error(503, "Не удалось отправить письмо. Попробуйте позже.");
    private static IResult Error(int status, string error) => Results.Json(new { success = false, error }, statusCode: status);
}
