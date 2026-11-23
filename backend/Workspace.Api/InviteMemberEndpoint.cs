using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Npgsql;

internal static class InviteMemberEndpoint
{
    private sealed record InviteInput(
        [property: JsonPropertyName("corporate_account_id")] long OrganizationId, string? Email, string? Role);

    public static async Task<IResult> Invite(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory)
    {
        var cancellation = context.RequestAborted;
        InviteInput? input;
        try
        {
            input = await context.Request.ReadFromJsonAsync<InviteInput>(cancellation);
        }
        catch (JsonException)
        {
            return Error(400, "Invalid JSON request");
        }

        // The gateway uses the existing PHP email validator after resolving a username.
        if (input is null || input.OrganizationId <= 0 || string.IsNullOrEmpty(input.Email)
            || Encoding.UTF8.GetByteCount(input.Email) > 254 || !input.Email.Contains('@')
            || input.Email.Any(character => char.IsControl(character))
            || input.Role is not ("admin" or "manager" or "support"))
            return Error(422, "Проверьте контакт и роль участника.");

        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString))
            return Error(503, "Сервис приглашений временно недоступен.");

        try
        {
            var token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
            var tokenHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.ASCII.GetBytes(token)));
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            var status = await Insert(connection, null, (long)context.Items["WorkspaceUserId"]!, input.OrganizationId,
                input.Email, input.Role, tokenHash, cancellation);
            return status == 201 ? Results.Json(new { success = true, data = new { token } }, statusCode: 201)
                : Rejected(status);
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            loggerFactory.CreateLogger(nameof(InviteMemberEndpoint)).LogError(exception, "Corporate invitation insert failed");
            return Error(503, "Сервис приглашений временно недоступен.");
        }
    }

    internal static async Task<IResult> InviteFromRequest(HttpContext context, IConfiguration configuration,
        ILoggerFactory loggerFactory, JsonElement request)
    {
        var organization = WorkspacePreviewEndpoint.Id(request, "corporate_account_id");
        var identifier = WorkspacePreviewEndpoint.Text(request, "identifier");
        var role = WorkspacePreviewEndpoint.Text(request, "role");
        if (organization is null || string.IsNullOrEmpty(identifier) || identifier != WorkspacePreviewEndpoint.Trim(identifier)
            || Encoding.UTF8.GetByteCount(identifier) > 254 || role is not ("admin" or "manager" or "support"))
            return Error(422, "Проверьте контакт и роль участника.");

        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString))
            return Unavailable();

        var cancellation = context.RequestAborted;
        string token;
        string email;
        string type;
        string name;
        string greeting;
        try
        {
            var userId = (long)context.Items["WorkspaceUserId"]!;
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            await using var transaction = await connection.BeginTransactionAsync(cancellation);
            if (!await WorkspacePreviewEndpoint.CheckWriteSession(context, transaction))
                return Error(401, "Требуется войти в аккаунт.");

            await using (var owner = new NpgsqlCommand(OwnerSql, connection, transaction))
            {
                owner.Parameters.AddWithValue("organization", organization.Value);
                owner.Parameters.AddWithValue("user_id", userId);
                await using var reader = await owner.ExecuteReaderAsync(cancellation);
                if (!await reader.ReadAsync(cancellation)) return Rejected(403);
                type = reader.GetString(0);
                name = reader.GetString(1);
            }

            if (LoginEmailEndpoint.IsEmailAddress(identifier))
                email = identifier.ToLowerInvariant();
            else
            {
                if (!Regex.IsMatch(identifier, @"\A@[A-Za-z][A-Za-z0-9_-]{2,23}\z"))
                    return Error(422, "Введите корректный e-mail или зарегистрированный логин участника.");
                await using var find = new NpgsqlCommand("SELECT email FROM users WHERE LOWER(username) = @username LIMIT 1",
                    connection, transaction);
                find.Parameters.AddWithValue("username", identifier.ToLowerInvariant());
                if (await find.ExecuteScalarAsync(cancellation) is not string address || !LoginEmailEndpoint.IsEmailAddress(address))
                    return Error(422, "По этому логину не найден пользователь с e-mail. Укажите адрес почты для приглашения.");
                email = address.ToLowerInvariant();
            }

            token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
            var tokenHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.ASCII.GetBytes(token)));
            var status = await Insert(connection, transaction, userId, organization.Value, email, role, tokenHash, cancellation);
            if (status != 201) return Rejected(status);

            greeting = "";
            await using (var find = new NpgsqlCommand("SELECT first_name, middle_name FROM users WHERE LOWER(email) = @email LIMIT 1",
                connection, transaction))
            {
                find.Parameters.AddWithValue("email", email);
                await using var row = await find.ExecuteReaderAsync(cancellation);
                if (await row.ReadAsync(cancellation))
                {
                    var first = row.IsDBNull(0) ? "" : WorkspacePreviewEndpoint.Trim(row.GetString(0));
                    var middle = row.IsDBNull(1) ? "" : WorkspacePreviewEndpoint.Trim(row.GetString(1));
                    greeting = (first + " " + middle).Trim(' ');
                }
            }
            await transaction.CommitAsync(cancellation);
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            loggerFactory.CreateLogger(nameof(InviteMemberEndpoint))
                .LogError("Workspace invitation failed: {ErrorType}", exception.GetType().Name);
            return Unavailable();
        }

        var mail = context.RequestServices.GetRequiredService<PreviewMail>();
        var sent = await mail.SendInvitation(email, greeting, type, name, role, token, cancellation);
        return Results.Json(new { success = true, data = new { invited = true, email_sent = sent } }, statusCode: 201);
    }

    private static async Task<int> Insert(NpgsqlConnection connection, NpgsqlTransaction? transaction, long userId,
        long organization, string email, string role, string tokenHash, CancellationToken cancellation)
    {
        await using var command = new NpgsqlCommand(InsertSql, connection, transaction);
        command.Parameters.AddWithValue("organization", organization);
        command.Parameters.AddWithValue("user_id", userId);
        command.Parameters.AddWithValue("email", email);
        command.Parameters.AddWithValue("role", role);
        command.Parameters.AddWithValue("token_hash", tokenHash);
        return (int)(await command.ExecuteScalarAsync(cancellation))!;
    }

    private static IResult Rejected(int status) => status == 409
        ? Error(409, "Этот пользователь уже добавлен или приглашён.")
        : Error(403, "Только owner может управлять досками организации и приглашать участников.");

    private static IResult Unavailable() => Error(503, "Сервис приглашений временно недоступен.");

    private static IResult Error(int status, string error) =>
        Results.Json(new { success = false, error }, statusCode: status);

    private const string OwnerSql = """
        SELECT COALESCE(a.organization_type, ''), COALESCE(a.organization_name, '')
        FROM corporate_account_members m JOIN corporate_accounts a ON a.id = m.corporate_account_id
        WHERE m.corporate_account_id = @organization AND m.user_id = @user_id
            AND m.role = 'owner' AND m.accepted_at IS NOT NULL
        FOR SHARE OF m
        """;

    private const string InsertSql = """
        WITH owner_membership AS (
            SELECT corporate_account_id FROM corporate_account_members
            WHERE corporate_account_id = @organization AND user_id = @user_id
              AND role = 'owner' AND accepted_at IS NOT NULL
        ), invitation AS (
            INSERT INTO corporate_account_members (
                corporate_account_id, email, role, invitation_token_hash, invitation_expires_at
            )
            SELECT corporate_account_id, @email, @role, @token_hash, date_trunc('second', now()) + interval '168 hours'
            FROM owner_membership
            ON CONFLICT (corporate_account_id, (LOWER(email))) DO NOTHING
            RETURNING id
        )
        SELECT CASE
            WHEN EXISTS (SELECT 1 FROM invitation) THEN 201
            WHEN EXISTS (SELECT 1 FROM owner_membership) THEN 409
            ELSE 403
        END
        """;
}
