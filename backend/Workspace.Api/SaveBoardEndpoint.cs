using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Npgsql;
using NpgsqlTypes;

internal static class SaveBoardEndpoint
{
    private sealed record BoardInput(
        bool Update,
        [property: JsonPropertyName("board_id")] long? BoardId,
        [property: JsonPropertyName("corporate_account_id")] long? CorporateAccountId,
        [property: JsonPropertyName("board_type")] string? BoardType,
        string? Name,
        string? Description);

    public static async Task<IResult> Save(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory)
    {
        var cancellation = context.RequestAborted;
        BoardInput? input;
        try
        {
            input = await context.Request.ReadFromJsonAsync<BoardInput>(cancellation);
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
        var name = WorkspacePreviewEndpoint.Text(request, "name");
        var description = WorkspacePreviewEndpoint.Text(request, "description", "");
        if (name is null || name.Any(WorkspacePreviewEndpoint.IsControl) || description is null
            || description.EnumerateRunes().Count() > 2000)
            return Task.FromResult(Error(422, "Проверьте название, описание и тип доски."));

        return Save(context, configuration, loggerFactory, new BoardInput(update,
            WorkspacePreviewEndpoint.Id(request, "board_id"), WorkspacePreviewEndpoint.Id(request, "corporate_account_id"),
            WorkspacePreviewEndpoint.Text(request, "board_type", update ? null : "personal"),
            WorkspacePreviewEndpoint.Trim(name), WorkspacePreviewEndpoint.Trim(description)));
    }

    private static async Task<IResult> Save(HttpContext context, IConfiguration configuration,
        ILoggerFactory loggerFactory, BoardInput? input)
    {
        var cancellation = context.RequestAborted;
        if (input is null || (input.Update && input.BoardId is not > 0)
            || string.IsNullOrEmpty(input.Name) || input.Name.EnumerateRunes().Count() > 60
            || input.Name.Any(character => character < ' ' || character == '\u007f')
            || input.Description is null || input.Description.EnumerateRunes().Count() > 2000
            || input.BoardType is not ("personal" or "community" or "corporate"))
            return Error(422, "Проверьте название, описание и тип доски.");

        var organization = input.BoardType == "corporate" ? input.CorporateAccountId : null;
        if (!input.Update && input.BoardType == "corporate" && organization is not > 0)
            return Error(422, "Выберите организацию для корпоративной доски.");

        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString))
            return Error(503, "Сервис досок временно недоступен.");

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            await using var transaction = await connection.BeginTransactionAsync(cancellation);
            if (!await WorkspacePreviewEndpoint.CheckWriteSession(context, transaction))
                return Error(401, "Требуется войти в аккаунт.");
            await using var command = new NpgsqlCommand(input.Update ? UpdateSql : CreateSql, connection, transaction);
            command.Parameters.AddWithValue("user_id", (long)context.Items["WorkspaceUserId"]!);
            command.Parameters.AddWithValue("name", input.Name);
            command.Parameters.AddWithValue("description", input.Description);
            command.Parameters.AddWithValue("type", input.BoardType);
            if (input.Update)
                command.Parameters.AddWithValue("board_id", input.BoardId!.Value);
            else
                command.Parameters.Add("organization", NpgsqlDbType.Bigint).Value = (object?)organization ?? DBNull.Value;

            await using var reader = await command.ExecuteReaderAsync(cancellation);
            if (!await reader.ReadAsync(cancellation))
                return input.Update ? Error(404, "Доска не найдена.") : OwnerRequired();

            var status = reader.GetInt32(0);
            if (status == 403) return OwnerRequired();
            if (status == 422)
                return Error(status, reader.IsDBNull(2) ? "Нельзя преобразовать личную доску в корпоративную."
                    : "Тип доски организации нельзя изменить.");
            if (reader.IsDBNull(1)) return Error(404, "Доска не найдена.");

            var board = new
            {
                id = reader.GetInt64(1),
                name = input.Name,
                description = input.Description,
                board_type = input.BoardType,
                corporate_account_id = reader.IsDBNull(2) ? (long?)null : reader.GetInt64(2),
            };
            await reader.DisposeAsync();
            await transaction.CommitAsync(cancellation);
            return Results.Json(new { success = true, data = new { board } }, statusCode: status);
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return Error(409, "Это название уже используется. Выберите другое.");
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            loggerFactory.CreateLogger(nameof(SaveBoardEndpoint)).LogError(exception, "Board save failed");
            return Error(503, "Сервис досок временно недоступен.");
        }
    }

    private static IResult OwnerRequired() =>
        Error(403, "Только owner может управлять досками организации и приглашать участников.");

    private static IResult Error(int status, string error) =>
        Results.Json(new { success = false, error }, statusCode: status);

    private const string CreateSql = """
        WITH new_board AS (
            INSERT INTO boards (user_id, corporate_account_id, name, description, board_type)
            SELECT @user_id, @organization, @name, @description, @type
            WHERE CAST(@organization AS bigint) IS NULL OR EXISTS (
                SELECT 1 FROM corporate_account_members m
                WHERE m.corporate_account_id = @organization AND m.user_id = @user_id
                  AND m.accepted_at IS NOT NULL AND m.role = 'owner'
            )
            RETURNING id, user_id, corporate_account_id
        ), first_list AS (
            INSERT INTO task_lists (user_id, board_id, name, description)
            SELECT user_id, id, '👋 Hello World!', 'Это ваш первый список'
            FROM new_board RETURNING board_id
        )
        SELECT 201, b.id, b.corporate_account_id
        FROM new_board b JOIN first_list l ON l.board_id = b.id
        """;

    private const string UpdateSql = """
        WITH target AS MATERIALIZED (
            SELECT b.id, b.corporate_account_id,
                CASE
                    WHEN b.corporate_account_id IS NOT NULL AND m.role <> 'owner' THEN 403
                    WHEN (b.corporate_account_id IS NOT NULL) <> (@type = 'corporate') THEN 422
                    ELSE 200
                END AS status
            FROM boards b
            LEFT JOIN corporate_account_members m ON m.corporate_account_id = b.corporate_account_id
                AND m.user_id = @user_id AND m.accepted_at IS NOT NULL
            WHERE b.id = @board_id AND (
                (b.corporate_account_id IS NULL AND b.user_id = @user_id) OR m.user_id IS NOT NULL
            )
            FOR UPDATE OF b
        ), saved AS (
            UPDATE boards b SET name = @name, description = @description, board_type = @type
            FROM target t WHERE b.id = t.id AND t.status = 200
            RETURNING b.id
        )
        SELECT t.status, s.id, t.corporate_account_id
        FROM target t LEFT JOIN saved s ON s.id = t.id
        """;
}
