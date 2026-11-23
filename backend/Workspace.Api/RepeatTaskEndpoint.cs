using System.Data;
using System.Globalization;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

public static class RepeatTaskEndpoint
{
    private sealed record LatestTask(long Id, long ListId, DateOnly? DueDate, DateOnly? Deadline,
        string Interval, DateOnly Anchor, int Sequence);

    internal enum RepeatStatus { Success, OwnerMissing, SeriesMoved }
    internal readonly record struct RepeatResult(RepeatStatus Status, int Generated = 0);

    public static async Task<IResult> Run(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory)
    {
        var ownerId = (long)context.Items["WorkspaceUserId"]!;
        Guid seriesId;
        DateOnly today;
        try
        {
            using var document = await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted);
            var input = document.RootElement;
            if (input.ValueKind != JsonValueKind.Object
                || !input.TryGetProperty("action", out var action) || action.ValueKind != JsonValueKind.String
                || action.GetString() != "repeat_tasks"
                || !input.TryGetProperty("series_id", out var series) || series.ValueKind != JsonValueKind.String
                || !Guid.TryParse(series.GetString(), out seriesId) || seriesId == Guid.Empty
                || !input.TryGetProperty("as_of", out var asOf) || asOf.ValueKind != JsonValueKind.String
                || !DateOnly.TryParseExact(asOf.GetString(), "yyyy-MM-dd", CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out today) || today.Year < 1000
                || today > DateOnly.FromDateTime(DateTime.UtcNow))
                return Error(422, "Некорректная серия повторений.");
        }
        catch (JsonException) { return Error(400, "Invalid JSON request"); }

        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString)) return Error(503, "Сервис задач временно недоступен.");
        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(context.RequestAborted);
            // The Laravel bridge already holds the owner lock on its own connection.
            var result = await Generate(connection, ownerId, seriesId, today, lockOwner: false, context.RequestAborted);
            return result.Status switch
            {
                RepeatStatus.OwnerMissing => Error(401, "Требуется войти в аккаунт."),
                RepeatStatus.SeriesMoved => Error(409, "Серия перемещена. Повторите запуск."),
                _ => Results.Json(new { success = true, data = new { generated = result.Generated } }),
            };
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException or OverflowException or ArgumentOutOfRangeException or InvalidOperationException)
        {
            loggerFactory.CreateLogger("WorkspaceTasks").LogError(exception, "Repeat generation failed");
            return Error(503, "Сервис задач временно недоступен.");
        }
    }

    internal static async Task<RepeatResult> Generate(NpgsqlConnection connection, long ownerId, Guid seriesId,
        DateOnly today, bool lockOwner, CancellationToken cancellation)
    {
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellation);
        await using (var findUser = new NpgsqlCommand(
            "SELECT id FROM users WHERE id = @owner" + (lockOwner ? " FOR NO KEY UPDATE" : ""), connection, transaction))
        {
            findUser.Parameters.AddWithValue("owner", ownerId);
            if (await findUser.ExecuteScalarAsync(cancellation) is null)
                return new(RepeatStatus.OwnerMissing);
        }

        var latest = await FindLatest(connection, transaction, ownerId, seriesId, false, cancellation);
        if (latest is null) return new(RepeatStatus.Success);

        await using (var lockList = new NpgsqlCommand("SELECT pg_advisory_xact_lock(@list_id)", connection, transaction))
        {
            lockList.Parameters.AddWithValue("list_id", latest.ListId);
            await lockList.ExecuteScalarAsync(cancellation);
        }
        var current = await FindLatest(connection, transaction, ownerId, seriesId, true, cancellation);
        if (current is null) return new(RepeatStatus.Success);
        if (current.ListId != latest.ListId)
            return new(RepeatStatus.SeriesMoved);
        latest = current;

        var generated = 0;
        for (; generated < 366; generated++)
        {
            var scheduled = latest.DueDate ?? latest.Deadline;
            if (scheduled is null || scheduled > today) break;
            var nextSequence = checked(latest.Sequence + 1);
            var nextDate = latest.Interval switch
            {
                "daily" => latest.Anchor.AddDays(nextSequence),
                "weekly" => latest.Anchor.AddDays(checked(nextSequence * 7)),
                "monthly" => latest.Anchor.AddMonths(nextSequence),
                "yearly" => latest.Anchor.AddYears(nextSequence),
                _ => throw new InvalidOperationException("Invalid repeat interval in database"),
            };

            long order;
            await using (var findOrder = new NpgsqlCommand(
                "SELECT MAX(sort_order) FROM tasks WHERE user_id = @owner AND list_id = @list", connection, transaction))
            {
                findOrder.Parameters.Add("owner", NpgsqlDbType.Bigint).Value = ownerId;
                findOrder.Parameters.Add("list", NpgsqlDbType.Bigint).Value = latest.ListId;
                var maximum = await findOrder.ExecuteScalarAsync(cancellation);
                order = maximum is null or DBNull ? 0 : checked((long)maximum + 1);
            }

            const string insertSql = """
                INSERT INTO tasks (user_id, board_id, list_id, title, description, is_important, urgency,
                    flag_id, location, scheduled_time, due_date, deadline, repeat_interval,
                    repeat_series_id, repeat_anchor_date, repeat_sequence, sort_order)
                SELECT user_id, board_id, list_id, title, description, is_important, urgency,
                    flag_id, location, scheduled_time, @due_date, @deadline, repeat_interval,
                    repeat_series_id, repeat_anchor_date, @sequence, @sort_order
                FROM tasks WHERE id = @latest_id AND user_id = @owner
                RETURNING id
                """;
            long nextId;
            await using (var insert = new NpgsqlCommand(insertSql, connection, transaction))
            {
                insert.Parameters.Add("due_date", NpgsqlDbType.Date).Value = latest.DueDate is null ? DBNull.Value : nextDate;
                insert.Parameters.Add("deadline", NpgsqlDbType.Date).Value = latest.Deadline is null ? DBNull.Value : nextDate;
                insert.Parameters.AddWithValue("sequence", nextSequence);
                insert.Parameters.AddWithValue("sort_order", order);
                insert.Parameters.AddWithValue("latest_id", latest.Id);
                insert.Parameters.AddWithValue("owner", ownerId);
                nextId = (long)(await insert.ExecuteScalarAsync(cancellation))!;
            }
            latest = latest with { Id = nextId, DueDate = latest.DueDate is null ? null : nextDate,
                Deadline = latest.Deadline is null ? null : nextDate, Sequence = nextSequence };
        }

        await transaction.CommitAsync(cancellation);
        return new(RepeatStatus.Success, generated);
    }

    private static async Task<LatestTask?> FindLatest(NpgsqlConnection connection, NpgsqlTransaction transaction,
        long ownerId, Guid seriesId, bool lockTask, CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT id, list_id, due_date, deadline, repeat_interval, repeat_anchor_date, repeat_sequence
            FROM tasks WHERE user_id = @owner AND repeat_series_id = @series AND repeat_interval IS NOT NULL
            ORDER BY repeat_sequence DESC LIMIT 1
            """;
        await using var command = new NpgsqlCommand(sql + (lockTask ? " FOR UPDATE" : ""), connection, transaction);
        command.Parameters.Add("owner", NpgsqlDbType.Bigint).Value = ownerId;
        command.Parameters.Add("series", NpgsqlDbType.Uuid).Value = seriesId;
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        return new LatestTask(reader.GetInt64(0), reader.GetInt64(1),
            reader.IsDBNull(2) ? null : reader.GetFieldValue<DateOnly>(2),
            reader.IsDBNull(3) ? null : reader.GetFieldValue<DateOnly>(3),
            reader.GetString(4), reader.GetFieldValue<DateOnly>(5), reader.GetInt32(6));
    }

    private static IResult Error(int status, string message) =>
        Results.Json(new { success = false, error = message }, statusCode: status);
}
