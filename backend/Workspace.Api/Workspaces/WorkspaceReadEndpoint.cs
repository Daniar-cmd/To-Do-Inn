using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Npgsql;
using NpgsqlTypes;

namespace Workspace.Api.Workspaces;

internal static class WorkspaceReadEndpoint
{
    private sealed record ReadInput([property: JsonPropertyName("board_id")] long? BoardId, string? Search);

    public static async Task<IResult> Read(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory)
    {
        var cancellation = context.RequestAborted;
        ReadInput? input;
        try
        {
            input = await context.Request.ReadFromJsonAsync<ReadInput>(cancellation);
        }
        catch (JsonException)
        {
            return Error(400, "Invalid JSON request");
        }
        if (input is null) return Error(400, "Invalid JSON request");

        return await ReadForUser(WorkspaceActor.From(context).Id, null, input.BoardId, input.Search ?? "",
            configuration, loggerFactory, cancellation);
    }

    internal static async Task<IResult> ReadForUser(long userId, long? passwordVersion, long? boardId, string search,
        IConfiguration configuration, ILoggerFactory loggerFactory, CancellationToken cancellation)
    {
        var invalidSearch = search.EnumerateRunes().Count() > 120
            || search.Any(character => character < ' ' || character == '\u007f');
        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString))
            return Error(503, "Рабочее пространство временно недоступно.");

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);

            // One statement keeps access, selected board, and all child rows on the same snapshot.
            var query = invalidSearch ? CheckBoardsSql : RowsSql + (search.Length > 0 ? SearchSql : BoardSql);
            var account = passwordVersion is null ? "WITH request_user AS (SELECT 1)" : SessionUserSql;
            await using var command = new NpgsqlCommand(account + AccessibleBoardsSql + query + ReadResultSql, connection);
            command.Parameters.AddWithValue("user_id", userId);
            if (passwordVersion is long version) command.Parameters.AddWithValue("version", version);
            if (!invalidSearch)
            {
                if (search.Length > 0)
                    command.Parameters.AddWithValue("search", search);
                else
                    command.Parameters.Add("board_id", NpgsqlDbType.Bigint).Value = (object?)boardId ?? DBNull.Value;
            }

            await using var row = await command.ExecuteReaderAsync(cancellation);
            await row.ReadAsync(cancellation);
            if (!row.GetBoolean(0)) return Error(401, "Требуется войти в аккаунт.");
            if (row.IsDBNull(1)) return Error(404, "Рабочая доска не найдена.");
            if (invalidSearch)
                return Error(422, "Поисковый запрос слишком длинный или содержит недопустимые символы.");
            return Results.Content(row.GetString(1), "application/json", Encoding.UTF8);
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            loggerFactory.CreateLogger(nameof(WorkspaceReadEndpoint)).LogError(exception, "Workspace read failed");
            return Error(503, "Рабочее пространство временно недоступно.");
        }
    }

    private static IResult Error(int status, string error) =>
        Results.Json(new { success = false, error }, statusCode: status);

    private const string SessionUserSql = """
        WITH request_user AS (
            SELECT 1 FROM users WHERE id = @user_id AND password_version = @version
        )
        """;

    private const string AccessibleBoardsSql = """
        , accessible_boards AS (
            SELECT b.*, jsonb_build_object(
                'id', b.id, 'name', b.name, 'description', b.description,
                'board_type', b.board_type, 'corporate_account_id', b.corporate_account_id
            ) AS payload
            FROM boards b
            WHERE EXISTS (SELECT 1 FROM request_user)
              AND (
                 (b.user_id = @user_id AND b.corporate_account_id IS NULL)
                 OR EXISTS (
                    SELECT 1 FROM corporate_account_members m
                    WHERE m.corporate_account_id = b.corporate_account_id
                      AND m.user_id = @user_id AND m.accepted_at IS NOT NULL
                 )
              )
        )

        """;

    private const string CheckBoardsSql = """
        , workspace_result AS (SELECT ''::text AS payload FROM accessible_boards LIMIT 1)
        """;

    private const string ReadResultSql = """

        SELECT EXISTS (SELECT 1 FROM request_user), (SELECT payload FROM workspace_result)
        """;

    // Cast temporal fields to text to match PDO's PostgreSQL date and time representation.
    private const string RowsSql = """
        , list_rows AS NOT MATERIALIZED (
            SELECT l.*, jsonb_build_object(
                'id', l.id, 'board_id', l.board_id, 'name', l.name, 'description', l.description,
                'created_at', l.created_at::text, 'due_date', l.due_date::text,
                'is_important', l.is_important, 'is_pinned', l.is_pinned,
                'sort_order', l.sort_order, 'theme', l.theme,
                'flag', CASE WHEN l.flag_id IS NOT NULL THEN
                    jsonb_build_object('id', l.flag_id, 'name', f.name, 'color', f.color) END
            ) AS payload
            FROM task_lists l
            JOIN accessible_boards b ON b.id = l.board_id AND b.user_id = l.user_id
            LEFT JOIN user_flags f ON f.id = l.flag_id AND f.user_id = l.user_id AND f.board_id = l.board_id
        ), task_rows AS NOT MATERIALIZED (
            SELECT t.id, t.list_id, t.title, t.sort_order, l.board_id, jsonb_build_object(
                'id', t.id, 'list_id', t.list_id, 'title', t.title, 'is_completed', t.is_completed,
                'description', t.description, 'is_important', t.is_important, 'urgency', t.urgency,
                'due_date', t.due_date::text, 'deadline', t.deadline::text,
                'location', t.location, 'scheduled_time', t.scheduled_time::text,
                'flag', CASE WHEN t.flag_id IS NOT NULL THEN
                    jsonb_build_object('id', t.flag_id, 'name', f.name, 'color', f.color) END
            ) || CASE WHEN t.repeat_interval IS NULL THEN '{}'::jsonb
                      ELSE jsonb_build_object('repeat_interval', t.repeat_interval) END AS payload
            FROM list_rows l
            JOIN tasks t ON t.list_id = l.id AND t.user_id = l.user_id AND t.board_id = l.board_id
            LEFT JOIN user_flags f ON f.id = t.flag_id AND f.user_id = t.user_id AND f.board_id = t.board_id
        ), flag_rows AS (
            SELECT f.board_id, f.name, jsonb_build_object(
                'id', f.id, 'board_id', f.board_id, 'name', f.name, 'color', f.color
            ) AS payload
            FROM user_flags f
            JOIN accessible_boards b ON b.id = f.board_id AND b.user_id = f.user_id
        )

        """;

    private const string BoardSql = """
        , selected AS (
            SELECT * FROM accessible_boards
            WHERE CAST(@board_id AS bigint) IS NULL OR id = @board_id
            ORDER BY (corporate_account_id IS NULL), is_default DESC, id
            LIMIT 1
        ), workspace_result AS (
        SELECT jsonb_build_object('success', true, 'data', jsonb_build_object(
            'board', b.payload,
            'boards', (SELECT jsonb_agg(payload ORDER BY (corporate_account_id IS NULL), is_default DESC, id)
                       FROM accessible_boards),
            'corporate_accounts', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.organization_name, 'role', m.role)
                                 ORDER BY a.organization_name)
                FROM corporate_account_members m
                JOIN corporate_accounts a ON a.id = m.corporate_account_id
                WHERE m.user_id = @user_id AND m.accepted_at IS NOT NULL
            ), '[]'::jsonb),
            'flags', COALESCE((SELECT jsonb_agg(f.payload ORDER BY f.name)
                               FROM flag_rows f WHERE f.board_id = b.id), '[]'::jsonb),
            'lists', COALESCE((
                SELECT jsonb_agg(l.payload ORDER BY l.is_pinned DESC,
                    CASE WHEN b.lists_order_customized THEN l.sort_order END,
                    CASE WHEN b.lists_order_customized THEN l.id END,
                    CASE WHEN NOT b.lists_order_customized THEN l.created_at END DESC,
                    l.id DESC)
                FROM list_rows l WHERE l.board_id = b.id
            ), '[]'::jsonb),
            'notes', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'id', n.id, 'board_id', n.board_id, 'title', n.title, 'body', n.body,
                    'annotation', n.annotation, 'created_at', n.created_at::text,
                    'is_important', n.is_important, 'theme', n.theme, 'is_pinned', n.is_pinned,
                    'sort_order', n.sort_order,
                    'image', CASE WHEN n.image_mime IS NOT NULL THEN jsonb_build_object(
                        'url', '/api/notes/' || n.id || '/image', 'mime', n.image_mime,
                        'offset', COALESCE(n.image_offset, 0)) END,
                    'flag', CASE WHEN n.flag_id IS NOT NULL THEN
                        jsonb_build_object('id', n.flag_id, 'name', f.name, 'color', f.color) END
                ) ORDER BY n.is_pinned DESC, n.sort_order, n.created_at DESC, n.id DESC)
                FROM notes n
                LEFT JOIN user_flags f ON f.id = n.flag_id AND f.user_id = n.user_id AND f.board_id = n.board_id
                WHERE n.board_id = b.id AND n.user_id = b.user_id
            ), '[]'::jsonb),
            'tasks', COALESCE((SELECT jsonb_agg(t.payload ORDER BY t.list_id, t.sort_order, t.id)
                               FROM task_rows t WHERE t.board_id = b.id), '[]'::jsonb)
        ))::text AS payload FROM selected b
        )
        """;

    private const string SearchSql = """
        , matches AS (
            SELECT l.*, b.name AS board_name, b.lists_order_customized
            FROM list_rows l JOIN accessible_boards b ON b.id = l.board_id
            WHERE POSITION(LOWER(@search) IN LOWER(l.name)) > 0
               OR POSITION(LOWER(@search) IN LOWER(l.description)) > 0
               OR EXISTS (SELECT 1 FROM task_rows t WHERE t.list_id = l.id
                          AND POSITION(LOWER(@search) IN LOWER(t.title)) > 0)
        ), workspace_result AS (
        SELECT jsonb_build_object('success', true, 'data', jsonb_build_object(
            'results', COALESCE((
                SELECT jsonb_agg(l.payload || jsonb_build_object(
                    'board_name', l.board_name,
                    'flags', COALESCE((SELECT jsonb_agg(f.payload ORDER BY f.name)
                                       FROM flag_rows f WHERE f.board_id = l.board_id), '[]'::jsonb),
                    'tasks', COALESCE((SELECT jsonb_agg(t.payload ORDER BY t.sort_order, t.id)
                                       FROM task_rows t WHERE t.list_id = l.id), '[]'::jsonb)
                ) ORDER BY l.board_name, l.is_pinned DESC,
                    CASE WHEN l.lists_order_customized THEN l.sort_order END,
                    CASE WHEN NOT l.lists_order_customized THEN l.created_at END DESC, l.id DESC)
                FROM matches l
            ), '[]'::jsonb)
        ))::text AS payload WHERE EXISTS (SELECT 1 FROM accessible_boards)
        )
        """;
}
