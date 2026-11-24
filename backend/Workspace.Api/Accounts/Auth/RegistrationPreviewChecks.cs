using System.Text.RegularExpressions;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace Workspace.Api.Accounts.Auth;

internal static class RegistrationPreviewChecks
{
    internal sealed record Input(string Action, string? Email, string? AccountType, string? Username, string? Identifier);

    internal static bool Supports(string? action) => action is "check_registration_email" or "validate_registration_email"
        or "validate_registration_username" or "validate_corporate_admin_identifier";

    internal static Input ReadInput(JsonElement input, string action) =>
        new(action, Value(input, "email"), Value(input, "account_type"), Value(input, "username"), Value(input, "identifier"));

    internal static string? Value(JsonElement input, string name) =>
        input.TryGetProperty(name, out var field) && field.ValueKind == JsonValueKind.String ? field.GetString() : null;

    internal static async Task<IResult> Check(HttpContext context, Input input)
    {
        const string invalidAdmin = "Введите корректный e-mail или логин администратора.";
        var admin = input.Action == "validate_corporate_admin_identifier";
        var username = input.Action == "validate_registration_username";
        var checkEmail = input.Action == "check_registration_email";
        var email = NormalizeEmail(input.Email);
        string lookup;
        if (admin)
        {
            if (input.Identifier is not { } identifier) return Error(422, invalidAdmin);
            if (LoginEmailEndpoint.IsEmailAddress(identifier)) return Valid();
            if (!Regex.IsMatch(identifier, @"\A@[A-Za-z][A-Za-z0-9_-]{2,23}\z")) return Error(422, invalidAdmin);
            lookup = identifier;
        }
        else if (username)
        {
            if (input.Username is not { } handle || !Regex.IsMatch(handle, @"\A@[A-Za-z][A-Za-z0-9_-]{2,22}\z"))
                return Error(422, "Проверьте формат логина.");
            lookup = handle;
        }
        else
        {
            if (email is null || (!checkEmail && input.AccountType is not ("individual" or "corporate")))
                return Error(422, checkEmail ? "Проверьте формат e-mail." : "Проверьте e-mail и тип аккаунта.");
            lookup = email;
        }

        long? exclude = null;
        if (!admin)
        {
            var identity = await AuthPreviewIdentity.Read(context, includeCorporateProfile: false);
            if (identity.Unavailable) return Unavailable();
            if (identity.Personal is { RequiresUpgrade: true } legacy)
            {
                if (username && string.Equals(legacy.Username, lookup, StringComparison.OrdinalIgnoreCase))
                    return Error(409, "Для обновления придумайте новый логин.");
                exclude = legacy.Id;
            }
        }

        var connectionString = context.RequestServices.GetRequiredService<IConfiguration>().GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString)) return Unavailable();
        var cancellation = context.RequestAborted;
        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            if (!admin && !username)
            {
                var (accounts, _) = await LookupEmail(connection, lookup, exclude, cancellation);
                if (checkEmail) return Results.Json(new { success = true, data = new { existing_accounts = accounts } });
                if (input.AccountType == "individual" && accounts.Contains("individual"))
                    return Error(409, "Этот e-mail уже привязан к личному аккаунту.");
                if (input.AccountType == "corporate" && accounts.Contains("corporate"))
                    return Error(409, "Эта почта уже привязана к аккаунту организации.");
                return Results.Json(new { success = true, data = new { available = true } });
            }

            await using var command = new NpgsqlCommand(admin ? AdminSql : UsernameSql, connection);
            command.Parameters.AddWithValue("value", lookup.ToLowerInvariant());
            if (admin)
            {
                var stored = await command.ExecuteScalarAsync(cancellation);
                return stored is string address && LoginEmailEndpoint.IsEmailAddress(address) ? Valid()
                    : Error(422, "Не удалось найти пользователя с таким логином и e-mail.");
            }
            command.Parameters.Add("exclude", NpgsqlDbType.Bigint).Value = (object?)exclude ?? DBNull.Value;

            await using var row = await command.ExecuteReaderAsync(cancellation);
            if (!await row.ReadAsync(cancellation)) return Unavailable();
            if (row.GetBoolean(0)) return Error(409, "Этот логин уже используется личным аккаунтом.");
            if (row.GetBoolean(1)) return Error(409, "Этот логин уже используется аккаунтом организации.");

            return Results.Json(new { success = true, data = new { available = true } });
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(RegistrationPreviewChecks))
                .LogError("Registration preview lookup failed: {ErrorType}", exception.GetType().Name);
            return Unavailable();
        }
    }

    internal static string? NormalizeEmail(string? value)
    {
        var email = value?.Trim(' ', '\t', '\n', '\r', '\v', '\0');
        return email is not null && LoginEmailEndpoint.IsEmailAddress(email) ? email.ToLowerInvariant() : null;
    }

    internal static async Task<(string[] Accounts, string Greeting)> LookupEmail(
        NpgsqlConnection connection, string email, long? exclude, CancellationToken cancellation)
    {
        await using var command = new NpgsqlCommand(EmailSql, connection);
        command.Parameters.AddWithValue("value", email);
        command.Parameters.Add("exclude", NpgsqlDbType.Bigint).Value = (object?)exclude ?? DBNull.Value;
        await using var row = await command.ExecuteReaderAsync(cancellation);
        await row.ReadAsync(cancellation);
        var accounts = new List<string>(2);
        if (row.GetBoolean(0)) accounts.Add("individual");
        if (row.GetBoolean(1)) accounts.Add("corporate");
        return (accounts.ToArray(), row.GetString(2));
    }

    private static IResult Valid() => Results.Json(new { success = true, data = new { valid = true } });
    private static IResult Unavailable() => Error(503, "Не удалось проверить данные регистрации. Попробуйте позже.");
    private static IResult Error(int status, string error) => Results.Json(new { success = false, error }, statusCode: status);

    private const string AdminSql = "SELECT email FROM users WHERE LOWER(username) = @value LIMIT 1";
    private const string UsernameSql = """
        SELECT EXISTS (SELECT 1 FROM users WHERE LOWER(username) = @value AND id IS DISTINCT FROM @exclude),
            EXISTS (SELECT 1 FROM corporate_accounts WHERE LOWER(root_username) = @value)
        """;
    private const string EmailSql = """
        WITH matching AS (
            SELECT id, account_type, first_name, middle_name FROM users WHERE LOWER(email) = @value
        ), found AS (
            SELECT account_type FROM matching WHERE id IS DISTINCT FROM @exclude LIMIT 1
        )
        SELECT EXISTS (SELECT 1 FROM found WHERE account_type = 'individual'),
            EXISTS (SELECT 1 FROM found WHERE account_type <> 'individual')
            OR EXISTS (SELECT 1 FROM corporate_accounts WHERE LOWER(root_email) = @value),
            COALESCE((SELECT concat_ws(' ', nullif(btrim(first_name), ''), nullif(btrim(middle_name), ''))
                      FROM matching LIMIT 1), '')
        """;
}
