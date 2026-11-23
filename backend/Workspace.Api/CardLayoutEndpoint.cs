using System.Data;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Npgsql;

internal static class CardLayoutEndpoint
{
    private sealed record LayoutInput(
        string? Action, long Id, string? Type,
        [property: JsonPropertyName("is_pinned")] bool? IsPinned,
        [property: JsonPropertyName("target_id")] long? TargetId,
        [property: JsonPropertyName("target_type")] string? TargetType,
        [property: JsonPropertyName("insert_before")] bool? InsertBefore);

    private sealed record Card(long Id, string Type, bool Pinned, long SortOrder)
    {
        public string Key => Type + ":" + Id.ToString(CultureInfo.InvariantCulture);
    }

    public static async Task<IResult> Change(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory)
    {
        var cancellation = context.RequestAborted;
        LayoutInput? input;
        try
        {
            input = await context.Request.ReadFromJsonAsync<LayoutInput>(cancellation);
        }
        catch (JsonException)
        {
            return Error(400, "Invalid JSON request");
        }
        return await ApplyLayout(context, configuration, loggerFactory, input);
    }

    internal static Task<IResult> ChangeFromRequest(HttpContext context, IConfiguration configuration,
        ILoggerFactory loggerFactory, JsonElement request, string action)
    {
        if (action is "set_list_pinned" or "set_note_pinned")
        {
            var note = action == "set_note_pinned";
            var id = WorkspacePreviewEndpoint.Id(request, note ? "note_id" : "list_id");
            var pinned = ReadBoolean(request, "is_pinned");
            if (id is null || pinned is null)
                return Task.FromResult(note ? Error(404, "Заметка не найдена.") : Error(422, "Проверьте закрепление списка."));

            return ApplyLayout(context, configuration, loggerFactory,
                new LayoutInput("pin", id.Value, note ? "note" : "list", pinned, null, null, null));
        }

        var grid = action == "reorder_workspace_item";
        var sourceId = WorkspacePreviewEndpoint.Id(request, grid ? "item_id" : "list_id");
        var targetId = WorkspacePreviewEndpoint.Id(request, grid ? "target_item_id" : "target_list_id");
        var sourceType = grid ? WorkspacePreviewEndpoint.Text(request, "item_type") : "list";
        var targetType = grid ? WorkspacePreviewEndpoint.Text(request, "target_item_type") : "list";
        var before = ReadBoolean(request, "insert_before");
        if (sourceId is null || targetId is null || before is null
            || sourceType is not ("list" or "note") || targetType is not ("list" or "note"))
            return Task.FromResult(Error(422, grid ? "Проверьте порядок карточек." : "Проверьте порядок списков."));

        return ApplyLayout(context, configuration, loggerFactory,
            new LayoutInput(grid ? "reorder_grid" : "reorder_lists", sourceId.Value, sourceType, null, targetId, targetType, before));
    }

    private static bool? ReadBoolean(JsonElement request, string key) =>
        request.TryGetProperty(key, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? value.GetBoolean() : null;

    private static async Task<IResult> ApplyLayout(HttpContext context, IConfiguration configuration,
        ILoggerFactory loggerFactory, LayoutInput? input)
    {
        var cancellation = context.RequestAborted;
        if (input is null || input.Id <= 0 || input.Type is not ("list" or "note"))
            return Error(422, "Проверьте порядок карточек.");

        var pin = input.Action == "pin";
        var grid = input.Action == "reorder_grid";
        var lists = input.Action == "reorder_lists" && input.Type == "list" && input.TargetType == "list";
        if (pin && input.IsPinned is null)
            return Error(422, "Проверьте закрепление списка.");
        if (!pin && (input.TargetId is not > 0 || input.InsertBefore is null
            || !(lists || (grid && input.TargetType is "list" or "note"))))
            return Error(422, "Проверьте порядок карточек.");

        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString))
            return Error(503, "Рабочее пространство временно недоступно.");

        var notFound = pin
            ? input.Type == "list" ? "Список не найден." : "Заметка не найдена."
            : grid ? "Карточка не найдена в этой доске." : "Список не найден в этой доске.";
        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellation);
            if (!await WorkspacePreviewEndpoint.CheckWriteSession(context, transaction))
                return Error(401, "Требуется войти в аккаунт.");
            var userId = (long)context.Items["WorkspaceUserId"]!;
            var table = Table(input.Type);
            long boardId;
            long ownerId;
            bool customized;
            await using (var find = new NpgsqlCommand(FindBoardSql(table), connection, transaction))
            {
                find.Parameters.AddWithValue("id", input.Id);
                find.Parameters.AddWithValue("user_id", userId);
                await using var reader = await find.ExecuteReaderAsync(cancellation);
                if (!await reader.ReadAsync(cancellation)) return Error(404, notFound);
                boardId = reader.GetInt64(0);
                ownerId = reader.GetInt64(1);
                customized = reader.GetBoolean(2);
            }

            if (pin)
            {
                await using var update = new NpgsqlCommand(
                    $"UPDATE {table} SET is_pinned = @pin WHERE id = @id AND board_id = @board AND user_id = @owner",
                    connection, transaction);
                update.Parameters.AddWithValue("pin", input.IsPinned!.Value);
                update.Parameters.AddWithValue("id", input.Id);
                update.Parameters.AddWithValue("board", boardId);
                update.Parameters.AddWithValue("owner", ownerId);
                if (await update.ExecuteNonQueryAsync(cancellation) == 0) return Error(404, notFound);
            }
            else
            {
                var cards = await ReadCards(transaction, "list", boardId, ownerId, !grid && !customized, cancellation);
                if (grid) cards.AddRange(await ReadCards(transaction, "note", boardId, ownerId, false, cancellation));
                var source = cards.Find(card => card.Id == input.Id && card.Type == input.Type);
                var target = cards.Find(card => card.Id == input.TargetId && card.Type == input.TargetType);
                if (source is null || target is null) return Error(404, notFound);
                if (source.Pinned || target.Pinned)
                    return Error(409, grid ? "Закреплённую карточку нельзя переместить." : "Закреплённый список нельзя переместить.");
                if (source == target) return Updated();

                var pinned = !grid && !customized ? cards.Where(card => card.Pinned).ToArray() : [];
                var movable = cards.Where(card => !card.Pinned && card != source);
                var reordered = grid
                    ? movable.OrderBy(card => card.SortOrder).ThenBy(card => card.Key, StringComparer.Ordinal).ToList()
                    : movable.ToList();
                reordered.Insert(reordered.IndexOf(target) + (input.InsertBefore!.Value ? 0 : 1), source);
                var updates = pinned.Select((card, index) => (card, position: (long)index))
                    .Concat(reordered.Select((card, index) => (card, position: (long)index))).ToArray();
                await WritePositions(transaction, "list", updates, cancellation);
                if (grid) await WritePositions(transaction, "note", updates, cancellation);

                await using var mark = new NpgsqlCommand(
                    "UPDATE boards SET lists_order_customized = true WHERE id = @board", connection, transaction);
                mark.Parameters.AddWithValue("board", boardId);
                await mark.ExecuteNonQueryAsync(cancellation);
            }

            await transaction.CommitAsync(cancellation);
            return Updated();
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            loggerFactory.CreateLogger(nameof(CardLayoutEndpoint)).LogError(exception, "Workspace card layout failed");
            return Error(503, "Рабочее пространство временно недоступно.");
        }
    }

    private static async Task<List<Card>> ReadCards(NpgsqlTransaction transaction, string type, long boardId, long ownerId,
        bool defaultOrder, CancellationToken cancellation)
    {
        var order = defaultOrder ? "is_pinned DESC, created_at DESC, id DESC" : "sort_order, id";
        await using var command = new NpgsqlCommand($"""
            SELECT id, is_pinned, sort_order FROM {Table(type)}
            WHERE board_id = @board AND user_id = @owner ORDER BY {order} FOR NO KEY UPDATE
            """, transaction.Connection!, transaction);
        command.Parameters.AddWithValue("board", boardId);
        command.Parameters.AddWithValue("owner", ownerId);
        var cards = new List<Card>();
        await using var reader = await command.ExecuteReaderAsync(cancellation);
        while (await reader.ReadAsync(cancellation))
            cards.Add(new Card(reader.GetInt64(0), type, reader.GetBoolean(1), reader.GetInt64(2)));
        return cards;
    }

    private static async Task WritePositions(NpgsqlTransaction transaction, string type, (Card card, long position)[] updates,
        CancellationToken cancellation)
    {
        var positions = updates.Where(update => update.card.Type == type).ToArray();
        if (positions.Length == 0) return;
        await using var command = new NpgsqlCommand($"""
            UPDATE {Table(type)} c SET sort_order = ordering.position
            FROM unnest(@ids, @positions) AS ordering(id, position) WHERE c.id = ordering.id
            """, transaction.Connection!, transaction);
        command.Parameters.AddWithValue("ids", positions.Select(update => update.card.Id).ToArray());
        command.Parameters.AddWithValue("positions", positions.Select(update => update.position).ToArray());
        await command.ExecuteNonQueryAsync(cancellation);
    }

    // Only the two fixed internal table names may be interpolated in SQL.
    private static string Table(string type) => type == "list" ? "task_lists" : "notes";

    private static string FindBoardSql(string table) => $"""
        SELECT b.id, b.user_id, b.lists_order_customized
        FROM {table} c JOIN boards b ON b.id = c.board_id AND b.user_id = c.user_id
        WHERE c.id = @id AND (
            (b.user_id = @user_id AND b.corporate_account_id IS NULL)
            OR EXISTS (
                SELECT 1 FROM corporate_account_members m
                WHERE m.corporate_account_id = b.corporate_account_id
                  AND m.user_id = @user_id AND m.accepted_at IS NOT NULL
            )
        )
        FOR NO KEY UPDATE OF b
        """;

    private static IResult Updated() => Results.Json(new { success = true, data = new { updated = true } });

    private static IResult Error(int status, string error) =>
        Results.Json(new { success = false, error }, statusCode: status);
}
