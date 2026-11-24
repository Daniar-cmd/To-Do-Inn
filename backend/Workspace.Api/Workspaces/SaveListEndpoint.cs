using System.Data;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Npgsql;
using NpgsqlTypes;
using Workspace.Api.Workspaces.Tasks;

namespace Workspace.Api.Workspaces;

internal static class SaveListEndpoint
{
    private sealed record ListInput(
        bool Update,
        [property: JsonPropertyName("list_id")] long? ListId,
        [property: JsonPropertyName("board_id")] long? BoardId,
        string? Name, string? Description, string? Theme,
        [property: JsonPropertyName("is_important")] bool Important,
        [property: JsonPropertyName("new_flag_name")] string? NewFlagName,
        [property: JsonPropertyName("flag_id")] long? FlagId,
        [property: JsonPropertyName("has_due_date")] bool HasDueDate,
        [property: JsonPropertyName("due_date")] DateOnly? DueDate);

    internal sealed record Flag(long Id, string Name, string Color);

    public static async Task<IResult> Save(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory)
    {
        var cancellation = context.RequestAborted;
        ListInput? input;
        try
        {
            input = await context.Request.ReadFromJsonAsync<ListInput>(cancellation);
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
        var rawName = WorkspacePreviewEndpoint.Text(request, "name");
        var name = rawName is null ? "" : WorkspacePreviewEndpoint.Trim(rawName);
        if (!update && (name.Length == 0 || rawName!.Any(WorkspacePreviewEndpoint.IsControl)))
            return Task.FromResult(Error(422, "Введите название списка."));
        if (!update && name.EnumerateRunes().Count() > 80)
            return Task.FromResult(Error(422, "Название списка должно быть не длиннее 80 символов."));
        var id = WorkspacePreviewEndpoint.Id(request, update ? "list_id" : "board_id");
        var important = WorkspacePreviewEndpoint.Important(request);
        var theme = WorkspacePreviewEndpoint.Text(request, "theme", "blue");
        var description = update ? WorkspacePreviewEndpoint.Text(request, "description", "") : "";
        var rawFlag = WorkspacePreviewEndpoint.Text(request, "new_flag_name", "");
        if (id is null || important is null || !WorkspacePreviewEndpoint.ValidTheme(theme)
            || name.Length == 0 || name.EnumerateRunes().Count() > 80
            || description is null || description.EnumerateRunes().Count() > 2000 || update && rawFlag is null)
            return Task.FromResult(Error(422, "Проверьте настройки списка."));
        if (rawFlag is null) return Task.FromResult(Error(422, "Проверьте название флага."));
        var newFlag = WorkspacePreviewEndpoint.Trim(rawFlag);
        var flagId = WorkspacePreviewEndpoint.Id(request, "flag_id", invalid: 0);
        if (!update && newFlag.Length > 0 && flagId is not null)
            return Task.FromResult(Error(422, "Выберите существующий флаг или создайте новый."));
        if (newFlag.EnumerateRunes().Count() > 40 || newFlag.Any(WorkspacePreviewEndpoint.IsControl))
            return Task.FromResult(Error(422, "Название флага должно быть не длиннее 40 символов."));
        if (newFlag.Length > 0 && flagId is not null)
            return Task.FromResult(Error(422, "Выберите существующий флаг или создайте новый."));

        DateOnly? date = null;
        var hasDate = request.TryGetProperty("due_date", out var due);
        if (hasDate && due.ValueKind != JsonValueKind.Null)
        {
            if (due.ValueKind != JsonValueKind.String || !CreateTaskEndpoint.TryCurrentDate(due.GetString()!, out var parsed))
                return Task.FromResult(Error(422, "Выберите корректную дату, не раньше сегодняшнего дня."));
            date = parsed;
        }

        return Save(context, configuration, loggerFactory, new ListInput(update, update ? id : null, update ? null : id,
            name, WorkspacePreviewEndpoint.Trim(description), theme, important.Value, newFlag, flagId, hasDate, date));
    }

    private static async Task<IResult> Save(HttpContext context, IConfiguration configuration,
        ILoggerFactory loggerFactory, ListInput? input)
    {
        var cancellation = context.RequestAborted;
        if (input is null || (input.Update ? input.ListId : input.BoardId) is not > 0
            || string.IsNullOrEmpty(input.Name) || input.Name.EnumerateRunes().Count() > 80
            || input.Description is null || input.Description.EnumerateRunes().Count() > 2000
            || input.Theme is not ("blue" or "violet" or "green" or "amber" or "rose" or "sky"))
            return Error(422, "Проверьте настройки списка.");

        var newFlag = input.NewFlagName ?? "";
        if (newFlag.EnumerateRunes().Count() > 40 || newFlag.Any(character => character < ' ' || character == '\u007f'))
            return Error(422, "Название флага должно быть не длиннее 40 символов.");
        if (newFlag.Length > 0 && input.FlagId is not null)
            return Error(422, "Выберите существующий флаг или создайте новый.");

        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString))
            return Error(503, "Сервис списков временно недоступен.");

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellation);
            if (!await WorkspaceActor.From(context).CheckWriteSession(transaction, context.RequestAborted))
                return Error(401, "Требуется войти в аккаунт.");
            var userId = WorkspaceActor.From(context).Id;
            var targetId = (input.Update ? input.ListId : input.BoardId)!.Value;
            if (input.Update)
            {
                await using var listLock = new NpgsqlCommand("SELECT pg_advisory_xact_lock(@id)", connection, transaction);
                listLock.Parameters.AddWithValue("id", targetId);
                await listLock.ExecuteNonQueryAsync(cancellation);
            }

            long boardId;
            long ownerId;
            long? previousFlag;
            await using (var find = new NpgsqlCommand(input.Update ? FindListSql : FindBoardSql, connection, transaction))
            {
                find.Parameters.AddWithValue("id", targetId);
                find.Parameters.AddWithValue("user_id", userId);
                await using var reader = await find.ExecuteReaderAsync(cancellation);
                if (!await reader.ReadAsync(cancellation))
                    return Error(404, input.Update ? "Список не найден." : "Рабочая доска не найдена.");
                boardId = reader.GetInt64(0);
                ownerId = reader.GetInt64(1);
                previousFlag = reader.IsDBNull(2) ? null : reader.GetInt64(2);
            }

            if (input.FlagId is <= 0) return Error(422, "Проверьте выбранный флаг.");
            var flag = await ResolveFlag(transaction, boardId, ownerId, input.FlagId, newFlag, cancellation);
            if (input.FlagId is not null && flag is null) return Error(404, "Флаг не найден.");

            await using var save = new NpgsqlCommand(input.Update ? UpdateSql : CreateSql, connection, transaction);
            save.Parameters.AddWithValue("name", input.Name);
            save.Parameters.AddWithValue("theme", input.Theme);
            save.Parameters.AddWithValue("important", input.Important);
            save.Parameters.Add("flag_id", NpgsqlDbType.Bigint).Value = (object?)flag?.Id ?? DBNull.Value;
            save.Parameters.Add("due_date", NpgsqlDbType.Date).Value = (object?)input.DueDate ?? DBNull.Value;
            if (input.Update)
            {
                save.Parameters.AddWithValue("id", targetId);
                save.Parameters.AddWithValue("description", input.Description);
                save.Parameters.AddWithValue("has_due_date", input.HasDueDate);
            }
            else
            {
                save.Parameters.AddWithValue("board_id", boardId);
                save.Parameters.AddWithValue("owner", ownerId);
            }
            var id = (long)(await save.ExecuteScalarAsync(cancellation))!;

            if (previousFlag is long oldFlag && oldFlag != flag?.Id)
                await DeleteWorkspaceEndpoint.DeleteUnusedFlags(transaction, boardId, ownerId, [oldFlag], cancellation);

            await transaction.CommitAsync(cancellation);
            if (input.Update)
                return Results.Json(new
                {
                    success = true,
                    data = new { updated = true, flag = flag is null ? null : new { id = flag.Id, board_id = boardId, name = flag.Name, color = flag.Color } }
                });

            var list = new
            {
                id, name = input.Name, is_important = input.Important, theme = input.Theme,
                due_date = input.DueDate, flag = flag is null ? null : new { id = flag.Id, name = flag.Name, color = flag.Color }
            };
            return Results.Json(new { success = true, data = new { list } }, statusCode: 201);
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return Error(409, "Это название уже используется. Выберите другое.");
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            loggerFactory.CreateLogger(nameof(SaveListEndpoint)).LogError(exception, "List save failed");
            return Error(503, "Сервис списков временно недоступен.");
        }
    }

    internal static async Task<Flag?> ResolveFlag(NpgsqlTransaction transaction, long boardId, long ownerId, long? flagId,
        string newFlag, CancellationToken cancellation)
    {
        if (flagId is null && newFlag.Length == 0) return null;
        const string insert = """
            INSERT INTO user_flags (board_id, user_id, name) VALUES (@board, @owner, @name)
            RETURNING id, name, color
            """;
        const string select = """
            SELECT id, name, color FROM user_flags
            WHERE id = @flag AND board_id = @board AND user_id = @owner FOR KEY SHARE
            """;
        await using var command = new NpgsqlCommand(flagId is null ? insert : select, transaction.Connection!, transaction);
        command.Parameters.AddWithValue("board", boardId);
        command.Parameters.AddWithValue("owner", ownerId);
        if (flagId is long selected)
            command.Parameters.AddWithValue("flag", selected);
        else
            command.Parameters.AddWithValue("name", newFlag);
        await using var reader = await command.ExecuteReaderAsync(cancellation);
        return await reader.ReadAsync(cancellation) ? new Flag(reader.GetInt64(0), reader.GetString(1), reader.GetString(2)) : null;
    }

    private static IResult Error(int status, string error) =>
        Results.Json(new { success = false, error }, statusCode: status);

    private const string BoardAccess = """
        ((b.user_id = @user_id AND b.corporate_account_id IS NULL) OR EXISTS (
            SELECT 1 FROM corporate_account_members m
            WHERE m.corporate_account_id = b.corporate_account_id
              AND m.user_id = @user_id AND m.accepted_at IS NOT NULL
        ))
        """;

    private const string FindBoardSql =
        "SELECT b.id, b.user_id, NULL::bigint FROM boards b WHERE b.id = @id AND "
        + BoardAccess + " FOR UPDATE OF b";

    private const string FindListSql = """
        SELECT b.id, b.user_id, l.flag_id FROM task_lists l
        JOIN boards b ON b.id = l.board_id AND b.user_id = l.user_id
        WHERE l.id = @id AND
        """ + " " + BoardAccess + " FOR UPDATE OF l";

    private const string CreateSql = """
        INSERT INTO task_lists (user_id, board_id, name, theme, flag_id, is_important, due_date, sort_order)
        SELECT @owner, @board_id, @name, @theme, @flag_id, @important, @due_date,
            COALESCE(LEAST(
                (SELECT MIN(sort_order) FROM task_lists WHERE board_id = @board_id),
                (SELECT MIN(sort_order) FROM notes WHERE board_id = @board_id)
            ), 0) - 1
        RETURNING id
        """;

    private const string UpdateSql = """
        UPDATE task_lists SET name = @name, description = @description, theme = @theme, flag_id = @flag_id,
            is_important = @important, due_date = CASE WHEN @has_due_date THEN @due_date ELSE due_date END
        WHERE id = @id RETURNING id
        """;
}
