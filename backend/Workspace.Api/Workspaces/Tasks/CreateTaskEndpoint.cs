using System.Data;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace Workspace.Api.Workspaces.Tasks;

public static class CreateTaskEndpoint
{
    private static readonly char[] TrimChars = [' ', '\n', '\r', '\t', '\v', '\0'];

    public static Task<IResult> Create(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory) =>
        CreateFromInput(context, configuration, loggerFactory, null);

    internal static async Task<IResult> CreateFromInput(HttpContext context, IConfiguration configuration,
        ILoggerFactory loggerFactory, JsonElement? supplied)
    {
        var userId = WorkspaceActor.From(context).Id;
        long listId;
        string title;
        string description;
        bool important;
        short urgency;
        string newFlagName;
        long? flagId;
        DateOnly? dueDate;
        DateOnly? deadline;
        string? dueText;
        string? deadlineText;
        string? repeat;
        string? location;
        TimeOnly? scheduledTime;
        bool hasFlag;

        try
        {
            using var document = supplied is null
                ? await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted) : null;
            var input = supplied ?? document!.RootElement;
            if (input.ValueKind != JsonValueKind.Object
                || !input.TryGetProperty("action", out var action) || action.ValueKind != JsonValueKind.String
                || action.GetString() != "create_task"
                || !input.TryGetProperty("list_id", out var list) || !TaskEndpoints.TryId(list, out listId)
                || !input.TryGetProperty("title", out var titleValue) || titleValue.ValueKind != JsonValueKind.String)
                return Error(422, "Введите название задачи (не более 240 символов).");
            title = titleValue.GetString()!.Trim(TrimChars);
            if (title.Length == 0 || title.EnumerateRunes().Count() > 240)
                return Error(422, "Введите название задачи (не более 240 символов).");

            if (!TryOptionalString(input, "description", out description)
                || description.EnumerateRunes().Count() > 2000
                || !TryOptionalBool(input, "is_important", out important)
                || !TryUrgency(input, out urgency)
                || !TryOptionalString(input, "new_flag_name", out newFlagName)
                || !TryNullableString(input, "location", out location)
                || (location is not null && (location.EnumerateRunes().Count() > 160 || HasControls(location)))
                || !TryNullableString(input, "scheduled_time", out var timeText)
                || (timeText is not null && !TimeOnly.TryParseExact(timeText, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
                || !TryNullableString(input, "repeat_interval", out repeat)
                || (repeat is not null && repeat is not ("daily" or "weekly" or "monthly" or "yearly")))
                return Error(422, "Проверьте параметры задачи.");

            description = description.Trim(TrimChars);
            location = location?.Trim(TrimChars);
            if (location == "") location = null;
            if (location is null && timeText is not null)
                return Error(422, "Время можно указать только для задачи с локацией.");
            scheduledTime = timeText is null ? null : TimeOnly.ParseExact(timeText, "HH:mm", CultureInfo.InvariantCulture);

            newFlagName = newFlagName.Trim(TrimChars);
            var flagValue = input.TryGetProperty("flag_id", out var selected) ? selected : default;
            hasFlag = flagValue.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null);
            if (newFlagName.EnumerateRunes().Count() > 40 || HasControls(newFlagName)
                || (newFlagName != "" && hasFlag))
                return Error(422, "Проверьте выбранный флаг.");
            flagId = hasFlag && TaskEndpoints.TryId(flagValue, out var parsedFlag) ? parsedFlag : null;

            if (!TryNullableString(input, "due_date", out dueText)
                || (dueText is not null && !TryCurrentDate(dueText, out _)))
                return Error(422, "Выберите корректную дату, не раньше сегодняшнего дня.");
            if (!TryNullableString(input, "deadline", out deadlineText)
                || (deadlineText is not null && !TryCurrentDate(deadlineText, out _)))
                return Error(422, "Выберите корректный дедлайн, не раньше сегодняшнего дня.");
            dueDate = dueText is null ? null : DateOnly.ParseExact(dueText, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            deadline = deadlineText is null ? null : DateOnly.ParseExact(deadlineText, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            if ((dueDate is not null && deadline is not null)
                || (repeat is not null && dueDate is null && deadline is null))
                return Error(422, "Выберите одну дату или дедлайн для задачи с повторением.");
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

            const string findListSql = """
                SELECT lists.board_id, boards.user_id FROM task_lists AS lists
                JOIN boards ON boards.id = lists.board_id AND boards.user_id = lists.user_id
                WHERE lists.id = @list_id AND (
                    (boards.user_id = @user_id AND boards.corporate_account_id IS NULL)
                    OR EXISTS (
                        SELECT 1 FROM corporate_account_members AS members
                        WHERE members.corporate_account_id = boards.corporate_account_id
                          AND members.user_id = @user_id AND members.accepted_at IS NOT NULL
                    )
                )
                """;
            long boardId;
            long ownerId;
            await using (var findList = new NpgsqlCommand(findListSql, connection, transaction))
            {
                findList.Parameters.Add("list_id", NpgsqlDbType.Bigint).Value = listId;
                findList.Parameters.Add("user_id", NpgsqlDbType.Bigint).Value = userId;
                await using var reader = await findList.ExecuteReaderAsync(context.RequestAborted);
                if (!await reader.ReadAsync(context.RequestAborted)) return Error(404, "Список не найден.");
                boardId = reader.GetInt64(0);
                ownerId = reader.GetInt64(1);
            }

            // Serializes append order for members who create tasks in the same shared list.
            await using (var lockList = new NpgsqlCommand("SELECT pg_advisory_xact_lock(@list_id)", connection, transaction))
            {
                lockList.Parameters.Add("list_id", NpgsqlDbType.Bigint).Value = listId;
                await lockList.ExecuteScalarAsync(context.RequestAborted);
            }

            string? flagName = null;
            string? flagColor = null;
            if (newFlagName != "")
            {
                await using var insertFlag = new NpgsqlCommand("INSERT INTO user_flags (user_id, board_id, name) VALUES (@owner, @board, @name) RETURNING id, color", connection, transaction);
                insertFlag.Parameters.Add("owner", NpgsqlDbType.Bigint).Value = ownerId;
                insertFlag.Parameters.Add("board", NpgsqlDbType.Bigint).Value = boardId;
                insertFlag.Parameters.Add("name", NpgsqlDbType.Varchar).Value = newFlagName;
                await using var reader = await insertFlag.ExecuteReaderAsync(context.RequestAborted);
                await reader.ReadAsync(context.RequestAborted);
                flagId = reader.GetInt64(0);
                flagName = newFlagName;
                flagColor = reader.GetString(1);
            }
            else if (hasFlag)
            {
                if (flagId is null) return Error(404, "Флаг не найден.");
                await using var findFlag = new NpgsqlCommand("SELECT name, color FROM user_flags WHERE id = @flag AND user_id = @owner AND board_id = @board", connection, transaction);
                findFlag.Parameters.Add("flag", NpgsqlDbType.Bigint).Value = flagId.Value;
                findFlag.Parameters.Add("owner", NpgsqlDbType.Bigint).Value = ownerId;
                findFlag.Parameters.Add("board", NpgsqlDbType.Bigint).Value = boardId;
                await using var reader = await findFlag.ExecuteReaderAsync(context.RequestAborted);
                if (!await reader.ReadAsync(context.RequestAborted)) return Error(404, "Флаг не найден.");
                flagName = reader.GetString(0);
                flagColor = reader.GetString(1);
            }

            long order;
            await using (var findOrder = new NpgsqlCommand("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks WHERE user_id = @owner AND list_id = @list", connection, transaction))
            {
                findOrder.Parameters.Add("owner", NpgsqlDbType.Bigint).Value = ownerId;
                findOrder.Parameters.Add("list", NpgsqlDbType.Bigint).Value = listId;
                order = (long)(await findOrder.ExecuteScalarAsync(context.RequestAborted))!;
            }

            const string insertTaskSql = """
                INSERT INTO tasks (user_id, list_id, board_id, title, description, is_important, urgency,
                    flag_id, due_date, deadline, location, scheduled_time, repeat_interval,
                    repeat_series_id, repeat_anchor_date, sort_order)
                VALUES (@owner, @list, @board, @title, @description, @important, @urgency,
                    @flag, @due_date, @deadline, @location, @scheduled_time, @repeat,
                    @series, @anchor, @sort_order) RETURNING id
                """;
            long taskId;
            await using (var insertTask = new NpgsqlCommand(insertTaskSql, connection, transaction))
            {
                insertTask.Parameters.Add("owner", NpgsqlDbType.Bigint).Value = ownerId;
                insertTask.Parameters.Add("list", NpgsqlDbType.Bigint).Value = listId;
                insertTask.Parameters.Add("board", NpgsqlDbType.Bigint).Value = boardId;
                insertTask.Parameters.Add("title", NpgsqlDbType.Varchar).Value = title;
                insertTask.Parameters.Add("description", NpgsqlDbType.Text).Value = description;
                insertTask.Parameters.Add("important", NpgsqlDbType.Boolean).Value = important;
                insertTask.Parameters.Add("urgency", NpgsqlDbType.Smallint).Value = urgency;
                insertTask.Parameters.Add("flag", NpgsqlDbType.Bigint).Value = (object?)flagId ?? DBNull.Value;
                insertTask.Parameters.Add("due_date", NpgsqlDbType.Date).Value = (object?)dueDate ?? DBNull.Value;
                insertTask.Parameters.Add("deadline", NpgsqlDbType.Date).Value = (object?)deadline ?? DBNull.Value;
                insertTask.Parameters.Add("location", NpgsqlDbType.Varchar).Value = (object?)location ?? DBNull.Value;
                insertTask.Parameters.Add("scheduled_time", NpgsqlDbType.Time).Value = (object?)scheduledTime ?? DBNull.Value;
                insertTask.Parameters.Add("repeat", NpgsqlDbType.Varchar).Value = (object?)repeat ?? DBNull.Value;
                insertTask.Parameters.Add("series", NpgsqlDbType.Uuid).Value = repeat is null ? DBNull.Value : Guid.NewGuid();
                insertTask.Parameters.Add("anchor", NpgsqlDbType.Date).Value = (object?)(dueDate ?? deadline) ?? DBNull.Value;
                insertTask.Parameters.Add("sort_order", NpgsqlDbType.Bigint).Value = order;
                taskId = (long)(await insertTask.ExecuteScalarAsync(context.RequestAborted))!;
            }
            await transaction.CommitAsync(context.RequestAborted);

            var task = new Dictionary<string, object?>
            {
                ["id"] = taskId, ["list_id"] = listId, ["title"] = title, ["is_completed"] = false,
                ["description"] = description, ["is_important"] = important, ["urgency"] = urgency,
                ["due_date"] = dueText, ["deadline"] = deadlineText, ["location"] = location,
                ["scheduled_time"] = scheduledTime?.ToString("HH:mm:ss", CultureInfo.InvariantCulture),
                ["flag"] = flagId is null ? null : new { id = flagId.Value, name = flagName, color = flagColor },
            };
            if (repeat is not null) task["repeat_interval"] = repeat;
            return Results.Json(new { success = true, data = new { task } }, statusCode: 201);
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return Error(409, "Это название уже используется. Выберите другое.");
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            loggerFactory.CreateLogger("WorkspaceTasks").LogError(exception, "Task creation failed");
            return Error(503, "Сервис задач временно недоступен.");
        }
    }

    private static bool TryOptionalString(JsonElement input, string key, out string value)
    {
        if (!input.TryGetProperty(key, out var item) || item.ValueKind == JsonValueKind.Null)
        {
            value = "";
            return true;
        }
        value = item.ValueKind == JsonValueKind.String ? item.GetString()! : "";
        return item.ValueKind == JsonValueKind.String;
    }

    private static bool TryNullableString(JsonElement input, string key, out string? value)
    {
        if (!input.TryGetProperty(key, out var item) || item.ValueKind == JsonValueKind.Null)
        {
            value = null;
            return true;
        }
        value = item.ValueKind == JsonValueKind.String ? item.GetString() : null;
        return item.ValueKind == JsonValueKind.String;
    }

    private static bool TryOptionalBool(JsonElement input, string key, out bool value)
    {
        value = false;
        if (!input.TryGetProperty(key, out var item) || item.ValueKind == JsonValueKind.Null) return true;
        if (item.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
        value = item.GetBoolean();
        return true;
    }

    private static bool TryUrgency(JsonElement input, out short value)
    {
        value = 0;
        if (!input.TryGetProperty("urgency", out var item) || item.ValueKind == JsonValueKind.Null) return true;
        if (item.ValueKind != JsonValueKind.Number || !item.TryGetInt32(out var number) || number is < 0 or > 4) return false;
        value = (short)number;
        return true;
    }

    internal static bool TryCurrentDate(string value, out DateOnly date)
    {
        date = default;
        return value.Length == 10 && DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date)
            && date.Year >= 1000 && date >= DateOnly.FromDateTime(DateTime.UtcNow);
    }

    private static bool HasControls(string value) => value.Any(character => character is <= '\x1F' or '\x7F');

    private static IResult Error(int status, string message) =>
        Results.Json(new { success = false, error = message }, statusCode: status);
}
