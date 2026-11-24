using System.Data;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http.Features;
using Npgsql;
using NpgsqlTypes;
using Workspace.Api.Accounts.Auth;
using Workspace.Api.Workspaces;

namespace Workspace.Api.Workspaces.Notes;

internal static class NoteImageEndpoint
{
    private const int MaxImageBytes = 1_048_576;
    private const int MaxRequestBytes = 1_100_000;
    private const string MissingUpload = "Выберите изображение размером не больше 1 МБ.";
    private const string OversizedUpload = "Изображение должно быть не больше 1 МБ.";
    private const string UnsupportedUpload = "Поддерживаются PNG, JPG, WebP, GIF, HEIC и AVIF.";
    private static readonly string[] HeicBrands = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];

    private sealed record ImageInput([property: JsonPropertyName("note_id")] long NoteId, string? Action,
        string? Image, long? Offset);
    private sealed record Upload(byte[]? Bytes, long? Offset = null, string? Error = null);

    public static async Task<IResult> Handle(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory)
    {
        var cancellation = context.RequestAborted;
        ImageInput? input;
        try
        {
            input = await context.Request.ReadFromJsonAsync<ImageInput>(cancellation);
        }
        catch (JsonException)
        {
            return Error(400, "Invalid JSON request");
        }
        if (input is null || input.Action is not ("read" or "upload" or "remove"))
            return Error(400, "Invalid action");
        var upload = input.Action == "upload" ? DecodeBridgeUpload(input.Image, input.Offset) : null;
        return await Apply(context, configuration, loggerFactory, input.NoteId, input.Action, upload);
    }

    private static bool IsMultipart(string? value)
    {
        const string type = "multipart/form-data";
        return value is not null && value.StartsWith(type, StringComparison.OrdinalIgnoreCase)
            && (value.Length == type.Length || value.AsSpan(type.Length).TrimStart().StartsWith(";"));
    }

    private static async Task<Upload> ReadMultipart(HttpContext context)
    {
        if (context.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit)
            limit.MaxRequestBodySize = MaxRequestBytes;

        var request = context.Request;
        context.Features.Set<IFormFeature>(new FormFeature(request, new FormOptions
        {
            MultipartBodyLengthLimit = MaxRequestBytes,
            MemoryBufferThreshold = MaxRequestBytes,
        }));
        IFormCollection form;
        try
        {
            form = await request.ReadFormAsync(context.RequestAborted);
        }
        catch (InvalidDataException)
        {
            return new(null, Error: MissingUpload);
        }
        catch (IOException exception) when (exception is not BadHttpRequestException && !context.RequestAborted.IsCancellationRequested)
        {
            return new(null, Error: MissingUpload);
        }
        var file = form.Files.LastOrDefault(part => part.Name == "image");
        if (file is null || file.Length > MaxImageBytes) return new(null, Error: MissingUpload);
        if (file.Length == 0) return new(null, Error: OversizedUpload);

        string? offset = "0";
        foreach (var (key, value) in WorkspacePreviewEndpoint.QueryFields(request.QueryString))
            if (key == "offset") offset = value;
        foreach (var (key, values) in form)
        {
            if (key == "offset") offset = values.LastOrDefault();
            else if (key.StartsWith("offset[", StringComparison.Ordinal) && key.Contains(']')) offset = null;
        }
        var normalized = offset?.Trim(' ', '\t', '\n', '\r', '\v');
        var position = normalized is "0" or "+0" or "-0" ? 0L : WorkspacePreviewEndpoint.ParsePositiveId(normalized);
        var bytes = new byte[(int)file.Length];
        await using var stream = file.OpenReadStream();
        await stream.ReadExactlyAsync(bytes, context.RequestAborted);
        return new(bytes, position);
    }

    private static Upload DecodeBridgeUpload(string? image, long? offset)
    {
        if (image is null) return new(null, Error: MissingUpload);
        if (image.Length == 0 || image.Length > ((MaxImageBytes + 2) / 3) * 4)
            return new(null, Error: OversizedUpload);
        try
        {
            var bytes = Convert.FromBase64String(image);
            return bytes.Length is 0 or > MaxImageBytes ? new(null, Error: OversizedUpload) : new(bytes, offset);
        }
        catch (FormatException)
        {
            return new(null, Error: UnsupportedUpload);
        }
    }

    internal static async Task<IResult> HandlePublic(HttpContext context, long noteId, IConfiguration configuration,
        ILoggerFactory loggerFactory, AuthPreviewLimits limits)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.XContentTypeOptions = "nosniff";
        await context.Session.LoadAsync(context.RequestAborted);
        var identity = await AuthPreviewIdentity.Read(context, includeCorporateProfile: false);
        if (identity.Unavailable) return Error(503, "Сервис изображений временно недоступен.");
        if (identity.Personal is not { } session) return Unauthorized();

        var request = context.Request;
        var read = HttpMethods.IsGet(request.Method);
        var post = HttpMethods.IsPost(request.Method);
        if (!read && !post && !HttpMethods.IsDelete(request.Method))
        {
            context.Response.Headers.Allow = "GET, POST, DELETE";
            return Error(405, "Method not allowed");
        }
        if (post && !IsMultipart(request.ContentType))
            return Error(415, "Ожидается файл изображения.");
        if (post && request.ContentLength > MaxRequestBytes) return Error(413, OversizedUpload);
        if (!read && !SessionCsrf.IsValid(context))
            return Error(403, "Сессия истекла. Обновите страницу.");
        if (await limits.RejectWorkspaceAsync(context, session.Id, write: !read) is { } rejected) return rejected;

        new WorkspaceActor(session.Id, session.PasswordVersion).Attach(context);
        Upload? upload = null;
        if (post)
        {
            try
            {
                upload = await ReadMultipart(context);
            }
            catch (BadHttpRequestException exception) when (exception.StatusCode == 413)
            {
                return Error(413, OversizedUpload);
            }
        }
        return await Apply(context, configuration, loggerFactory, noteId, read ? "read" : post ? "upload" : "remove", upload);
    }

    private static async Task<IResult> Apply(HttpContext context, IConfiguration configuration,
        ILoggerFactory loggerFactory, long noteId, string action, Upload? upload)
    {
        var cancellation = context.RequestAborted;
        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString))
            return Error(503, "Сервис изображений временно недоступен.");
        var userId = WorkspaceActor.From(context).Id;

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            if (action == "read")
            {
                var version = WorkspaceActor.From(context).PasswordVersion;
                await using var read = new NpgsqlCommand(version is null
                    ? "SELECT TRUE, TRUE, n.image_data, n.image_mime " + NoteAccessSql
                    : DirectReadSql, connection);
                read.Parameters.AddWithValue("id", noteId);
                read.Parameters.AddWithValue("user_id", userId);
                if (version is long currentVersion) read.Parameters.AddWithValue("version", currentVersion);
                await using var image = await read.ExecuteReaderAsync(cancellation);
                if (!await image.ReadAsync(cancellation)) return MissingNote();
                if (!image.GetBoolean(0)) return Unauthorized();
                if (image.IsDBNull(1)) return MissingNote();
                if (image.IsDBNull(2)) return Error(404, "У заметки нет изображения.");
                var bytes = image.GetFieldValue<byte[]>(2);
                var mime = image.GetString(3);
                context.Response.Headers.ContentDisposition = "inline";
                context.Response.Headers.CacheControl = "private, no-store";
                context.Response.Headers.XContentTypeOptions = "nosniff";
                return Results.Bytes(bytes, mime);
            }

            await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellation);
            if (!await WorkspaceActor.From(context).CheckWriteSession(transaction, context.RequestAborted))
                return Unauthorized();
            long boardId;
            long ownerId;
            await using (var board = new NpgsqlCommand(
                "SELECT b.id, b.user_id " + NoteAccessSql + " FOR NO KEY UPDATE OF b", connection, transaction))
            {
                board.Parameters.AddWithValue("id", noteId);
                board.Parameters.AddWithValue("user_id", userId);
                await using var row = await board.ExecuteReaderAsync(cancellation);
                if (!await row.ReadAsync(cancellation)) return MissingNote();
                boardId = row.GetInt64(0);
                ownerId = row.GetInt64(1);
            }

            string body;
            await using (var note = new NpgsqlCommand(
                "SELECT body FROM notes WHERE id = @id AND board_id = @board AND user_id = @owner FOR UPDATE",
                connection, transaction))
            {
                note.Parameters.AddWithValue("id", noteId);
                note.Parameters.AddWithValue("board", boardId);
                note.Parameters.AddWithValue("owner", ownerId);
                if (await note.ExecuteScalarAsync(cancellation) is not string currentBody) return MissingNote();
                body = currentBody;
            }

            if (action == "remove")
            {
                await WriteImage(transaction, noteId, null, null, null, cancellation);
                await transaction.CommitAsync(cancellation);
                return Results.Json(new { success = true, data = new { removed = true } });
            }

            if (upload?.Bytes is not { } uploaded) return Error(422, upload?.Error ?? MissingUpload);
            var uploadedMime = ImageMime(uploaded);
            if (uploadedMime is null) return Error(422, UnsupportedUpload);
            if (upload.Offset is not >= 0) return Error(422, "Проверьте положение изображения в заметке.");
            var offset = (int)Math.Min(upload.Offset.Value, body.Length);
            await WriteImage(transaction, noteId, uploaded, uploadedMime, offset, cancellation);
            await transaction.CommitAsync(cancellation);
            return Results.Json(new
            {
                success = true,
                data = new { image = new { url = $"/api/notes/{noteId}/image", mime = uploadedMime, offset } }
            });
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            loggerFactory.CreateLogger(nameof(NoteImageEndpoint)).LogError(exception, "Note image request failed");
            return Error(503, "Сервис изображений временно недоступен.");
        }
    }

    private static async Task WriteImage(NpgsqlTransaction transaction, long noteId, byte[]? bytes, string? mime, int? offset,
        CancellationToken cancellation)
    {
        await using var update = new NpgsqlCommand("""
            UPDATE notes SET image_data = @bytes, image_mime = @mime, image_offset = @offset,
                updated_at = date_trunc('second', now()) WHERE id = @id
            """, transaction.Connection!, transaction);
        update.Parameters.AddWithValue("id", noteId);
        update.Parameters.Add("bytes", NpgsqlDbType.Bytea).Value = (object?)bytes ?? DBNull.Value;
        update.Parameters.Add("mime", NpgsqlDbType.Varchar).Value = (object?)mime ?? DBNull.Value;
        update.Parameters.Add("offset", NpgsqlDbType.Integer).Value = (object?)offset ?? DBNull.Value;
        await update.ExecuteNonQueryAsync(cancellation);
    }

    private static string? ImageMime(ReadOnlySpan<byte> bytes)
    {
        ReadOnlySpan<byte> png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        ReadOnlySpan<byte> jpeg = [0xff, 0xd8, 0xff];
        if (bytes.StartsWith(png)) return "image/png";
        if (bytes.StartsWith(jpeg)) return "image/jpeg";
        if (bytes.StartsWith("GIF87a"u8) || bytes.StartsWith("GIF89a"u8)) return "image/gif";
        if (bytes.Length < 12) return null;
        if (bytes.StartsWith("RIFF"u8) && bytes[8..12].SequenceEqual("WEBP"u8)) return "image/webp";
        if (!bytes[4..8].SequenceEqual("ftyp"u8)) return null;
        var brands = Encoding.ASCII.GetString(bytes.Slice(8, Math.Min(64, bytes.Length - 8)));
        if (HeicBrands.Any(brand => brands.Contains(brand, StringComparison.Ordinal))) return "image/heic";
        return brands.Contains("avif", StringComparison.Ordinal) || brands.Contains("avis", StringComparison.Ordinal)
            ? "image/avif" : null;
    }

    private static IResult MissingNote() => Error(404, "Заметка не найдена.");
    private static IResult Unauthorized() => Error(401, "Требуется войти в аккаунт.");

    private static IResult Error(int status, string error) =>
        Results.Json(new { success = false, error }, statusCode: status);

    private const string NoteAccessSql = """
        FROM notes n JOIN boards b ON b.id = n.board_id AND b.user_id = n.user_id
        WHERE n.id = @id AND (
            (b.user_id = @user_id AND b.corporate_account_id IS NULL)
            OR EXISTS (
                SELECT 1 FROM corporate_account_members m
                WHERE m.corporate_account_id = b.corporate_account_id
                  AND m.user_id = @user_id AND m.accepted_at IS NOT NULL
            )
        )
        """;

    private const string DirectReadSql = """
        SELECT requester.valid, image.found, image.image_data, image.image_mime
        FROM (SELECT EXISTS(SELECT 1 FROM users WHERE id = @user_id AND password_version = @version) AS valid) requester
        LEFT JOIN LATERAL (
            SELECT TRUE AS found, n.image_data, n.image_mime
        """ + "\n" + NoteAccessSql + """

            AND requester.valid
        ) image ON TRUE
        """;
}
