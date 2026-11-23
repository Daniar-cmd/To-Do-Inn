using System.Text;
using Npgsql;
using NpgsqlTypes;

internal static class AuthNotificationsEndpoint
{
    internal static async Task<IResult> Handle(HttpContext context, long? notificationId)
    {
        var identity = await AuthPreviewIdentity.Read(context, includeCorporateProfile: false);
        if (identity.Unavailable) return Unavailable();
        var recipient = identity.CorporateId ?? identity.Personal?.Id;
        if (recipient is null) return Unauthorized();

        var connectionString = context.RequestServices.GetRequiredService<IConfiguration>().GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString)) return Unavailable();

        try
        {
            var cancellation = context.RequestAborted;
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            await using var command = new NpgsqlCommand(RecipientSql + (notificationId is null ? ReadSql : MarkSql), connection);
            command.Parameters.AddWithValue("recipient", recipient.Value);
            command.Parameters.AddWithValue("root", identity.CorporateId is not null);
            command.Parameters.Add("version", NpgsqlDbType.Bigint).Value = (object?)identity.Personal?.PasswordVersion ?? DBNull.Value;
            if (notificationId is long id) command.Parameters.AddWithValue("notification_id", id);
            var result = await command.ExecuteScalarAsync(cancellation);
            if (result is null or DBNull) return Unauthorized();
            if (notificationId is null)
                return Results.Content((string)result, "application/json", Encoding.UTF8);
            return (bool)result
                ? Results.Json(new { success = true, data = new { read = true } })
                : Error(404, "Уведомление не найдено.");
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(AuthNotificationsEndpoint))
                .LogError(exception, "Preview notification operation failed");
            return Unavailable();
        }
    }

    private static IResult Unauthorized() => Error(401, "Требуется войти в аккаунт.");
    private static IResult Unavailable() => Error(503, "Не удалось загрузить уведомления. Попробуйте позже.");
    private static IResult Error(int status, string error) => Results.Json(new { success = false, error }, statusCode: status);

    private const string RecipientSql = """
        WITH eligible AS (
            SELECT id FROM users WHERE NOT @root AND id = @recipient AND password_version = @version
            UNION ALL
            SELECT id FROM corporate_accounts WHERE @root AND id = @recipient
        )

        """;

    private const string ReadSql = """
        , matching AS NOT MATERIALIZED (
            SELECT n.id, n.sender, n.message, n.created_at, n.read_at
            FROM notifications n JOIN eligible e
                ON ((@root AND n.corporate_account_id = e.id) OR (NOT @root AND n.user_id = e.id))
        ), recent AS (
            SELECT * FROM matching ORDER BY created_at DESC, id DESC LIMIT 50
        )
        SELECT jsonb_build_object('success', true, 'data', jsonb_build_object(
            'notifications', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('id', id, 'sender', sender, 'message', message,
                    'created_at', created_at::text, 'is_read', read_at IS NOT NULL)
                    ORDER BY created_at DESC, id DESC) FROM recent
            ), '[]'::jsonb),
            'unread_count', (SELECT COUNT(*) FROM matching WHERE read_at IS NULL)
        ))::text FROM eligible
        """;

    private const string MarkSql = """
        , target AS (
            SELECT n.id FROM notifications n JOIN eligible e
                ON ((@root AND n.corporate_account_id = e.id) OR (NOT @root AND n.user_id = e.id))
            WHERE n.id = @notification_id
        ), marked AS (
            UPDATE notifications n SET read_at = date_trunc('second', now())
            FROM target t WHERE n.id = t.id AND n.read_at IS NULL
                AND ((@root AND n.corporate_account_id = @recipient) OR (NOT @root AND n.user_id = @recipient))
            RETURNING n.id
        )
        SELECT EXISTS (SELECT 1 FROM target) FROM eligible
        """;
}
