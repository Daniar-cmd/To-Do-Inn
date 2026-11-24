using System.Security.Cryptography;
using System.Text;
using Npgsql;

namespace Workspace.Api.Organizations;

internal static class AcceptInvitationEndpoint
{
    internal static async Task<IResult> Accept(HttpContext context, string? token)
    {
        if (token is not { Length: 64 } || !token.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f'))
            return Error(422, "Ссылка приглашения некорректна или истекла.");

        var connectionString = context.RequestServices.GetRequiredService<IConfiguration>().GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString)) return Unavailable();
        var cancellation = context.RequestAborted;
        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            await using var transaction = await connection.BeginTransactionAsync(cancellation);
            await using (var membershipLock = new NpgsqlCommand(MembershipLinkLockSql, connection, transaction))
                await membershipLock.ExecuteNonQueryAsync(cancellation);

            await using var accept = new NpgsqlCommand(AcceptSql, connection, transaction);
            accept.Parameters.AddWithValue("hash", Convert.ToHexStringLower(SHA256.HashData(Encoding.ASCII.GetBytes(token))));
            bool registered;
            string role;
            await using (var row = await accept.ExecuteReaderAsync(cancellation))
            {
                if (!await row.ReadAsync(cancellation))
                    return Error(422, "Ссылка приглашения некорректна, уже использована или истекла.");
                registered = row.GetBoolean(0);
                role = row.GetString(1);
            }
            await transaction.CommitAsync(cancellation);
            return Results.Json(new { success = true, data = new { registered, role } });
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(AcceptInvitationEndpoint))
                .LogError("Preview invitation acceptance failed: {ErrorType}", exception.GetType().Name);
            return Unavailable();
        }
    }

    private static IResult Unavailable() => Error(503, "Сервис приглашений временно недоступен.");
    private static IResult Error(int status, string error) => Results.Json(new { success = false, error }, statusCode: status);

    internal const string MembershipLinkLockSql = "SELECT pg_advisory_xact_lock(841924311, 1)";

    // Both paths supply a membership CTE with the linked user and the organization role.
    internal const string OrganizationWelcomeSql = """
        organization_boards AS (
            INSERT INTO boards (user_id, corporate_account_id, name, board_type)
            SELECT member.user_id, account.id,
                LEFT(CASE WHEN account.organization_name IS NULL OR account.organization_name IN ('', '0')
                    THEN 'Рабочая среда' ELSE account.organization_name END, 60), 'corporate'
            FROM membership member JOIN corporate_accounts account ON account.id = member.corporate_account_id
            WHERE member.role = 'owner' AND member.user_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM boards WHERE corporate_account_id = account.id)
            RETURNING id, user_id
        ), organization_lists AS (
            INSERT INTO task_lists (user_id, board_id, name, description)
            SELECT user_id, id, '👋 Hello World!', 'Первый список организации' FROM organization_boards
        )
        """;

    private const string AcceptSql = """
        WITH membership AS (
            UPDATE corporate_account_members member
            SET user_id = (SELECT id FROM users WHERE LOWER(email) = LOWER(member.email) LIMIT 1),
                accepted_at = statement_timestamp(), invitation_token_hash = NULL, invitation_expires_at = NULL
            WHERE invitation_token_hash = @hash::character(64) AND accepted_at IS NULL
                AND invitation_expires_at > clock_timestamp()
            RETURNING corporate_account_id, role, user_id
        ),
        """ + OrganizationWelcomeSql + """

        SELECT user_id IS NOT NULL, role FROM membership
        """;
}
