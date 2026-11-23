using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Caching.Distributed;
using Npgsql;

internal static class AuthPreviewIdentity
{
    internal const string Scheme = "AuthPreview";
    private const string TicketClaim = "todo_inn_preview_ticket";
    private const string RootClaim = "corporate_root";
    private const string VersionClaim = "password_version";

    internal sealed record PersonalSession(long Id, long PasswordVersion, bool RequiresUpgrade, string Username);
    internal sealed record View(object? User = null, object? Corporate = null, bool Unavailable = false,
        PersonalSession? Personal = null, long? CorporateId = null);

    internal static async Task SignIn(HttpContext context, long id, bool root, long passwordVersion)
    {
        await RevokeTicket(context);
        await AuthPreviewEndpoint.ResetCsrfSession(context);
        var ticket = Guid.NewGuid().ToString("N");
        var expiration = DateTimeOffset.UtcNow.AddHours(2);
        await context.RequestServices.GetRequiredService<IDistributedCache>().SetAsync(CacheKey(ticket), [1],
            new DistributedCacheEntryOptions { AbsoluteExpiration = expiration }, context.RequestAborted);
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, id.ToString(CultureInfo.InvariantCulture)),
            new Claim(TicketClaim, ticket),
            new Claim(RootClaim, root ? "1" : "0"),
            new Claim(VersionClaim, passwordVersion.ToString(CultureInfo.InvariantCulture)),
        };
        await context.SignInAsync(Scheme, new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme)),
            new AuthenticationProperties { ExpiresUtc = expiration, IsPersistent = true });
    }

    internal static async Task SignOut(HttpContext context)
    {
        await RevokeTicket(context);
        await context.SignOutAsync(Scheme);
        await AuthPreviewEndpoint.ResetCsrfSession(context);
    }

    internal static async Task SignOutIfPersonal(HttpContext context, long id)
    {
        var auth = await context.AuthenticateAsync(Scheme);
        if (auth.Principal is { } principal && principal.FindFirstValue(RootClaim) == "0"
            && principal.FindFirstValue(ClaimTypes.NameIdentifier) == id.ToString(CultureInfo.InvariantCulture))
            await SignOut(context);
    }

    internal static async Task<View> Read(HttpContext context, bool includeCorporateProfile = true)
    {
        var auth = await context.AuthenticateAsync(Scheme);
        var principal = auth.Principal;
        if (principal is null) return new();
        var ticket = principal.FindFirstValue(TicketClaim);
        var cache = context.RequestServices.GetRequiredService<IDistributedCache>();
        if (ticket is null || await cache.GetAsync(CacheKey(ticket), context.RequestAborted) is null)
            return new();
        if (!long.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id)) return new();
        var root = principal.FindFirstValue(RootClaim) == "1";
        var version = principal.FindFirstValue(VersionClaim);
        var connectionString = context.RequestServices.GetRequiredService<IConfiguration>().GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString)) return new(Unavailable: true);
        var cancellation = context.RequestAborted;

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            var sql = root
                ? includeCorporateProfile ? RootSql : "SELECT id FROM corporate_accounts WHERE id = @id"
                : UserSql;
            await using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue("id", id);
            await using var reader = await command.ExecuteReaderAsync(cancellation);
            if (await reader.ReadAsync(cancellation))
            {
                if (root)
                {
                    if (!includeCorporateProfile) return new(CorporateId: id);
                    var mime = Text(reader, 7);
                    return new(Corporate: new
                    {
                        id, username = Text(reader, 0), name = Text(reader, 1), description = Text(reader, 2),
                        secondary_email = Text(reader, 3), github_url = Text(reader, 4), telegram_url = Text(reader, 5),
                        preferred_theme = Text(reader, 6),
                        avatar = mime is null ? null : $"data:{mime};base64,{(Text(reader, 8) ?? "").Replace("\n", "").Replace("\r", "")}",
                    }, CorporateId: id);
                }
                var passwordVersion = reader.GetInt64(2);
                if (passwordVersion.ToString(CultureInfo.InvariantCulture) == version)
                    return new(User: new { id, username = reader.GetString(0), account_type = reader.GetString(1) },
                        Personal: new PersonalSession(id, passwordVersion, reader.GetInt16(3) == 1, reader.GetString(0)));
            }

            await cache.RemoveAsync(CacheKey(ticket), cancellation);
            await context.SignOutAsync(Scheme);
            // GET is already establishing a session. Rotate CSRF in the current session key.
            context.Session.Clear();
            return new();
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(AuthPreviewIdentity))
                .LogError(exception, "Preview session data lookup failed");
            return new(Unavailable: true);
        }
    }

    private static async Task RevokeTicket(HttpContext context)
    {
        var auth = await context.AuthenticateAsync(Scheme);
        if (auth.Principal?.FindFirstValue(TicketClaim) is string ticket)
            await context.RequestServices.GetRequiredService<IDistributedCache>().RemoveAsync(CacheKey(ticket), context.RequestAborted);
    }

    private static string CacheKey(string ticket) => "preview-auth:" + ticket;
    private static string? Text(NpgsqlDataReader reader, int ordinal) => reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);

    private const string UserSql = "SELECT username, account_type, password_version, registration_version FROM users WHERE id = @id";
    private const string RootSql = """
        SELECT root_username, organization_name, description, secondary_email, github_url, telegram_url,
               preferred_theme, avatar_mime, encode(avatar_data, 'base64')
        FROM corporate_accounts WHERE id = @id
        """;
}
