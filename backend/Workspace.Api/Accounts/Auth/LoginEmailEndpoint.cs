using System.Net;
using System.Net.Mail;
using Npgsql;

namespace Workspace.Api.Accounts.Auth;

internal static class LoginEmailEndpoint
{
    public static async Task<IResult> Check(HttpContext context, string? value)
    {
        var email = value?.Trim(' ', '\t', '\n', '\r', '\v', '\0');
        if (email is null || !IsEmailAddress(email))
            return Error(422, "Проверьте формат e-mail.");

        var configuration = context.RequestServices.GetRequiredService<IConfiguration>();
        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString)) return Unavailable();
        var cancellation = context.RequestAborted;

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            await using var command = new NpgsqlCommand(AccountChoicesSql, connection);
            command.Parameters.AddWithValue("email", email.ToLowerInvariant());
            var bothTypes = await command.ExecuteScalarAsync(cancellation) is true;
            return Results.Json(new
            {
                success = true,
                data = new { account_choices = bothTypes ? new[] { "individual", "corporate" } : Array.Empty<string>() }
            });
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(LoginEmailEndpoint));
            logger.LogError(exception, "Login account choice lookup failed");
            return Unavailable();
        }
    }

    internal static bool IsEmailAddress(string email)
    {
        if (email.Length is 0 or > 254 || email.Any(character => character < ' ' || character >= '\u007f')
            || !MailAddress.TryCreate(email, out var address) || address.Address != email
            || address.User.Length is 0 or > 64)
            return false;

        var host = address.Host;
        if (host.StartsWith('[') && host.EndsWith(']'))
        {
            var literal = host[1..^1];
            if (literal.StartsWith("IPv6:", StringComparison.OrdinalIgnoreCase))
                return IPAddress.TryParse(literal[5..], out var ipv6) && ipv6.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6;
            return literal.Count(character => character == '.') == 3
                && IPAddress.TryParse(literal, out var ipv4) && ipv4.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork;
        }

        var labels = host.Split('.');
        return labels.Length >= 2 && char.IsAsciiLetter(labels[^1].FirstOrDefault())
            && labels.All(label => label.Length is > 0 and <= 63
                && char.IsAsciiLetterOrDigit(label[0]) && char.IsAsciiLetterOrDigit(label[^1])
                && label.All(character => char.IsAsciiLetterOrDigit(character) || character == '-'));
    }

    private static IResult Unavailable() => Error(503, "Сервис входа временно недоступен.");

    private static IResult Error(int status, string error) =>
        Results.Json(new { success = false, error }, statusCode: status);

    private const string AccountChoicesSql = """
        SELECT COALESCE((
            SELECT account_type = 'individual' FROM users WHERE LOWER(email) = @email LIMIT 1
        ), false) AND EXISTS (
            SELECT 1 FROM corporate_accounts WHERE LOWER(root_email) = @email
        )
        """;
}
