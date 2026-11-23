using System.Net;
using System.Net.Http.Headers;
using System.Net.Mail;
using System.Text.RegularExpressions;

internal sealed class PreviewMail(IHttpClientFactory clients, IConfiguration configuration, ILogger<PreviewMail> logger)
{
    internal const string ClientName = "Resend";
    private static readonly Lazy<string> Logo = new(() =>
    {
        using var logo = Open("logo.png");
        using var bytes = new MemoryStream();
        logo.CopyTo(bytes);
        return Convert.ToBase64String(bytes.ToArray());
    });
    private static readonly Lazy<(string Html, string Text)> Verification = new(() => ReadTemplate("verification-code"));
    private static readonly Lazy<(string Html, string Text)> Invitation = new(() => ReadTemplate("corporate-invitation"));
    private static readonly Lazy<(string Html, string Text)> PasswordReset = new(() => ReadTemplate("password-reset"));

    internal Task<bool> SendVerification(string email, string code, string greeting, CancellationToken cancellation) =>
        Send(email, "Код подтверждения — To Do Inn!", Verification, new()
        {
            ["CODE"] = code,
            ["GREETING_SUFFIX"] = GreetingSuffix(greeting),
        }, cancellation);

    internal Task<bool> SendInvitation(string email, string greeting, string type, string name, string role, string token,
        CancellationToken cancellation)
    {
        return Send(email, "Приглашение в корпоративный аккаунт — To Do Inn!", Invitation, new()
        {
            ["GREETING_SUFFIX"] = GreetingSuffix(greeting),
            ["ORGANIZATION"] = $"{type} «{name}»",
            ["URL"] = FrontendLink("/pages/corporate-invitation.html?token=" + token),
            ["ROLE"] = role switch
            {
                "owner" => "Владелец",
                "admin" => "Администратор",
                "manager" => "Менеджер",
                "support" => "Поддержка",
                _ => role,
            },
        }, cancellation);
    }

    internal Task<bool> SendPasswordReset(string email, string token, string greeting, CancellationToken cancellation) =>
        Send(email, "Восстановление пароля — To Do Inn!", PasswordReset, new()
        {
            ["GREETING_SUFFIX"] = GreetingSuffix(greeting),
            ["URL"] = FrontendLink("/pages/forgot-password.html#token=" + token),
        }, cancellation);

    private string FrontendLink(string path)
    {
        var frontend = configuration["Mail:FrontendUrl"];
        return (string.IsNullOrWhiteSpace(frontend) ? "http://localhost:5173" : frontend.TrimEnd('/')) + path;
    }

    private async Task<bool> Send(string email, string subject, Lazy<(string Html, string Text)> template,
        Dictionary<string, string> values, CancellationToken cancellation)
    {
        var apiKey = configuration["Mail:ResendApiKey"];
        var address = configuration["Mail:FromAddress"];
        var name = configuration["Mail:FromName"] ?? "To Do Inn";
        if (string.IsNullOrWhiteSpace(apiKey) || !LoginEmailEndpoint.IsEmailAddress(address ?? ""))
            return false;

        try
        {
            var from = new MailAddress(address!, name);
            var (html, text) = template.Value;
            using var client = clients.CreateClient(ClientName);
            using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.resend.com/emails");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            request.Content = JsonContent.Create(new
            {
                from = from.ToString(),
                to = new[] { email },
                subject,
                html = Render(html, values, html: true),
                text = Render(text, values, html: false),
                attachments = new[] { new { filename = "logo.png", content = Logo.Value, content_type = "image/png", content_id = "todo-inn-logo" } },
            });
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellation);
            if (!response.IsSuccessStatusCode)
                logger.LogWarning("Mail provider returned HTTP {StatusCode}", (int)response.StatusCode);
            return response.IsSuccessStatusCode;
        }
        catch (Exception exception) when (exception is HttpRequestException or IOException or FormatException or ArgumentException
            || exception is OperationCanceledException && !cancellation.IsCancellationRequested)
        {
            logger.LogWarning("Email delivery failed: {ErrorType}", exception.GetType().Name);
            return false;
        }
    }

    private static string GreetingSuffix(string name) => name.Length == 0 ? "" : " " + name;

    private static string Render(string template, Dictionary<string, string> values, bool html) =>
        Regex.Replace(template, @"\{([A-Z_]+)\}", match =>
        {
            var value = values[match.Groups[1].Value];
            return html ? WebUtility.HtmlEncode(value) : value;
        });

    private static (string Html, string Text) ReadTemplate(string name) => (Read(name + ".html"), Read(name + ".txt"));

    private static Stream Open(string name) => typeof(PreviewMail).Assembly.GetManifestResourceStream("Mail." + name)
        ?? throw new IOException("Missing email resource");

    private static string Read(string name)
    {
        using var reader = new StreamReader(Open(name));
        return reader.ReadToEnd();
    }
}
