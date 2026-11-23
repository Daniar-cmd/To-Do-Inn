using System.Data;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

public static class MoveReorderTaskEndpoint
{
    public static Task<IResult> Move(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory) =>
        ChangeOrder(context, configuration, loggerFactory, "move_task");

    public static Task<IResult> Reorder(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory) =>
        ChangeOrder(context, configuration, loggerFactory, "reorder_task");

    internal static async Task<IResult> ChangeOrder(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory, string action, JsonElement? supplied = null)
    {
        var userId = (long)context.Items["WorkspaceUserId"]!;
        long taskId;
        long? targetListId = null;
        long? targetTaskId = null;
        try
        {
            using var document = supplied is null
                ? await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted) : null;
            var input = supplied ?? document!.RootElement;
            if (input.ValueKind != JsonValueKind.Object
                || !input.TryGetProperty("action", out var actualAction) || actualAction.ValueKind != JsonValueKind.String
                || actualAction.GetString() != action
                || !input.TryGetProperty("task_id", out var task) || !TaskEndpoints.TryId(task, out taskId))
                return Error(422, "Некорректная задача.");
            if (action == "reorder_task")
            {
                if (!input.TryGetProperty("target_task_id", out var target) || !TaskEndpoints.TryId(target, out var id))
                    return Error(422, "Некорректная задача.");
                targetTaskId = id;
            }
            else
            {
                if (!input.TryGetProperty("target_list_id", out var target) || !TaskEndpoints.TryId(target, out var id))
                    return Error(422, "Некорректная задача.");
                targetListId = id;
                if (input.TryGetProperty("target_task_id", out var targetTask) && targetTask.ValueKind != JsonValueKind.Null)
                {
                    if (!TaskEndpoints.TryId(targetTask, out var targetId)) return Error(422, "Некорректная задача.");
                    targetTaskId = targetId;
                }
            }
        }
        catch (Exception exception) when (exception is JsonException || supplied is not null && exception is InvalidOperationException)
        {
            return Error(400, "Invalid JSON request");
        }

        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString)) return Error(503, "Сервис задач временно недоступен.");
        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(context.RequestAborted);
            await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, context.RequestAborted);
            if (!await TaskEndpoints.CheckWriter(context, connection, transaction))
                return Error(401, "Требуется войти в аккаунт.");

            var source = await FindSource(connection, transaction, taskId, userId, false, context.RequestAborted);
            if (source is null) return Error(404, "Задача не найдена.");
            var sourceListId = source.Value.ListId;
            var destinationListId = targetListId ?? sourceListId;

            foreach (var listId in new[] { sourceListId, destinationListId }.Distinct().Order())
            {
                await using var listLock = new NpgsqlCommand("SELECT pg_advisory_xact_lock(@list_id)", connection, transaction);
                listLock.Parameters.Add("list_id", NpgsqlDbType.Bigint).Value = listId;
                await listLock.ExecuteScalarAsync(context.RequestAborted);
            }
            source = await FindSource(connection, transaction, taskId, userId, true, context.RequestAborted);
            if (source is null || source.Value.ListId != sourceListId)
                return Error(404, "Задача не найдена.");

            var ownerId = source.Value.OwnerId;
            if (action == "move_task")
            {
                const string targetListSql = "SELECT id FROM task_lists WHERE id = @target AND board_id = @board AND user_id = @owner";
                await using var findTargetList = new NpgsqlCommand(targetListSql, connection, transaction);
                findTargetList.Parameters.Add("target", NpgsqlDbType.Bigint).Value = destinationListId;
                findTargetList.Parameters.Add("board", NpgsqlDbType.Bigint).Value = source.Value.BoardId;
                findTargetList.Parameters.Add("owner", NpgsqlDbType.Bigint).Value = ownerId;
                if (await findTargetList.ExecuteScalarAsync(context.RequestAborted) is null)
                    return Error(404, "Целевой список не найден на этой доске.");
            }

            var sourceIds = await ReadTaskIds(connection, transaction, sourceListId, ownerId, context.RequestAborted);
            var originalSourceIds = new List<long>(sourceIds);
            var sourceIndex = sourceIds.IndexOf(taskId);
            if (sourceIndex < 0) return Error(404, "Задача не найдена.");
            sourceIds.RemoveAt(sourceIndex);
            var targetIds = destinationListId == sourceListId
                ? new List<long>(sourceIds)
                : await ReadTaskIds(connection, transaction, destinationListId, ownerId, context.RequestAborted);

            if (action == "reorder_task")
            {
                var targetIndex = originalSourceIds.IndexOf(targetTaskId!.Value);
                if (targetIndex < 0)
                    return Error(404, "Задача не найдена в этом списке.");
                if (sourceIndex != targetIndex)
                {
                    targetIds.Insert(targetIndex, taskId);
                    await WriteOrder(connection, transaction, targetIds, ownerId, context.RequestAborted);
                }
            }
            else
            {
                if (targetTaskId == taskId || (targetTaskId is not null && !targetIds.Contains(targetTaskId.Value)))
                    return Error(404, "Целевая задача не найдена в этом списке.");
                var position = targetTaskId is null ? targetIds.Count : targetIds.IndexOf(targetTaskId.Value);
                targetIds.Insert(position, taskId);
                await using (var updateList = new NpgsqlCommand("UPDATE tasks SET list_id = @target WHERE id = @task AND user_id = @owner", connection, transaction))
                {
                    updateList.Parameters.Add("target", NpgsqlDbType.Bigint).Value = destinationListId;
                    updateList.Parameters.Add("task", NpgsqlDbType.Bigint).Value = taskId;
                    updateList.Parameters.Add("owner", NpgsqlDbType.Bigint).Value = ownerId;
                    await updateList.ExecuteNonQueryAsync(context.RequestAborted);
                }
                await WriteOrder(connection, transaction, targetIds, ownerId, context.RequestAborted);
                if (destinationListId != sourceListId)
                    await WriteOrder(connection, transaction, sourceIds, ownerId, context.RequestAborted);
            }

            await transaction.CommitAsync(context.RequestAborted);
            return Results.Json(new { success = true, data = new { updated = true } });
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            loggerFactory.CreateLogger("WorkspaceTasks").LogError(exception, "Task order change failed: {Action}", action);
            return Error(503, "Сервис задач временно недоступен.");
        }
    }

    private static async Task<(long ListId, long BoardId, long OwnerId)?> FindSource(
        NpgsqlConnection connection, NpgsqlTransaction transaction, long taskId, long userId, bool lockTask, CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT tasks.list_id, boards.id, boards.user_id FROM tasks
            JOIN task_lists AS lists ON lists.id = tasks.list_id AND lists.user_id = tasks.user_id
            JOIN boards ON boards.id = lists.board_id AND boards.user_id = tasks.user_id
            WHERE tasks.id = @task AND (
                (boards.user_id = @user AND boards.corporate_account_id IS NULL)
                OR EXISTS (
                    SELECT 1 FROM corporate_account_members AS members
                    WHERE members.corporate_account_id = boards.corporate_account_id
                      AND members.user_id = @user AND members.accepted_at IS NOT NULL
                )
            )
            """;
        await using var command = new NpgsqlCommand(sql + (lockTask ? " FOR UPDATE OF tasks" : ""), connection, transaction);
        command.Parameters.Add("task", NpgsqlDbType.Bigint).Value = taskId;
        command.Parameters.Add("user", NpgsqlDbType.Bigint).Value = userId;
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        return (reader.GetInt64(0), reader.GetInt64(1), reader.GetInt64(2));
    }

    private static async Task<List<long>> ReadTaskIds(
        NpgsqlConnection connection, NpgsqlTransaction transaction, long listId, long ownerId, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            "SELECT id FROM tasks WHERE list_id = @list AND user_id = @owner ORDER BY sort_order, id FOR UPDATE", connection, transaction);
        command.Parameters.Add("list", NpgsqlDbType.Bigint).Value = listId;
        command.Parameters.Add("owner", NpgsqlDbType.Bigint).Value = ownerId;
        var result = new List<long>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) result.Add(reader.GetInt64(0));
        return result;
    }

    private static async Task WriteOrder(
        NpgsqlConnection connection, NpgsqlTransaction transaction, List<long> taskIds, long ownerId, CancellationToken cancellationToken)
    {
        for (var position = 0; position < taskIds.Count; position++)
        {
            await using var update = new NpgsqlCommand("UPDATE tasks SET sort_order = @position WHERE id = @task AND user_id = @owner", connection, transaction);
            update.Parameters.Add("position", NpgsqlDbType.Bigint).Value = position;
            update.Parameters.Add("task", NpgsqlDbType.Bigint).Value = taskIds[position];
            update.Parameters.Add("owner", NpgsqlDbType.Bigint).Value = ownerId;
            await update.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static IResult Error(int status, string message) =>
        Results.Json(new { success = false, error = message }, statusCode: status);
}
