using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Npgsql;
using NpgsqlTypes;
using Workspace.Api.Infrastructure.Mail;
using Workspace.Api.Organizations;

namespace Workspace.Api.Accounts.Auth;

internal static class RegistrationEndpoint
{
    private const string ConsentVersion = "2026-10-draft-1";
    private const string Welcome = "Добро пожаловать в ToDo-inn! Здесь вы можете организовать свои дела или работу предприятия. Надеемся, мы сработаемся!";
    private const string UpgradeUnavailable = "Аккаунт уже обновлён или больше недоступен. Войдите снова.";
    private sealed record Invitation(string Email, string Role, string Token, string Greeting);

    internal static async Task<IResult> Register(HttpContext context, JsonElement body,
        AuthPreviewIdentity.PersonalSession? personal, RegistrationEmailCodes codes)
    {
        var (input, validationError) = RegistrationInput.Read(body);
        if (input is null) return Error(422, validationError!);
        var proof = RegistrationEmailCodes.ReadProof(context, input.Email);
        if (proof is null || !codes.UsesPersistentProof && !codes.ReserveMemoryProof(proof)) return Error(422, "Сначала подтвердите e-mail.");
        var committed = false;
        var cancellation = context.RequestAborted;
        var configuration = context.RequestServices.GetRequiredService<IConfiguration>();
        var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(RegistrationEndpoint));
        var upgrade = personal?.RequiresUpgrade == true ? personal : null;
        var invitations = new List<Invitation>();
        long? userId = null, corporateId = null;
        long passwordVersion = 0;
        var workspaceUsername = input.Username;

        try
        {
            var connectionString = configuration.GetConnectionString("Workspace");
            if (string.IsNullOrWhiteSpace(connectionString))
                return LoginPreviewEndpoint.Unavailable();

            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            await using var transaction = await connection.BeginTransactionAsync(cancellation);

            if (codes.UsesPersistentProof && !await codes.ConsumeProof(proof, transaction, cancellation))
                return Error(422, "Сначала подтвердите e-mail.");
            if (personal is not null && upgrade is null)
                return Error(409, "Обновление доступно только для старого личного аккаунта.");
            if (upgrade is not null && string.Equals(input.Username, upgrade.Username, StringComparison.OrdinalIgnoreCase))
                return Error(422, "Для обновления придумайте новый логин.");

            // Shares the lock with invitation acceptance so one transaction always sees the other's changes.
            await using (var registrationLock = new NpgsqlCommand(AcceptInvitationEndpoint.MembershipLinkLockSql, connection, transaction))
                await registrationLock.ExecuteNonQueryAsync(cancellation);

            if (upgrade is not null)
            {
                await using var find = new NpgsqlCommand("""
                    SELECT id FROM users WHERE id = @id AND registration_version = 1 AND password_version = @version FOR UPDATE
                    """, connection, transaction);
                find.Parameters.AddWithValue("id", upgrade.Id);
                find.Parameters.AddWithValue("version", upgrade.PasswordVersion);
                if (await find.ExecuteScalarAsync(cancellation) is null) return Error(409, UpgradeUnavailable);
            }
            await using (var conflict = new NpgsqlCommand(ConflictSql, connection, transaction))
            {
                conflict.Parameters.AddWithValue("corporate", input.Corporate);
                conflict.Parameters.AddWithValue("email", input.Email);
                conflict.Parameters.AddWithValue("username", input.Username.ToLowerInvariant());
                conflict.Parameters.Add("exclude", NpgsqlDbType.Bigint).Value = (object?)upgrade?.Id ?? DBNull.Value;
                if (await conflict.ExecuteScalarAsync(cancellation) is string error) return Error(409, error);
            }

            if (input.Corporate)
            {
                var error = await PrepareInvitations(connection, transaction, input, invitations, cancellation);
                if (error is not null) return Error(422, error);
            }
            if (input.Corporate && upgrade is not null)
            {
                await using var nameCheck = new NpgsqlCommand("""
                    SELECT EXISTS (SELECT 1 FROM users WHERE LOWER(username) = @username)
                        OR EXISTS (SELECT 1 FROM corporate_accounts WHERE LOWER(root_username) = @username)
                    """, connection, transaction);
                var param = nameCheck.Parameters.Add("username", NpgsqlDbType.Varchar);
                do
                {
                    workspaceUsername = "@Legacy" + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(5));
                    param.Value = workspaceUsername.ToLowerInvariant();
                } while (await nameCheck.ExecuteScalarAsync(cancellation) is true);
            }

            var hash = LegacyPasswordVerifier.Hash(input.Password);
            if (upgrade is not null || !input.Corporate)
            {
                await using var save = new NpgsqlCommand(upgrade is null ? CreateUserSql : UpgradeUserSql, connection, transaction);
                BindProfile(save, input, workspaceUsername, hash);
                if (upgrade is not null) save.Parameters.AddWithValue("id", upgrade.Id);
                await using var row = await save.ExecuteReaderAsync(cancellation);
                await row.ReadAsync(cancellation);
                userId = row.GetInt64(0);
                passwordVersion = row.GetInt64(1);
            }

            if (input.Corporate)
            {
                await using var create = new NpgsqlCommand(CreateCorporateSql, connection, transaction);
                BindProfile(create, input, input.Username, hash);
                create.Parameters.Add("creator", NpgsqlDbType.Bigint).Value = (object?)userId ?? DBNull.Value;
                create.Parameters.AddWithValue("organization_type", input.OrganizationType!);
                create.Parameters.AddWithValue("organization_name", input.OrganizationName!);
                corporateId = (long)(await create.ExecuteScalarAsync(cancellation))!;

                await using var member = new NpgsqlCommand(MemberSql, connection, transaction);
                member.Parameters.AddWithValue("account", corporateId.Value);
                var memberUser = member.Parameters.Add("member_user", NpgsqlDbType.Bigint);
                var memberEmail = member.Parameters.Add("email", NpgsqlDbType.Varchar);
                var memberRole = member.Parameters.Add("role", NpgsqlDbType.Varchar);
                var tokenHash = member.Parameters.Add("token_hash", NpgsqlDbType.Varchar);
                foreach (var invitation in invitations)
                {
                    var accepted = userId is not null && invitation.Role == "owner" && invitation.Email == input.Email;
                    memberUser.Value = accepted ? userId!.Value : DBNull.Value;
                    memberEmail.Value = invitation.Email;
                    memberRole.Value = invitation.Role;
                    tokenHash.Value = accepted ? DBNull.Value
                        : Convert.ToHexStringLower(SHA256.HashData(Encoding.ASCII.GetBytes(invitation.Token)));
                    await member.ExecuteNonQueryAsync(cancellation);
                }
                if (userId is not null) invitations.RemoveAll(invitation => invitation.Role == "owner" && invitation.Email == input.Email);
            }
            if (input.Corporate || upgrade is null)
            {
                await using var seed = new NpgsqlCommand(input.Corporate ? CorporateWelcomeSql : PersonalWelcomeSql, connection, transaction);
                seed.Parameters.AddWithValue("id", (corporateId ?? userId)!.Value);
                seed.Parameters.AddWithValue("message", Welcome);
                if (!input.Corporate) seed.Parameters.AddWithValue("email", input.Email);
                await seed.ExecuteNonQueryAsync(cancellation);
            }
            await transaction.CommitAsync(cancellation);
            committed = true;
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return Error(409, "Логин или e-mail уже используется.");
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            logger.LogError("Preview registration failed: {ErrorType}", exception.GetType().Name);
            return LoginPreviewEndpoint.Unavailable();
        }
        finally
        {
            if (!codes.UsesPersistentProof) codes.FinishRegistration(proof, committed);
        }

        var failures = new List<string>();
        var mail = context.RequestServices.GetRequiredService<PreviewMail>();
        foreach (var invitation in invitations)
        {
            if (!await mail.SendInvitation(invitation.Email, invitation.Greeting, input.OrganizationType!,
                input.OrganizationName!, invitation.Role, invitation.Token, cancellation))
                failures.Add(invitation.Email);
        }
        if (userId is long id)
            await AuthPreviewIdentity.SignIn(context, id, root: false, passwordVersion);
        else
            await SessionCsrf.Reset(context);

        return Results.Json(new
        {
            success = true,
            data = new
            {
                user = userId is long user ? new { id = user, username = workspaceUsername, account_type = "individual" } : null,
                corporate_account = corporateId is long company ? new { id = company, name = input.OrganizationName } : null,
                invitation_delivery_failures = failures,
                upgraded = upgrade is not null,
            }
        }, statusCode: upgrade is null ? 201 : 200);
    }

    private static async Task<string?> PrepareInvitations(NpgsqlConnection connection, NpgsqlTransaction transaction,
        RegistrationInput input, List<Invitation> invitations, CancellationToken cancellation)
    {
        if (input.Administrators[0].Role != "owner" || input.Administrators.Count(admin => admin.Role == "owner") != 1)
            return "Первая строка должна содержать единственного владельца аккаунта.";

        var emails = new HashSet<string>(StringComparer.Ordinal);
        await using var find = new NpgsqlCommand("""
            SELECT email, concat_ws(' ', nullif(btrim(first_name), ''), nullif(btrim(middle_name), ''))
            FROM users WHERE (@is_email AND LOWER(email) = @identifier) OR (NOT @is_email AND LOWER(username) = @identifier)
            LIMIT 1
            """, connection, transaction);
        var isEmail = find.Parameters.Add("is_email", NpgsqlDbType.Boolean);
        var value = find.Parameters.Add("identifier", NpgsqlDbType.Varchar);
        foreach (var admin in input.Administrators)
        {
            var identifier = admin.Identifier;
            var owner = admin.Role == "owner";
            if (identifier != identifier.Trim(' ', '\t', '\n', '\r', '\v', '\0'))
                return "Уберите пробелы в логине или e-mail администратора.";
            var emailAddress = LoginEmailEndpoint.IsEmailAddress(identifier);
            if (!emailAddress && !Regex.IsMatch(identifier, @"\A@[A-Za-z][A-Za-z0-9_-]{2,23}\z"))
                return owner ? "Введите корректный e-mail или зарегистрированный логин владельца."
                    : "Введите корректный e-mail или зарегистрированный логин администратора.";
            isEmail.Value = emailAddress;
            value.Value = identifier.ToLowerInvariant();
            await using var row = await find.ExecuteReaderAsync(cancellation);
            var exists = await row.ReadAsync(cancellation);
            var email = emailAddress ? identifier : exists && !row.IsDBNull(0) ? row.GetString(0) : null;
            if (string.IsNullOrEmpty(email) || owner && !LoginEmailEndpoint.IsEmailAddress(email))
                return owner ? "По логину владельца не найден пользователь с e-mail. Укажите адрес почты для приглашения."
                    : "По этому логину не найден пользователь с e-mail. Укажите адрес почты для приглашения.";
            email = email.ToLowerInvariant();
            if (!emails.Add(email)) return "Один и тот же пользователь указан несколько раз.";
            invitations.Add(new(email, admin.Role, Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32)), exists ? row.GetString(1) : ""));
        }
        return null;
    }

    private static void BindProfile(NpgsqlCommand command, RegistrationInput input, string username, string hash)
    {
        command.Parameters.AddWithValue("username", username);
        command.Parameters.AddWithValue("first", input.FirstName);
        command.Parameters.AddWithValue("last", input.LastName);
        command.Parameters.Add("middle", NpgsqlDbType.Varchar).Value = (object?)input.MiddleName ?? DBNull.Value;
        command.Parameters.AddWithValue("email", input.Email);
        command.Parameters.AddWithValue("hash", hash);
        command.Parameters.Add("secondary", NpgsqlDbType.Varchar).Value = (object?)input.SecondaryEmail ?? DBNull.Value;
        command.Parameters.AddWithValue("about", input.About);
        command.Parameters.Add("github", NpgsqlDbType.Varchar).Value = (object?)input.GitHub ?? DBNull.Value;
        command.Parameters.Add("telegram", NpgsqlDbType.Varchar).Value = (object?)input.Telegram ?? DBNull.Value;
        command.Parameters.AddWithValue("theme", input.Theme);
        command.Parameters.Add("avatar", NpgsqlDbType.Bytea).Value = (object?)input.Avatar ?? DBNull.Value;
        command.Parameters.Add("mime", NpgsqlDbType.Varchar).Value = (object?)input.AvatarMime ?? DBNull.Value;
        command.Parameters.AddWithValue("consent_version", ConsentVersion);
        command.Parameters.AddWithValue("marketing", input.Marketing);
    }

    private static IResult Error(int status, string error) => Results.Json(new { success = false, error }, statusCode: status);

    private const string ConflictSql = """
        SELECT CASE
            WHEN NOT @corporate AND EXISTS (SELECT 1 FROM users WHERE LOWER(email) = @email AND id IS DISTINCT FROM @exclude)
                THEN 'Этот e-mail уже привязан к личному аккаунту.'
            WHEN @corporate AND EXISTS (SELECT 1 FROM corporate_accounts WHERE LOWER(root_email) = @email)
                THEN 'Эта почта уже привязана к аккаунту организации.'
            WHEN EXISTS (SELECT 1 FROM users WHERE LOWER(username) = @username AND id IS DISTINCT FROM @exclude)
                THEN 'Этот логин уже используется личным аккаунтом.'
            WHEN EXISTS (SELECT 1 FROM corporate_accounts WHERE LOWER(root_username) = @username)
                THEN 'Этот логин уже используется аккаунтом организации.'
        END
        """;

    private const string CreateUserSql = """
        INSERT INTO users (username, first_name, last_name, middle_name, email, password_hash,
            secondary_email, about, github_url, telegram_url, preferred_theme, avatar_data, avatar_mime,
            personal_data_consent_at, personal_data_consent_version, marketing_consent, marketing_consent_at)
        VALUES (@username, @first, @last, @middle, @email, @hash, @secondary, @about, @github, @telegram,
            @theme, @avatar, @mime, now(), @consent_version, @marketing, CASE WHEN @marketing THEN now() END)
        RETURNING id, password_version
        """;

    private const string UpgradeUserSql = """
        UPDATE users SET username = @username, first_name = @first, last_name = @last, middle_name = @middle,
            email = @email, password_hash = @hash, secondary_email = @secondary, about = @about,
            github_url = @github, telegram_url = @telegram, preferred_theme = @theme, avatar_data = @avatar, avatar_mime = @mime,
            account_type = 'individual', registration_version = 2, organization_type = NULL, organization_name = NULL,
            username_changed_at = now(), personal_data_consent_at = now(), personal_data_consent_version = @consent_version,
            marketing_consent = @marketing, marketing_consent_at = CASE WHEN @marketing THEN now() END,
            password_version = password_version + 1
        WHERE id = @id
        RETURNING id, password_version
        """;

    private const string CreateCorporateSql = """
        INSERT INTO corporate_accounts (root_username, root_email, root_password_hash, created_by_user_id,
            organization_type, organization_name, secondary_email, description, github_url, telegram_url,
            preferred_theme, avatar_data, avatar_mime, personal_data_consent_at, personal_data_consent_version,
            marketing_consent, marketing_consent_at)
        VALUES (@username, @email, @hash, @creator, @organization_type, @organization_name, @secondary, @about,
            @github, @telegram, @theme, @avatar, @mime, now(), @consent_version, @marketing,
            CASE WHEN @marketing THEN now() END)
        RETURNING id
        """;

    private const string MemberSql = """
        INSERT INTO corporate_account_members (corporate_account_id, user_id, email, role, accepted_at,
            invitation_token_hash, invitation_expires_at)
        VALUES (@account, @member_user, @email, @role, CASE WHEN @member_user IS NOT NULL THEN now() END,
            @token_hash, CASE WHEN @token_hash IS NOT NULL THEN now() + interval '168 hours' END)
        """;

    private const string CorporateWelcomeSql = """
        INSERT INTO notifications (corporate_account_id, sender, message) VALUES (@id, 'ToDo-Inn!', @message)
        """;

    private const string PersonalWelcomeSql = """
        WITH personal_board AS (
            INSERT INTO boards (user_id, name, is_default) VALUES (@id, '👋 Hello World!', true) RETURNING id
        ), membership AS (
            UPDATE corporate_account_members SET user_id = @id
            WHERE LOWER(email) = @email AND user_id IS NULL AND accepted_at IS NOT NULL
            RETURNING corporate_account_id, role, user_id
        ),
        """ + AcceptInvitationEndpoint.OrganizationWelcomeSql + """
        , personal_list AS (
            INSERT INTO task_lists (user_id, board_id, name, description)
            SELECT @id, id, '👋 Hello World!', 'Это ваш первый список' FROM personal_board
        )
        INSERT INTO notifications (user_id, sender, message) VALUES (@id, 'ToDo-Inn!', @message)
        """;
}
