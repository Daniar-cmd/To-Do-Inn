using System.Text.Json;
using Npgsql;

namespace Workspace.Api.Accounts.Auth;

internal static class LoginPreviewEndpoint
{
    internal sealed record LoginInput(string? Username, string? Password, string? AccountType, bool InvalidAccountType);
    private sealed record Candidate(long Id, string Username, string Type, string? Hash, string? OrganizationName, long PasswordVersion);

    internal static LoginInput ReadInput(JsonElement input)
    {
        var invalid = input.TryGetProperty("account_type", out var type)
            && type.ValueKind is not (JsonValueKind.Null or JsonValueKind.String);
        return new(GetString(input, "username"), GetString(input, "password"), GetString(input, "account_type"), invalid);
    }

    private static string? GetString(JsonElement input, string name) =>
        input.TryGetProperty(name, out var field) && field.ValueKind == JsonValueKind.String ? field.GetString() : null;

    internal static async Task<IResult> Login(HttpContext context, LoginInput input)
    {
        if (string.IsNullOrEmpty(input.Username) || string.IsNullOrEmpty(input.Password))
            return Error(422, "Введите логин и пароль.");
        if (input.InvalidAccountType || (input.AccountType is not null and not ("individual" or "corporate")))
            return Error(422, "Выберите тип аккаунта.");

        var byEmail = LoginEmailEndpoint.IsEmailAddress(input.Username);
        if (!byEmail && input.AccountType is not null)
            return Error(422, "Выбор аккаунта доступен при входе по e-mail.");
        if (input.Username.Contains('\0')) return InvalidCredentials();

        var connectionString = context.RequestServices.GetRequiredService<IConfiguration>().GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString)) return Unavailable();

        try
        {
            var candidates = await FindCandidates(connectionString, input.Username, byEmail, context.RequestAborted);
            var root = candidates.Find(candidate => candidate.Type == "root");
            Candidate? account;
            if (byEmail)
            {
                var personal = candidates.Find(candidate => candidate.Type == "individual");
                var legacy = candidates.Find(candidate => candidate.Type is not ("individual" or "root"));
                var hasCorporate = root is not null || legacy is not null;
                if (input.AccountType is null && personal is not null && hasCorporate)
                {
                    if (!Matches(personal, input.Password) && !Matches(root, input.Password) && !Matches(legacy, input.Password))
                        return InvalidCredentials();

                    return Results.Json(new { success = true, data = new { account_choices = new[] { "individual", "corporate" } } });
                }
                account = input.AccountType == "individual" || (input.AccountType is null && !hasCorporate)
                    ? Match(personal, input.Password)
                    : Match(root, input.Password) ?? Match(legacy, input.Password);
            }
            else
            {
                var user = candidates.Find(candidate => candidate.Type != "root");
                account = Match(user, input.Password) ?? Match(root, input.Password);
            }

            if (account is null) return InvalidCredentials();
            var isRoot = account.Type == "root";
            await AuthPreviewIdentity.SignIn(context, account.Id, isRoot, account.PasswordVersion);

            return Results.Json(new
            {
                success = true,
                data = new
                {
                    user = isRoot ? null : new { id = account.Id, username = account.Username, account_type = account.Type },
                    corporate_account = isRoot ? new { id = account.Id, username = account.Username, name = account.OrganizationName } : null,
                }
            });
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(LoginPreviewEndpoint))
                .LogError(exception, "Preview login data lookup failed");
            return Unavailable();
        }
    }

    private static async Task<List<Candidate>> FindCandidates(string connectionString, string input, bool byEmail,
        CancellationToken cancellation)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(cancellation);
        await using var command = new NpgsqlCommand(byEmail ? EmailSql : UsernameSql, connection);
        command.Parameters.AddWithValue("key", byEmail ? input.ToLowerInvariant() : input);
        if (!byEmail) command.Parameters.AddWithValue("root_key", input.ToLowerInvariant());
        await using var reader = await command.ExecuteReaderAsync(cancellation);
        var result = new List<Candidate>();
        while (await reader.ReadAsync(cancellation))
        {
            result.Add(new Candidate(reader.GetInt64(0), reader.GetString(1), reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3), reader.IsDBNull(4) ? null : reader.GetString(4), reader.GetInt64(5)));
        }
        return result;
    }

    private static bool Matches(Candidate? candidate, string password) =>
        candidate is not null && LegacyPasswordVerifier.Verify(password, candidate.Hash);

    private static Candidate? Match(Candidate? candidate, string password) => Matches(candidate, password) ? candidate : null;

    private static IResult InvalidCredentials() => Error(401, "Неверный логин или пароль.");

    internal static IResult Unavailable() => Error(503, "Сервис входа временно недоступен.");

    private static IResult Error(int status, string error) =>
        Results.Json(new { success = false, error }, statusCode: status);

    private const string EmailSql = """
        SELECT id, username, account_type, password_hash, NULL::text, password_version
        FROM users WHERE LOWER(email) = @key
        UNION ALL
        SELECT id, root_username, 'root', root_password_hash, organization_name, 0::bigint
        FROM corporate_accounts WHERE LOWER(root_email) = @key AND root_username IS NOT NULL
        """;

    private const string UsernameSql = """
        SELECT id, username, account_type, password_hash, NULL::text, password_version
        FROM users WHERE username = @key
        UNION ALL
        SELECT id, root_username, 'root', root_password_hash, organization_name, 0::bigint
        FROM corporate_accounts WHERE LOWER(root_username) = @root_key
        """;
}
