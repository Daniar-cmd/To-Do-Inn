using System.Data;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace Workspace.Api.Workspaces;

internal static class DeleteWorkspaceEndpoint
{
    private sealed record DeleteInput(long Id, bool Board);

    public static async Task<IResult> Delete(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory)
    {
        var cancellation = context.RequestAborted;
        DeleteInput? input;
        try
        {
            input = await context.Request.ReadFromJsonAsync<DeleteInput>(cancellation);
        }
        catch (JsonException)
        {
            return Error(400, "Invalid JSON request");
        }
        if (input is null) return Error(400, "Invalid JSON request");
        return await DeleteFromQuery(context, configuration, loggerFactory, input.Board, input.Id);
    }

    internal static async Task<IResult> DeleteFromQuery(HttpContext context, IConfiguration configuration,
        ILoggerFactory loggerFactory, bool board, long id)
    {
        var cancellation = context.RequestAborted;
        if (id <= 0) return Error(422, board ? "Некорректная доска." : "Некорректный список.");

        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString))
            return Error(503, "Рабочее пространство временно недоступно.");

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellation);
            if (!await WorkspaceActor.From(context).CheckWriteSession(transaction, context.RequestAborted))
                return Error(401, "Требуется войти в аккаунт.");
            var userId = WorkspaceActor.From(context).Id;
            return board
                ? await DeleteBoard(transaction, id, userId, cancellation)
                : await DeleteList(transaction, id, userId, cancellation);
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return Error(409, "Это название уже используется. Выберите другое.");
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            loggerFactory.CreateLogger(nameof(DeleteWorkspaceEndpoint)).LogError(exception, "Workspace deletion failed");
            return Error(503, "Рабочее пространство временно недоступно.");
        }
    }

    private static async Task<IResult> DeleteBoard(NpgsqlTransaction transaction, long boardId, long userId,
        CancellationToken cancellation)
    {
        long? organizationId;
        bool isDefault;
        await using (var find = Command(transaction, FindBoardSql, ("id", boardId), ("user_id", userId)))
        await using (var row = await find.ExecuteReaderAsync(cancellation))
        {
            if (!await row.ReadAsync(cancellation)) return Error(404, "Доска не найдена.");
            organizationId = row.IsDBNull(0) ? null : row.GetInt64(0);
            isDefault = row.GetBoolean(1);
            if (organizationId is not null && (row.IsDBNull(2) || row.GetString(2) != "owner"))
                return Error(403, "Только owner может управлять досками организации и приглашать участников.");
        }

        await using var replacementQuery = Command(transaction, ReplacementSql, ("id", boardId), ("user_id", userId));
        replacementQuery.Parameters.Add("organization", NpgsqlDbType.Bigint).Value = (object?)organizationId ?? DBNull.Value;
        if (await replacementQuery.ExecuteScalarAsync(cancellation) is not long replacement)
            return Error(409, "Нельзя удалить последнюю доску.");

        await using (var delete = Command(transaction, "DELETE FROM boards WHERE id = @id", ("id", boardId)))
            await delete.ExecuteNonQueryAsync(cancellation);
        if (isDefault)
        {
            await using var promote = Command(transaction, "UPDATE boards SET is_default = true WHERE id = @id", ("id", replacement));
            await promote.ExecuteNonQueryAsync(cancellation);
        }

        await transaction.CommitAsync(cancellation);
        return Results.Json(new { success = true, data = new { deleted = true, replacement_board_id = replacement } });
    }

    private static async Task<IResult> DeleteList(NpgsqlTransaction transaction, long listId, long userId,
        CancellationToken cancellation)
    {
        // Share the ordering lock used by task creation, moves and repeat generation.
        await using (var listLock = Command(transaction, "SELECT pg_advisory_xact_lock(@id)", ("id", listId)))
            await listLock.ExecuteNonQueryAsync(cancellation);

        long boardId;
        long ownerId;
        await using (var find = Command(transaction, FindListSql, ("id", listId), ("user_id", userId)))
        await using (var row = await find.ExecuteReaderAsync(cancellation))
        {
            if (!await row.ReadAsync(cancellation)) return Error(404, "Список не найден.");
            boardId = row.GetInt64(0);
            ownerId = row.GetInt64(1);
        }

        await using var findFlags = Command(transaction, FindFlagsSql, ("id", listId));
        var flagIds = (long[])(await findFlags.ExecuteScalarAsync(cancellation))!;
        await using (var delete = Command(transaction, "DELETE FROM task_lists WHERE id = @id", ("id", listId)))
            await delete.ExecuteNonQueryAsync(cancellation);
        if (flagIds.Length > 0) await DeleteUnusedFlags(transaction, boardId, ownerId, flagIds, cancellation);

        await transaction.CommitAsync(cancellation);
        return Results.Json(new { success = true, data = new { deleted = true } });
    }

    internal static async Task DeleteUnusedFlags(NpgsqlTransaction transaction, long boardId, long ownerId, long[] flagIds,
        CancellationToken cancellation)
    {
        // Wait for any in-flight FK references, then check usage in a fresh snapshot.
        await using (var lockFlags = Command(transaction, LockFlagsSql, ("board_id", boardId), ("owner", ownerId)))
        {
            lockFlags.Parameters.AddWithValue("flags", flagIds);
            await lockFlags.ExecuteNonQueryAsync(cancellation);
        }
        await using var cleanup = Command(transaction, CleanupFlagsSql, ("board_id", boardId), ("owner", ownerId));
        cleanup.Parameters.AddWithValue("flags", flagIds);
        await cleanup.ExecuteNonQueryAsync(cancellation);
    }

    private static NpgsqlCommand Command(NpgsqlTransaction transaction, string sql, params (string Name, long Value)[] args)
    {
        var command = new NpgsqlCommand(sql, transaction.Connection!, transaction);
        foreach (var (name, value) in args) command.Parameters.AddWithValue(name, value);
        return command;
    }

    private static IResult Error(int status, string error) =>
        Results.Json(new { success = false, error }, statusCode: status);

    private const string FindBoardSql = """
        SELECT b.corporate_account_id, b.is_default, m.role
        FROM boards b
        LEFT JOIN corporate_account_members m ON m.corporate_account_id = b.corporate_account_id
            AND m.user_id = @user_id AND m.accepted_at IS NOT NULL
        WHERE b.id = @id AND (
            (b.corporate_account_id IS NULL AND b.user_id = @user_id) OR m.user_id IS NOT NULL
        )
        FOR UPDATE OF b
        """;

    private const string ReplacementSql = """
        SELECT id FROM boards
        WHERE id <> @id AND (
            corporate_account_id = @organization OR
            (CAST(@organization AS bigint) IS NULL AND corporate_account_id IS NULL AND user_id = @user_id)
        )
        ORDER BY is_default DESC, created_at, id
        LIMIT 1 FOR UPDATE
        """;

    private const string FindListSql = """
        SELECT b.id, b.user_id
        FROM task_lists l
        JOIN boards b ON b.id = l.board_id AND b.user_id = l.user_id
        WHERE l.id = @id AND (
            (b.corporate_account_id IS NULL AND b.user_id = @user_id)
            OR EXISTS (
                SELECT 1 FROM corporate_account_members m
                WHERE m.corporate_account_id = b.corporate_account_id
                  AND m.user_id = @user_id AND m.accepted_at IS NOT NULL
            )
        )
        FOR UPDATE OF l
        """;

    private const string FindFlagsSql = """
        SELECT ARRAY(
            SELECT flag_id FROM task_lists WHERE id = @id AND flag_id IS NOT NULL
            UNION
            SELECT flag_id FROM tasks WHERE list_id = @id AND flag_id IS NOT NULL
        )
        """;

    private const string LockFlagsSql = """
        SELECT id FROM user_flags
        WHERE id = ANY(@flags) AND board_id = @board_id AND user_id = @owner
        ORDER BY id FOR UPDATE
        """;

    private const string CleanupFlagsSql = """
        DELETE FROM user_flags f
        WHERE f.id = ANY(@flags) AND f.board_id = @board_id AND f.user_id = @owner
          AND NOT EXISTS (SELECT 1 FROM task_lists l WHERE l.flag_id = f.id)
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.flag_id = f.id)
          AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.flag_id = f.id)
        """;
}
