using System.Data;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Npgsql;
using NpgsqlTypes;

internal static class SaveNoteEndpoint
{
    private sealed record NoteInput(
        [property: JsonPropertyName("note_id")] long? NoteId,
        [property: JsonPropertyName("board_id")] long? BoardId,
        string? Title, string? Body, string? Annotation, string? Theme,
        [property: JsonPropertyName("is_important")] bool Important,
        [property: JsonPropertyName("new_flag_name")] string? NewFlagName,
        [property: JsonPropertyName("flag_id")] long? FlagId);

    public static async Task<IResult> Save(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory)
    {
        var cancellation = context.RequestAborted;
        NoteInput? input;
        try
        {
            input = await context.Request.ReadFromJsonAsync<NoteInput>(cancellation);
        }
        catch (JsonException)
        {
            return Error(400, "Invalid JSON request");
        }
        return await Save(context, configuration, loggerFactory, input);
    }

    internal static Task<IResult> SaveFromRequest(HttpContext context, IConfiguration configuration,
        ILoggerFactory loggerFactory, JsonElement request, bool update)
    {
        var id = WorkspacePreviewEndpoint.Id(request, update ? "note_id" : "board_id");
        var rawTitle = WorkspacePreviewEndpoint.Text(request, "title");
        var title = rawTitle is null ? "" : WorkspacePreviewEndpoint.Trim(rawTitle);
        if (id is null || title.Length == 0 || title.EnumerateRunes().Count() > 80 || rawTitle!.Any(IsControl))
            return Task.FromResult(Error(422, update ? "Проверьте настройки заметки."
                : "Введите корректное название заметки длиной до 80 символов."));
        var body = WorkspacePreviewEndpoint.Text(request, "body", "");
        var annotation = WorkspacePreviewEndpoint.Text(request, "annotation", "");
        var important = WorkspacePreviewEndpoint.Important(request);
        var theme = WorkspacePreviewEndpoint.Text(request, "theme", "blue");
        var newFlag = update ? "" : WorkspacePreviewEndpoint.Text(request, "new_flag_name", "");
        if (!ValidText(body, 1200) || !ValidText(annotation, 200) || important is null
            || !WorkspacePreviewEndpoint.ValidTheme(theme) || newFlag is null)
            return Task.FromResult(Error(422, update ? "Проверьте настройки заметки." : "Проверьте текст заметки и её оформление."));

        return Save(context, configuration, loggerFactory, new NoteInput(update ? id : null, update ? null : id,
            title, body, WorkspacePreviewEndpoint.Trim(annotation!), theme, important.Value,
            WorkspacePreviewEndpoint.Trim(newFlag), WorkspacePreviewEndpoint.Id(request, "flag_id", invalid: 0)));
    }

    private static async Task<IResult> Save(HttpContext context, IConfiguration configuration,
        ILoggerFactory loggerFactory, NoteInput? input)
    {
        var cancellation = context.RequestAborted;
        if (input is null) return Error(400, "Invalid JSON request");

        var update = input.NoteId is not null;
        if ((update ? input.NoteId : input.BoardId) is not > 0
            || string.IsNullOrEmpty(input.Title) || input.Title.EnumerateRunes().Count() > 80
            || input.Title.Any(IsControl))
            return Error(422, update ? "Проверьте настройки заметки."
                : "Введите корректное название заметки длиной до 80 символов.");
        if (!ValidText(input.Body, 1200) || !ValidText(input.Annotation, 200)
            || input.Theme is not ("blue" or "violet" or "green" or "amber" or "rose" or "sky"))
            return Error(422, update ? "Проверьте настройки заметки." : "Проверьте текст заметки и её оформление.");

        var newFlag = update ? "" : input.NewFlagName ?? "";
        if (newFlag.EnumerateRunes().Count() > 40 || newFlag.Any(IsControl))
            return Error(422, "Название флага должно быть не длиннее 40 символов.");
        if (newFlag.Length > 0 && input.FlagId is not null)
            return Error(422, "Выберите существующий флаг или создайте новый.");

        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString))
            return Error(503, "Сервис заметок временно недоступен.");

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellation);
            if (!await WorkspacePreviewEndpoint.CheckWriteSession(context, transaction))
                return Error(401, "Требуется войти в аккаунт.");

            long boardId;
            long ownerId;
            await using (var board = new NpgsqlCommand(FindBoardSql, connection, transaction))
            {
                board.Parameters.AddWithValue("user_id", (long)context.Items["WorkspaceUserId"]!);
                board.Parameters.Add("board_id", NpgsqlDbType.Bigint).Value = (object?)input.BoardId ?? DBNull.Value;
                board.Parameters.Add("note_id", NpgsqlDbType.Bigint).Value = (object?)input.NoteId ?? DBNull.Value;
                await using var reader = await board.ExecuteReaderAsync(cancellation);
                if (!await reader.ReadAsync(cancellation))
                    return Error(404, update ? "Заметка не найдена." : "Рабочая доска не найдена.");
                boardId = reader.GetInt64(0);
                ownerId = reader.GetInt64(1);
            }

            long? previousFlag = null;
            if (input.NoteId is long noteId)
            {
                await using var find = new NpgsqlCommand(FindNoteSql, connection, transaction);
                find.Parameters.AddWithValue("id", noteId);
                find.Parameters.AddWithValue("board_id", boardId);
                find.Parameters.AddWithValue("owner", ownerId);
                await using var reader = await find.ExecuteReaderAsync(cancellation);
                if (!await reader.ReadAsync(cancellation)) return Error(404, "Заметка не найдена.");
                if (!reader.IsDBNull(0)) previousFlag = reader.GetInt64(0);
            }

            if (input.FlagId is <= 0 && !update) return Error(422, "Проверьте выбранный флаг.");
            var flag = await SaveListEndpoint.ResolveFlag(transaction, boardId, ownerId, input.FlagId, newFlag, cancellation);
            if (input.FlagId is not null && flag is null) return Error(404, "Флаг не найден.");

            await using var save = new NpgsqlCommand(update ? UpdateSql : CreateSql, connection, transaction);
            save.Parameters.AddWithValue("title", input.Title);
            save.Parameters.AddWithValue("body", input.Body!);
            save.Parameters.AddWithValue("annotation", input.Annotation!);
            save.Parameters.AddWithValue("important", input.Important);
            save.Parameters.AddWithValue("theme", input.Theme);
            save.Parameters.Add("flag_id", NpgsqlDbType.Bigint).Value = (object?)flag?.Id ?? DBNull.Value;
            if (input.NoteId is long existingId)
            {
                save.Parameters.AddWithValue("id", existingId);
                // The client stores the image position in UTF-16 code units.
                save.Parameters.AddWithValue("body_length", input.Body!.Length);
                await save.ExecuteNonQueryAsync(cancellation);
                if (previousFlag is long oldFlag && oldFlag != flag?.Id)
                    await DeleteWorkspaceEndpoint.DeleteUnusedFlags(transaction, boardId, ownerId, [oldFlag], cancellation);
                await transaction.CommitAsync(cancellation);
                return Results.Json(new { success = true, data = new { updated = true } });
            }

            save.Parameters.AddWithValue("board_id", boardId);
            save.Parameters.AddWithValue("owner", ownerId);
            long id;
            string createdAt;
            long sortOrder;
            bool pinned;
            await using (var reader = await save.ExecuteReaderAsync(cancellation))
            {
                if (!await reader.ReadAsync(cancellation))
                    throw new InvalidOperationException("Note insert did not return its row.");
                id = reader.GetInt64(0);
                createdAt = reader.GetString(1);
                sortOrder = reader.GetInt64(2);
                pinned = reader.GetBoolean(3);
            }
            await transaction.CommitAsync(cancellation);
            var note = new
            {
                id, board_id = boardId, title = input.Title, body = input.Body, annotation = input.Annotation,
                created_at = createdAt, is_important = input.Important, theme = input.Theme,
                is_pinned = pinned, sort_order = sortOrder, image = (object?)null,
                flag = flag is null ? null : new { id = flag.Id, name = flag.Name, color = flag.Color },
            };
            return Results.Json(new { success = true, data = new { note } }, statusCode: 201);
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return Error(409, "Это название уже используется. Выберите другое.");
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            loggerFactory.CreateLogger(nameof(SaveNoteEndpoint)).LogError(exception, "Note save failed");
            return Error(503, "Сервис заметок временно недоступен.");
        }
    }

    private static bool IsControl(char value) => value < ' ' || value == '\u007f';

    private static bool ValidText(string? value, int limit) =>
        value is not null && value.EnumerateRunes().Count() <= limit
        && !value.Any(character => IsControl(character) && character is not ('\t' or '\n' or '\r'));

    private static IResult Error(int status, string error) =>
        Results.Json(new { success = false, error }, statusCode: status);

    private const string FindBoardSql = """
        SELECT b.id, b.user_id
        FROM boards b
        WHERE b.id = CASE WHEN CAST(@note_id AS bigint) IS NULL THEN @board_id ELSE (
            SELECT n.board_id FROM notes n WHERE n.id = @note_id
        ) END AND (
            (b.user_id = @user_id AND b.corporate_account_id IS NULL)
            OR EXISTS (
                SELECT 1 FROM corporate_account_members m
                WHERE m.corporate_account_id = b.corporate_account_id
                  AND m.user_id = @user_id AND m.accepted_at IS NOT NULL
            )
        )
        FOR NO KEY UPDATE OF b
        """;

    private const string FindNoteSql = """
        SELECT flag_id FROM notes WHERE id = @id AND board_id = @board_id AND user_id = @owner FOR UPDATE
        """;

    private const string CreateSql = """
        INSERT INTO notes (user_id, board_id, flag_id, title, body, annotation, is_important, theme, sort_order)
        SELECT @owner, @board_id, @flag_id, @title, @body, @annotation, @important, @theme,
            COALESCE(LEAST(
                (SELECT MIN(sort_order) FROM task_lists WHERE board_id = @board_id),
                (SELECT MIN(sort_order) FROM notes WHERE board_id = @board_id)
            ), 0) - 1
        RETURNING id, created_at::text, sort_order, is_pinned
        """;

    private const string UpdateSql = """
        UPDATE notes SET title = @title, body = @body, annotation = @annotation, is_important = @important,
            theme = @theme, flag_id = @flag_id, updated_at = date_trunc('second', now()),
            image_offset = CASE WHEN image_data IS NOT NULL THEN LEAST(image_offset, @body_length) ELSE image_offset END
        WHERE id = @id
        """;
}
