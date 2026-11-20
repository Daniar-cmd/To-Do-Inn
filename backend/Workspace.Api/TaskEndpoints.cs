using System.Data;
using System.Text;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

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

    private static async Task<IResult> ChangeTask(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory, string expectedAction)
    {
        var userId = (long)context.Items["WorkspaceUserId"]!;
        long taskId;
        bool completed = false;
        string? title = null;
        try
        {
            using var document = await JsonDocument.ParseAsync(context.Request.Body);
            var input = document.RootElement;
            if (input.ValueKind != JsonValueKind.Object
                || !input.TryGetProperty("action", out var action) || action.GetString() != expectedAction
                || !input.TryGetProperty("task_id", out var task) || !task.TryGetInt64(out taskId) || taskId <= 0)
                return Error(422, "Некорректная задача.");
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
        catch (JsonException) { return Error(400, "Invalid JSON request"); }
        catch (InvalidOperationException) { return Error(422, "Некорректная задача."); }

        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString)) return Error(503, "Сервис задач временно недоступен.");
        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(context.RequestAborted);
            await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, context.RequestAborted);
            await using (var findUser = new NpgsqlCommand("SELECT id FROM users WHERE id = @user_id", connection, transaction))
            {
                findUser.Parameters.Add("user_id", NpgsqlDbType.Bigint).Value = userId;
                if (await findUser.ExecuteScalarAsync(context.RequestAborted) is null)
                    return Error(401, "Требуется войти в аккаунт.");
            }
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
