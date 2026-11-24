using System.Data;
using System.Text;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using Workspace.Api.Workspaces;

namespace Workspace.Api.Workspaces.Tasks;

public static class TaskEndpoints
{
    public static void MapTaskEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/tasks/toggle", ToggleTask);
        group.MapPost("/tasks/update", UpdateTask);
        group.MapPost("/tasks/create", CreateTaskEndpoint.Create);
        group.MapPost("/tasks/move", MoveReorderTaskEndpoint.Move);
        group.MapPost("/tasks/reorder", MoveReorderTaskEndpoint.Reorder);
        group.MapPost("/tasks/delete", TaskLifecycleEndpoint.Delete);
        group.MapPost("/tasks/stop-repeat", TaskLifecycleEndpoint.StopRepeat);
        group.MapPost("/tasks/repeat", RepeatTaskEndpoint.Run);
    }

    private static Task<IResult> ToggleTask(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory) =>
        ChangeTask(context, configuration, loggerFactory, "toggle_task");

    private static Task<IResult> UpdateTask(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory) =>
        ChangeTask(context, configuration, loggerFactory, "update_task");

    internal static bool TryId(JsonElement value, out long id)
    {
        id = 0;
        if (value.ValueKind == JsonValueKind.Number)
        {
            if (value.TryGetInt64(out id)) return id > 0;
            if (value.TryGetDouble(out var number) && number is >= 1 and < 1e14 && number == Math.Truncate(number))
            {
                id = (long)number;
                return true;
            }
        }
        else if (value.ValueKind == JsonValueKind.True)
        {
            id = 1;
            return true;
        }
        else if (value.ValueKind == JsonValueKind.String && WorkspacePreviewEndpoint.ParsePositiveId(value.GetString()) is long parsed)
        {
            id = parsed;
            return true;
        }
        return false;
    }

    internal static async Task<bool> CheckWriter(HttpContext context, NpgsqlConnection connection,
        NpgsqlTransaction transaction, long? taskId = null)
    {
        var writerActor = WorkspaceActor.From(context);
        var id = writerActor.Id;
        // The compatibility bridge already holds the workspace write lock for signed requests.
        if (writerActor.PasswordVersion is not long version)
        {
            await using var actor = new NpgsqlCommand("SELECT 1 FROM users WHERE id = @id", connection, transaction);
            actor.Parameters.AddWithValue("id", id);
            return await actor.ExecuteScalarAsync(context.RequestAborted) is not null;
        }
        if (taskId is null) return await writerActor.CheckWriteSession(transaction, context.RequestAborted);

        // A lifecycle change may touch a repeat series owned by a different member.
        // Lock both users in ID order before any task row locks, as the repeat runner locks the owner first.
        await using var writer = new NpgsqlCommand("""
            SELECT id, password_version FROM users
            WHERE id = @id OR id = (
                SELECT b.user_id FROM tasks t
                JOIN task_lists l ON l.id = t.list_id AND l.user_id = t.user_id AND l.board_id = t.board_id
                JOIN boards b ON b.id = l.board_id AND b.user_id = l.user_id
                JOIN corporate_account_members m ON m.corporate_account_id = b.corporate_account_id
                WHERE t.id = @task AND m.user_id = @id AND m.accepted_at IS NOT NULL
            )
            ORDER BY id FOR NO KEY UPDATE
            """, connection, transaction);
        writer.Parameters.AddWithValue("id", id);
        writer.Parameters.AddWithValue("task", taskId.Value);
        await using var row = await writer.ExecuteReaderAsync(context.RequestAborted);
        var authorized = false;
        while (await row.ReadAsync(context.RequestAborted))
            if (row.GetInt64(0) == id && row.GetInt64(1) == version) authorized = true;
        return authorized;
    }

    internal static async Task<IResult> ChangeTask(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory, string expectedAction, JsonElement? supplied = null)
    {
        var userId = WorkspaceActor.From(context).Id;
        long taskId;
        bool completed = false;
        string? title = null;
        try
        {
            using var document = supplied is null
                ? await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted) : null;
            var input = supplied ?? document!.RootElement;
            if (input.ValueKind != JsonValueKind.Object
                || !input.TryGetProperty("action", out var action) || action.GetString() != expectedAction
                || !input.TryGetProperty("task_id", out var task) || !TryId(task, out taskId))
                return Error(422, expectedAction == "update_task"
                    ? "Название задачи должно содержать от 1 до 240 символов." : "Некорректная задача.");
            if (expectedAction == "toggle_task")
            {
                if (!input.TryGetProperty("is_completed", out var state)
                    || (state.ValueKind != JsonValueKind.True && state.ValueKind != JsonValueKind.False))
                    return Error(422, "Некорректная задача.");
                completed = state.GetBoolean();
            }
            else
            {
                if (!input.TryGetProperty("title", out var value) || value.ValueKind != JsonValueKind.String)
                    return Error(422, "Название задачи должно содержать от 1 до 240 символов.");
                title = value.GetString()!.Trim(' ', '\n', '\r', '\t', '\v', '\0');
                if (title.Length == 0 || title.EnumerateRunes().Count() > 240)
                    return Error(422, "Название задачи должно содержать от 1 до 240 символов.");
            }
        }
        catch (Exception exception) when (exception is JsonException || supplied is not null && exception is InvalidOperationException)
        {
            return Error(400, "Invalid JSON request");
        }
        catch (InvalidOperationException) { return Error(422, "Некорректная задача."); }

        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString)) return Error(503, "Сервис задач временно недоступен.");
        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(context.RequestAborted);
            await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, context.RequestAborted);
            if (!await TaskEndpoints.CheckWriter(context, connection, transaction))
                return Error(401, "Требуется войти в аккаунт.");
            const string findTask = """
                SELECT tasks.id FROM tasks
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
            await using (var find = new NpgsqlCommand(findTask, connection, transaction))
            {
                find.Parameters.Add("task_id", NpgsqlDbType.Bigint).Value = taskId;
                find.Parameters.Add("user_id", NpgsqlDbType.Bigint).Value = userId;
                if (await find.ExecuteScalarAsync(context.RequestAborted) is null)
                    return Error(404, "Задача не найдена.");
            }
            var updateSql = expectedAction == "toggle_task"
                ? "UPDATE tasks SET is_completed = @completed WHERE id = @task_id"
                : "UPDATE tasks SET title = @title WHERE id = @task_id";
            await using (var update = new NpgsqlCommand(updateSql, connection, transaction))
            {
                if (expectedAction == "toggle_task")
                    update.Parameters.Add("completed", NpgsqlDbType.Boolean).Value = completed;
                else
                    update.Parameters.Add("title", NpgsqlDbType.Varchar).Value = title!;
                update.Parameters.Add("task_id", NpgsqlDbType.Bigint).Value = taskId;
                await update.ExecuteNonQueryAsync(context.RequestAborted);
            }
            await transaction.CommitAsync(context.RequestAborted);
            return Results.Json(new { success = true, data = new { updated = true } });
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            loggerFactory.CreateLogger("WorkspaceTasks").LogError(exception, "Task change failed: {Action}", expectedAction);
            return Error(503, "Сервис задач временно недоступен.");
        }
    }

    private static IResult Error(int status, string message) =>
        Results.Json(new { success = false, error = message }, statusCode: status);
}
