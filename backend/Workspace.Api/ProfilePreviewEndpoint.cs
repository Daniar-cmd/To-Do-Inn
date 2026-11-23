using System.Buffers;
using System.Text;
using System.Text.Json;
using Npgsql;

internal static class ProfilePreviewEndpoint
{
    private const int WriteBodyLimit = 1_500_000;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    internal static async Task<IResult> Handle(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.XContentTypeOptions = "nosniff";
        await context.Session.LoadAsync(context.RequestAborted);
        var identity = await AuthPreviewIdentity.Read(context, includeCorporateProfile: false);
        if (identity.Unavailable) return Unavailable();
        if (identity.Personal is not { } session) return Unauthorized();

        var request = context.Request;
        var write = HttpMethods.IsPost(request.Method);
        if (!write && !HttpMethods.IsGet(request.Method))
        {
            context.Response.Headers.Allow = "GET, POST";
            return Error(405, "Method not allowed");
        }

        var limits = context.RequestServices.GetRequiredService<AuthPreviewLimits>();
        if (write)
        {
            if (!AuthPreviewEndpoint.HasValidCsrf(context))
                return Error(403, "Сессия истекла. Обновите страницу.");
            return await WriteProfile(context, session, limits);
        }

        if (await limits.RejectProfileAsync(context, session.Id, write: false) is { } rejected) return rejected;
        return await ReadProfile(context, session);
    }

    private static async Task<IResult> ReadProfile(HttpContext context, AuthPreviewIdentity.PersonalSession session)
    {
        var connectionString = context.RequestServices.GetRequiredService<IConfiguration>().GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString)) return Unavailable();
        try
        {
            var cancellation = context.RequestAborted;
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            var profile = await ReadRecord(connection, null, session.Id, session.PasswordVersion, cancellation);
            return profile is null ? Unauthorized() : Results.Json(new { success = true, data = new { profile } });
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(ProfilePreviewEndpoint))
                .LogError(exception, "Preview profile lookup failed");
            return Unavailable();
        }
    }

    internal static async Task<object?> ReadRecord(NpgsqlConnection connection, NpgsqlTransaction? transaction,
        long id, long version, CancellationToken cancellation)
    {
        await using var command = new NpgsqlCommand(ReadSql, connection, transaction);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("version", version);
        await using var reader = await command.ExecuteReaderAsync(cancellation);
        if (!await reader.ReadAsync(cancellation)) return null;
        var mime = Text(reader, 10);
        var avatar = !reader.IsDBNull(11) && mime is "image/jpeg" or "image/png" or "image/webp"
            ? $"data:{mime};base64,{Convert.ToBase64String(reader.GetFieldValue<byte[]>(11))}"
            : null;
        return new
        {
            id, username = Text(reader, 0), email = Text(reader, 1),
            secondary_email = Text(reader, 2), account_type = Text(reader, 3), about = Text(reader, 4),
            github_url = Text(reader, 5), telegram_url = Text(reader, 6), preferred_theme = Text(reader, 7),
            username_changed_at = Text(reader, 8), username_change_available_at = Text(reader, 9), avatar,
        };
    }

    private static async Task<IResult> WriteProfile(HttpContext context, AuthPreviewIdentity.PersonalSession session,
        AuthPreviewLimits limits)
    {
        var request = context.Request;
        if (request.ContentLength > WriteBodyLimit) return TooLarge();
        var data = ArrayPool<byte>.Shared.Rent(WriteBodyLimit + 1);
        try
        {
            var length = await request.Body.ReadAtLeastAsync(data.AsMemory(0, WriteBodyLimit + 1),
                WriteBodyLimit + 1, throwOnEndOfStream: false, cancellationToken: request.HttpContext.RequestAborted);
            if (length > WriteBodyLimit) return TooLarge();
            _ = StrictUtf8.GetCharCount(data.AsSpan(0, length));
            using var document = JsonDocument.Parse(data.AsMemory(0, length), new JsonDocumentOptions { MaxDepth = 511 });
            if (document.RootElement.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array)) return InvalidJson();
            if (await limits.RejectProfileAsync(context, session.Id, write: true) is { } rejected) return rejected;
            return await ProfilePreviewWriter.Save(context, session, limits, document.RootElement);
        }
        catch (Exception exception) when (exception is JsonException or DecoderFallbackException)
        {
            return InvalidJson();
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(data, clearArray: true);
        }
    }

    private static string? Text(NpgsqlDataReader reader, int ordinal) => reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    private static IResult Unauthorized() => Error(401, "Требуется войти в аккаунт.");
    private static IResult Unavailable() => Error(503, "Не удалось загрузить профиль. Попробуйте позже.");
    private static IResult TooLarge() => Error(413, "Запрос слишком большой.");
    private static IResult InvalidJson() => Error(400, "Некорректный JSON-запрос.");
    private static IResult Error(int status, string error) => Results.Json(new { success = false, error }, statusCode: status);

    private const string ReadSql = """
        SELECT username, email, secondary_email, account_type, about, github_url, telegram_url,
            preferred_theme, username_changed_at::text, (username_changed_at + INTERVAL '24 hours')::text,
            avatar_mime, avatar_data
        FROM users WHERE id = @id AND password_version = @version
        """;
}
