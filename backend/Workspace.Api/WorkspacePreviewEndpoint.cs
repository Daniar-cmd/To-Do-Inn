using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;
using Npgsql;

internal static class WorkspacePreviewEndpoint
{
    private const int BodyLimit = 8192;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    internal static async Task<IResult> Handle(HttpContext context, IConfiguration configuration,
        ILoggerFactory loggerFactory, AuthPreviewLimits limits)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.XContentTypeOptions = "nosniff";
        await context.Session.LoadAsync(context.RequestAborted);
        var identity = await AuthPreviewIdentity.Read(context, includeCorporateProfile: false);
        if (identity.Unavailable) return Error(503, "Рабочее пространство временно недоступно.");
        if (identity.Personal is not { } session) return Error(401, "Требуется войти в аккаунт.");
        var request = context.Request;
        if (HttpMethods.IsGet(request.Method))
        {
            if (await limits.RejectWorkspaceAsync(context, session.Id) is { } rejected) return rejected;
            var (board, search, _) = ReadQuery(request.QueryString);
            return await WorkspaceReadEndpoint.ReadForUser(session.Id, session.PasswordVersion, ParsePositiveId(board), search,
                configuration, loggerFactory, context.RequestAborted);
        }
        var post = HttpMethods.IsPost(request.Method);
        if (!post && !HttpMethods.IsDelete(request.Method))
        {
            context.Response.Headers.Allow = "GET, POST, DELETE";
            return Error(405, "Method not allowed");
        }
        if (post && !AuthPreviewEndpoint.IsJson(request.ContentType))
            return Error(415, "Expected a JSON request");
        if (!AuthPreviewEndpoint.HasValidCsrf(context))
            return Error(403, "Сессия истекла. Обновите страницу.");
        context.Items["WorkspaceUserId"] = session.Id;
        context.Items["WorkspacePasswordVersion"] = session.PasswordVersion;
        if (!post)
        {
            if (await limits.RejectWorkspaceAsync(context, session.Id, write: true) is { } rejected) return rejected;
            var (board, _, list) = ReadQuery(request.QueryString);
            return await DeleteWorkspaceEndpoint.DeleteFromQuery(context, configuration, loggerFactory,
                board is not null, ParsePositiveId(board ?? list) ?? 0);
        }
        if (request.ContentLength > BodyLimit) return Error(413, "Request is too large");

        var buffer = new byte[BodyLimit + 1];
        var length = await request.Body.ReadAtLeastAsync(buffer, buffer.Length, throwOnEndOfStream: false,
            cancellationToken: context.RequestAborted);
        if (length > BodyLimit) return Error(413, "Request is too large");
        JsonDocument document;
        try
        {
            _ = StrictUtf8.GetCharCount(buffer.AsSpan(0, length));
            ValidateEscapedStrings(buffer.AsSpan(0, length));
            document = JsonDocument.Parse(buffer.AsMemory(0, length), new JsonDocumentOptions { MaxDepth = 511 });
        }
        catch (Exception exception) when (exception is JsonException or DecoderFallbackException or InvalidOperationException)
        {
            return Error(400, "Invalid JSON request");
        }

        using (document)
        {
            var input = document.RootElement;
            if (input.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array))
                return Error(400, "Invalid JSON request");
            var action = input.ValueKind == JsonValueKind.Object ? Text(input, "action") : null;
            if (await limits.RejectWorkspaceAsync(context, session.Id, write: true, invite: action == "invite_member") is { } rejected)
                return rejected;
            return action switch
            {
                "create_task" => await CreateTaskEndpoint.CreateFromInput(context, configuration, loggerFactory, input),
                "update_task" or "toggle_task" => await TaskEndpoints.ChangeTask(context, configuration, loggerFactory, action, input),
                "move_task" or "reorder_task" => await MoveReorderTaskEndpoint.ChangeOrder(context, configuration, loggerFactory, action, input),
                "delete_task" or "stop_task_repeat" => await TaskLifecycleEndpoint.Change(context, configuration, loggerFactory, action, input),
                "create_board" or "update_board" => await SaveBoardEndpoint.SaveFromRequest(context, configuration, loggerFactory, input, action == "update_board"),
                "create_list" or "update_list" => await SaveListEndpoint.SaveFromRequest(context, configuration, loggerFactory, input, action == "update_list"),
                "create_note" or "update_note" => await SaveNoteEndpoint.SaveFromRequest(context, configuration, loggerFactory, input, action == "update_note"),
                "set_note_pinned" or "set_list_pinned" or "reorder_workspace_item" or "reorder_list"
                    => await CardLayoutEndpoint.ChangeFromRequest(context, configuration, loggerFactory, input, action),
                "create_flag" => await CreateFlagEndpoint.CreateFromRequest(context, configuration, loggerFactory, input),
                "invite_member" => await InviteMemberEndpoint.InviteFromRequest(context, configuration, loggerFactory, input),
                _ => Error(400, "Unknown action"),
            };
        }
    }

    // JsonDocument validates escaped surrogate pairs only when a string is read.
    private static void ValidateEscapedStrings(ReadOnlySpan<byte> json)
    {
        if (!json.Contains((byte)'\\')) return;
        var reader = new Utf8JsonReader(json, new JsonReaderOptions { MaxDepth = 511 });
        while (reader.Read())
            if (reader.ValueIsEscaped && reader.TokenType is JsonTokenType.String or JsonTokenType.PropertyName)
                _ = reader.GetString();
    }

    private static (string? Board, string Search, string? List) ReadQuery(QueryString query)
    {
        string? board = null;
        string? search = null;
        string? list = null;
        foreach (var (key, value) in QueryFields(query))
        {
            switch (key)
            {
                case "board_id": board = value ?? ""; break;
                case "search": search = value; break;
                case "list_id": list = value; break;
            }
        }

        return (board, Trim(search ?? ""), list);
    }

    internal static IEnumerable<(string Key, string? Value)> QueryFields(QueryString query)
    {
        // PHP keeps the last scalar value, treats bracket parameters as arrays and preserves key casing.
        foreach (var parameter in new QueryStringEnumerable(query.Value))
        {
            var name = parameter.DecodeName().ToString().TrimStart(' ');
            var bracket = name.IndexOf('[');
            var array = bracket >= 0 && name.IndexOf(']', bracket) >= 0;
            var key = (array ? name[..bracket] : name.Replace('[', '_')).Replace(' ', '_').Replace('.', '_');
            yield return (key, array ? null : parameter.DecodeValue().ToString());
        }
    }

    internal static async Task<bool> CheckWriteSession(HttpContext context, NpgsqlTransaction transaction)
    {
        if (context.Items["WorkspacePasswordVersion"] is not long version) return true;
        await using var writer = new NpgsqlCommand(
            "SELECT password_version FROM users WHERE id = @id FOR NO KEY UPDATE", transaction.Connection!, transaction);
        writer.Parameters.AddWithValue("id", (long)context.Items["WorkspaceUserId"]!);
        return await writer.ExecuteScalarAsync(context.RequestAborted) is long actual && actual == version;
    }

    internal static string? Text(JsonElement input, string key, string? fallback = null) =>
        !input.TryGetProperty(key, out var value) || value.ValueKind == JsonValueKind.Null ? fallback
            : value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    internal static long? Id(JsonElement input, string key, long? invalid = null) =>
        !input.TryGetProperty(key, out var value) || value.ValueKind == JsonValueKind.Null ? null
            : TaskEndpoints.TryId(value, out var id) ? id : invalid;

    internal static bool? Important(JsonElement input) =>
        !input.TryGetProperty("is_important", out var value) || value.ValueKind == JsonValueKind.Null ? false
            : value.ValueKind is JsonValueKind.True or JsonValueKind.False ? value.GetBoolean() : null;

    internal static string Trim(string value) => value.Trim(' ', '\t', '\n', '\r', '\v', '\0');
    internal static bool IsControl(char value) => value < ' ' || value == '\u007f';
    internal static bool ValidTheme(string? theme) => theme is "blue" or "violet" or "green" or "amber" or "rose" or "sky";

    internal static long? ParsePositiveId(string? value)
    {
        if (value is null) return null;
        var digits = value.AsSpan().Trim(" \t\n\r\v");
        if (digits.StartsWith("+")) digits = digits[1..];
        return digits.Length > 0 && digits[0] is >= '1' and <= '9' && digits.IndexOfAnyExceptInRange('0', '9') < 0
            && long.TryParse(digits, NumberStyles.None, CultureInfo.InvariantCulture, out var id) ? id : null;
    }

    private static IResult Error(int status, string error) => Results.Json(new { success = false, error }, statusCode: status);
}
