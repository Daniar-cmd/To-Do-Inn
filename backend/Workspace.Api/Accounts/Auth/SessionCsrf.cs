using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace Workspace.Api.Accounts.Auth;

internal static class SessionCsrf
{
    private const string CsrfKey = "csrf_token";

    internal static string GetOrCreate(ISession session)
    {
        var token = session.GetString(CsrfKey);
        if (token is not null) return token;

        token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(20));
        session.SetString(CsrfKey, token);
        return token;
    }

    internal static async Task Reset(HttpContext context)
    {
        await context.Session.LoadAsync(context.RequestAborted);
        context.Session.Clear();
        await context.Session.CommitAsync(context.RequestAborted);
        var cookie = context.RequestServices.GetRequiredService<IOptions<SessionOptions>>().Value.Cookie;
        context.Response.Cookies.Delete(cookie.Name!, cookie.Build(context));
    }

    internal static bool IsValid(HttpContext context)
    {
        var expected = context.Session.GetString(CsrfKey);
        var supplied = context.Request.Headers["X-CSRF-TOKEN"].ToString();
        return expected is not null && supplied.Length == expected.Length
            && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(supplied));
    }
}
