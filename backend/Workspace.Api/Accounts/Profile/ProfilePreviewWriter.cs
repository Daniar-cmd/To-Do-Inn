using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Npgsql;
using NpgsqlTypes;
using Workspace.Api.Accounts.Auth;

namespace Workspace.Api.Accounts.Profile;

internal static class ProfilePreviewWriter
{
    private const string InvalidProfile = "Проверьте логин и остальные данные профиля.";
    private const string InvalidPassword = "Введите текущий пароль и два совпадающих новых пароля (6–128 символов, буква и цифра).";

    internal static async Task<IResult> Save(HttpContext context, AuthPreviewIdentity.PersonalSession session,
        AuthPreviewLimits limits, ProfileReader profiles, JsonElement input)
    {
        var username = Trim(ReadText(input, "username", ""));
        var email = ReadText(input, "email", "");
        var secondary = ReadText(input, "secondary_email", "");
        var about = ReadText(input, "about", "");
        var accountType = ReadText(input, "account_type", "");
        var accountTypeSent = HasField(input, "account_type");
        if (username is null || !Regex.IsMatch(username, @"\A(?:[A-Za-z][A-Za-z0-9_@-]{3,23}|@[A-Za-z][A-Za-z0-9_-]{2,22})\z")
            || email is null || secondary is null || about is null || about.EnumerateRunes().Count() > 1200
            || (accountTypeSent && accountType is not ("individual" or "team" or "corporate")))
            return Error(422, InvalidProfile);

        email = Trim(email)!.ToLowerInvariant();
        secondary = Trim(secondary)!.ToLowerInvariant();
        if ((email.Length != 0 && !LoginEmailEndpoint.IsEmailAddress(email))
            || (secondary.Length != 0 && !LoginEmailEndpoint.IsEmailAddress(secondary)))
            return Error(422, "Проверьте формат электронной почты.");
        if (email.Length != 0 && email == secondary)
            return Error(422, "Основная и дополнительная почта должны различаться.");

        var current = ReadText(input, "current_password", "");
        var next = ReadText(input, "new_password", "");
        var confirmation = ReadText(input, "confirm_password", "");
        var passwordChange = current != "" || next != "" || confirmation != "";
        if (passwordChange && (string.IsNullOrEmpty(current) || next is null || next.Length is < 6 or > 128
            || next.Any(character => character is < '!' or > '~')
            || !next.Any(char.IsAsciiLetter) || !next.Any(char.IsAsciiDigit) || next != confirmation))
            return Error(422, InvalidPassword);

        var avatarSent = HasField(input, "avatar");
        byte[]? avatarBytes = null;
        string? avatarMime = null;
        if (avatarSent && input.GetProperty("avatar").ValueKind != JsonValueKind.Null)
        {
            var (bytes, mime, error) = ProfileAvatar.Parse(ReadText(input, "avatar", ""));
            if (error is not null) return Error(422, error);
            avatarBytes = bytes;
            avatarMime = mime;
        }

        if (passwordChange && await limits.RejectProfilePasswordAsync(context, session.Id) is { } rejected) return rejected;
        var connectionString = context.RequestServices.GetRequiredService<IConfiguration>().GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString)) return Unavailable();

        var cancellation = context.RequestAborted;
        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            await using var transaction = await connection.BeginTransactionAsync(cancellation);
            string? newHash = null;
            string? github;
            string? telegram;
            string? theme;
            await using (var find = new NpgsqlCommand(FindSql, connection, transaction))
            {
                find.Parameters.AddWithValue("id", session.Id);
                find.Parameters.AddWithValue("version", session.PasswordVersion);
                await using var row = await find.ExecuteReaderAsync(cancellation);
                if (!await row.ReadAsync(cancellation)) return Unauthorized();
                github = ReadText(input, "github_url", Text(row, 5) ?? "");
                telegram = ReadText(input, "telegram_url", Text(row, 6) ?? "");
                theme = ReadText(input, "preferred_theme", Text(row, 7) ?? "system");
                if (github is null || telegram is null || theme is not ("light" or "dark" or "system"))
                    return Error(422, InvalidProfile);
                if (github != "" && !ValidLink(github, @"\Ahttps://github\.com/[A-Za-z0-9-]{1,39}/?\z"))
                    return Error(422, "Укажите ссылку вида https://github.com/username.");
                if (telegram != "" && !ValidLink(telegram, @"\Ahttps://t\.me/[A-Za-z0-9_]{5,32}/?\z"))
                    return Error(422, "Укажите ссылку вида https://t.me/username.");
                if (email != (Text(row, 1) ?? "").ToLowerInvariant() || secondary != (Text(row, 2) ?? "").ToLowerInvariant())
                    return Error(403, "Изменение электронной почты временно недоступно.");
                if (username != row.GetString(0)) return Error(403, "Изменение логина временно недоступно.");
                if (accountTypeSent && accountType != row.GetString(3)) return Error(403, "Тип аккаунта нельзя изменить.");
                if (passwordChange)
                {
                    if (!LegacyPasswordVerifier.Verify(current!, Text(row, 4)))
                        return Error(403, "Текущий пароль указан неверно.");
                    newHash = LegacyPasswordVerifier.Hash(next!);
                }
            }

            await using var update = new NpgsqlCommand(UpdateSql, connection, transaction);
            update.Parameters.AddWithValue("id", session.Id);
            update.Parameters.AddWithValue("about", Trim(about)!);
            update.Parameters.Add("github", NpgsqlDbType.Varchar).Value = github.Length > 0 ? github : DBNull.Value;
            update.Parameters.Add("telegram", NpgsqlDbType.Varchar).Value = telegram.Length > 0 ? telegram : DBNull.Value;
            update.Parameters.AddWithValue("theme", theme);
            update.Parameters.AddWithValue("avatar_sent", avatarSent);
            update.Parameters.Add("avatar_data", NpgsqlDbType.Bytea).Value = (object?)avatarBytes ?? DBNull.Value;
            update.Parameters.Add("avatar_mime", NpgsqlDbType.Varchar).Value = (object?)avatarMime ?? DBNull.Value;
            update.Parameters.Add("hash", NpgsqlDbType.Varchar).Value = (object?)newHash ?? DBNull.Value;
            var version = (long)(await update.ExecuteScalarAsync(cancellation))!;
            var profile = await profiles.ReadRecord(connection, transaction, session.Id, version, cancellation);
            if (profile is null) return Unauthorized();
            await transaction.CommitAsync(cancellation);

            if (passwordChange)
            {
                await AuthPreviewIdentity.SignOut(context);
                return Results.Json(new { success = true, data = new { profile, signed_out = true } });
            }
            return Results.Json(new { success = true, data = new { profile } });
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.CheckViolation)
        {
            return Error(422, "Проверьте данные профиля.");
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return Error(409, "Логин или электронная почта уже используются.");
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(ProfilePreviewWriter))
                .LogError("Preview profile save failed: {ErrorType}, SQL state {SqlState}", exception.GetType().Name,
                    (exception as PostgresException)?.SqlState);
            return Unavailable();
        }
    }

    private static bool HasField(JsonElement input, string name) =>
        input.ValueKind == JsonValueKind.Object && input.TryGetProperty(name, out _);

    private static string? ReadText(JsonElement input, string name, string fallback) =>
        !HasField(input, name) || input.GetProperty(name).ValueKind == JsonValueKind.Null ? fallback
            : input.GetProperty(name).ValueKind == JsonValueKind.String ? input.GetProperty(name).GetString() : null;

    private static string? Trim(string? text) => text?.Trim(' ', '\t', '\n', '\r', '\v', '\0');
    private static bool ValidLink(string text, string pattern) =>
        Regex.IsMatch(text, pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static string? Text(NpgsqlDataReader reader, int field) => reader.IsDBNull(field) ? null : reader.GetString(field);
    private static IResult Unauthorized() => Error(401, "Требуется войти в аккаунт.");
    private static IResult Unavailable() => Error(503, "Не удалось сохранить профиль. Попробуйте позже.");
    private static IResult Error(int status, string error) => Results.Json(new { success = false, error }, statusCode: status);

    private const string FindSql = """
        SELECT username, email, secondary_email, account_type, password_hash, github_url, telegram_url, preferred_theme
        FROM users WHERE id = @id AND password_version = @version FOR UPDATE
        """;

    private const string UpdateSql = """
        UPDATE users SET about = @about, github_url = @github, telegram_url = @telegram, preferred_theme = @theme,
            avatar_data = CASE WHEN @avatar_sent THEN @avatar_data ELSE avatar_data END,
            avatar_mime = CASE WHEN @avatar_sent THEN @avatar_mime ELSE avatar_mime END,
            password_hash = COALESCE(@hash, password_hash),
            password_version = password_version + CASE WHEN @hash IS NULL THEN 0 ELSE 1 END
        WHERE id = @id RETURNING password_version
        """;
}
