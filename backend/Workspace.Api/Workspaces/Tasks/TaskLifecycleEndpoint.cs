using System.Data;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace Workspace.Api.Workspaces.Tasks;

public static class TaskLifecycleEndpoint
{
    public static Task<IResult> Delete(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory) =>
        Change(context, configuration, loggerFactory, "delete_task");

    public static Task<IResult> StopRepeat(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory) =>
        Change(context, configuration, loggerFactory, "stop_task_repeat");

    internal static async Task<IResult> Change(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory, string action, JsonElement? supplied = null)
    {
        var userId = WorkspaceActor.From(context).Id;
        long taskId;
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
            if (!await TaskEndpoints.CheckWriter(context, connection, transaction, taskId))
                return Error(401, "Требуется войти в аккаунт.");

            const string findTaskSql = """
                SELECT boards.user_id, boards.id, tasks.is_completed, tasks.repeat_interval,
                    tasks.repeat_series_id, tasks.repeat_sequence, tasks.flag_id
                FROM tasks
                JOIN task_lists AS lists ON lists.id = tasks.list_id AND lists.user_id = tasks.user_id
                JOIN boards ON boards.id = lists.board_id AND boards.user_id = tasks.user_id
                WHERE tasks.id = @task_id AND (
                    (boards.user_id = @user_id AND boards.corporate_account_id IS NULL)
                    OR EXISTS (
                        SELECT 1 FROM corporate_account_members AS members
                        WHERE members.corporate_account_id = boards.corporate_account_id
                          AND members.user_id = @user_id AND members.accepted_at IS NOT NULL
                    )
                ) FOR UPDATE OF tasks
                """;
            long ownerId;
            long boardId;
            bool completed;
            string? repeat;
            Guid? seriesId;
            int sequence;
            long? flagId;
            await using (var findTask = new NpgsqlCommand(findTaskSql, connection, transaction))
            {
                findTask.Parameters.Add("task_id", NpgsqlDbType.Bigint).Value = taskId;
                findTask.Parameters.Add("user_id", NpgsqlDbType.Bigint).Value = userId;
                await using var reader = await findTask.ExecuteReaderAsync(context.RequestAborted);
                if (!await reader.ReadAsync(context.RequestAborted)) return Error(404, "Задача не найдена.");
                ownerId = reader.GetInt64(0);
                boardId = reader.GetInt64(1);
                completed = reader.GetBoolean(2);
                repeat = reader.IsDBNull(3) ? null : reader.GetString(3);
                seriesId = reader.IsDBNull(4) ? null : reader.GetGuid(4);
                sequence = reader.GetInt32(5);
                flagId = reader.IsDBNull(6) ? null : reader.GetInt64(6);
            }

            if (action == "stop_task_repeat")
            {
                if (repeat is null || seriesId is null) return Error(409, "Повторение уже остановлено.");
                await using var stop = new NpgsqlCommand(
                    "UPDATE tasks SET repeat_interval = NULL WHERE user_id = @owner AND repeat_series_id = @series", connection, transaction);
                stop.Parameters.Add("owner", NpgsqlDbType.Bigint).Value = ownerId;
                stop.Parameters.Add("series", NpgsqlDbType.Uuid).Value = seriesId.Value;
                await stop.ExecuteNonQueryAsync(context.RequestAborted);
                await transaction.CommitAsync(context.RequestAborted);
                return Results.Json(new { success = true, data = new { updated = true } });
            }

            if (!completed) return Error(409, "Можно удалить только выполненную задачу.");
            if (repeat is not null)
            {
                await using var findNext = new NpgsqlCommand(
                    "SELECT 1 FROM tasks WHERE user_id = @owner AND repeat_series_id IS NOT DISTINCT FROM @series AND repeat_sequence > @sequence LIMIT 1",
                    connection, transaction);
                findNext.Parameters.Add("owner", NpgsqlDbType.Bigint).Value = ownerId;
                findNext.Parameters.Add("series", NpgsqlDbType.Uuid).Value = (object?)seriesId ?? DBNull.Value;
                findNext.Parameters.Add("sequence", NpgsqlDbType.Integer).Value = sequence;
                if (await findNext.ExecuteScalarAsync(context.RequestAborted) is null)
                    return Error(409, "Сначала остановите повторение этой задачи.");
            }

            await using (var delete = new NpgsqlCommand("DELETE FROM tasks WHERE id = @task_id AND user_id = @owner", connection, transaction))
            {
                delete.Parameters.Add("task_id", NpgsqlDbType.Bigint).Value = taskId;
                delete.Parameters.Add("owner", NpgsqlDbType.Bigint).Value = ownerId;
                await delete.ExecuteNonQueryAsync(context.RequestAborted);
            }
            if (flagId is not null)
            {
                const string removeUnusedFlag = """
                    DELETE FROM user_flags AS flags
                    WHERE flags.id = @flag AND flags.board_id = @board AND flags.user_id = @owner
                      AND NOT EXISTS (SELECT 1 FROM task_lists WHERE flag_id = flags.id)
                      AND NOT EXISTS (SELECT 1 FROM tasks WHERE flag_id = flags.id)
                      AND NOT EXISTS (SELECT 1 FROM notes WHERE flag_id = flags.id)
                    """;
                await using var cleanup = new NpgsqlCommand(removeUnusedFlag, connection, transaction);
                cleanup.Parameters.Add("flag", NpgsqlDbType.Bigint).Value = flagId.Value;
                cleanup.Parameters.Add("board", NpgsqlDbType.Bigint).Value = boardId;
                cleanup.Parameters.Add("owner", NpgsqlDbType.Bigint).Value = ownerId;
                await cleanup.ExecuteNonQueryAsync(context.RequestAborted);
            }
            await transaction.CommitAsync(context.RequestAborted);
            return Results.Json(new { success = true, data = new { deleted = true } });
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            loggerFactory.CreateLogger("WorkspaceTasks").LogError(exception, "Task lifecycle change failed: {Action}", action);
            return Error(503, "Сервис задач временно недоступен.");
        }
    }

    private static IResult Error(int status, string message) =>
        Results.Json(new { success = false, error = message }, statusCode: status);
}
