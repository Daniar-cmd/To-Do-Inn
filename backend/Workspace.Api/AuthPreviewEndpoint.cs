using System.Buffers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

internal static class AuthPreviewEndpoint
{
    internal const string PreviewSessionCookie = "todo_inn_dotnet_preview_session";
    private const string CsrfKey = "csrf_token";
    private const int StandardLimit = 8_192;
    private const int RegistrationLimit = 1_500_000;

    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    public static async Task<IResult> Handle(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.XContentTypeOptions = "nosniff";

        var request = context.Request;
        var cancellation = context.RequestAborted;
        var limits = context.RequestServices.GetRequiredService<AuthPreviewLimits>();
        if (HttpMethods.IsGet(request.Method))
        {
            if (await limits.RejectAsync(context) is { } rejected) return rejected;
            await context.Session.LoadAsync(cancellation);
            var identity = await AuthPreviewIdentity.Read(context);
            if (identity.Unavailable) return LoginPreviewEndpoint.Unavailable();
            var token = context.Session.GetString(CsrfKey);
            if (token is null)
            {
                token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(20));
                context.Session.SetString(CsrfKey, token);
            }

            return Results.Json(new
            {
                success = true,
                data = new { csrf_token = token, user = identity.User, corporate_account = identity.Corporate }
            });
        }
        if (!HttpMethods.IsPost(request.Method))
        {
            context.Response.Headers.Allow = "GET, POST";
            return Error(405, "Method not allowed");
        }

        if (!IsJson(request.ContentType)) return Error(415, "Expected a JSON request");
        if (request.ContentLength > RegistrationLimit) return Error(413, "Request is too large");

        var data = ArrayPool<byte>.Shared.Rent(RegistrationLimit + 1);
        try
        {
            var length = await request.Body.ReadAtLeastAsync(data.AsMemory(0, RegistrationLimit + 1),
                RegistrationLimit + 1, throwOnEndOfStream: false, cancellationToken: cancellation);
            if (length > RegistrationLimit) return Error(413, "Request is too large");

            string? action = null;
            string? loginEmail = null;
            string? invitationToken = null;
            RegistrationPreviewChecks.Input? registrationCheck = null;
            RegistrationEmailCodes.Input? emailCode = null;
            string? recoveryEmail = null;
            PasswordRecovery.Input? passwordReset = null;
            JsonElement registration = default;
            LoginPreviewEndpoint.LoginInput? login = null;
            long? notificationId = null;
            var invalidAction = false;
            try
            {
                _ = StrictUtf8.GetCharCount(data.AsSpan(0, length));
                using var document = JsonDocument.Parse(data.AsMemory(0, length), new JsonDocumentOptions { MaxDepth = 511 });
                var input = document.RootElement;
                if (input.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array))
                    return InvalidJson(length);
                if (input.ValueKind == JsonValueKind.Object && input.TryGetProperty("action", out var field))
                {
                    invalidAction = field.ValueKind is not (JsonValueKind.String or JsonValueKind.Null);
                    if (field.ValueKind == JsonValueKind.String) action = field.GetString();
                }
                if (action == "check_login_email" && input.TryGetProperty("email", out var email)
                    && email.ValueKind == JsonValueKind.String)
                    loginEmail = email.GetString();
                if (action == "login") login = LoginPreviewEndpoint.ReadInput(input);
                if (action == "accept_corporate_invitation")
                    invitationToken = RegistrationPreviewChecks.Value(input, "token");
                if (action == "request_password_reset")
                    recoveryEmail = RegistrationPreviewChecks.Value(input, "email");
                if (action == "reset_password")
                    passwordReset = PasswordRecovery.ReadInput(input);
                if (RegistrationPreviewChecks.Supports(action))
                    registrationCheck = RegistrationPreviewChecks.ReadInput(input, action!);
                if (action is "send_verification_code" or "verify_email_code")
                    emailCode = RegistrationEmailCodes.ReadInput(input);
                if (action == "register")
                    registration = input.Clone();
                if (action == "mark_notification_read" && input.TryGetProperty("notification_id", out var notification)
                    && notification.ValueKind == JsonValueKind.Number && notification.TryGetInt64(out var id) && id > 0)
                    notificationId = id;
            }
            catch (Exception exception) when (exception is JsonException or DecoderFallbackException or InvalidOperationException)
            {
                return InvalidJson(length);
            }

            if (length > StandardLimit && action != "register") return Error(413, "Request is too large");
            await context.Session.LoadAsync(cancellation);
            if (!HasValidCsrf(context))
                return Error(403, "Session expired. Refresh the page and try again.");

            if (await limits.RejectAsync(context, action, login?.Username, loginEmail ?? registrationCheck?.Email ?? emailCode?.Email ?? recoveryEmail,
                passwordReset?.Token) is { } rejected)
                return rejected;
            if (invalidAction) return Error(400, "Invalid action");
            if (action == "check_login_email") return await LoginEmailEndpoint.Check(context, loginEmail);
            if (action == "accept_corporate_invitation") return await AcceptInvitationEndpoint.Accept(context, invitationToken);
            if (action == "request_password_reset")
                return await context.RequestServices.GetRequiredService<PasswordRecovery>().RequestLink(context, recoveryEmail);
            if (passwordReset is not null)
                return await context.RequestServices.GetRequiredService<PasswordRecovery>().Reset(context, passwordReset);
            if (registrationCheck is not null) return await RegistrationPreviewChecks.Check(context, registrationCheck);
            if (emailCode is not null || action == "register")
            {
                var identity = await AuthPreviewIdentity.Read(context, includeCorporateProfile: false);
                if (identity.Unavailable) return LoginPreviewEndpoint.Unavailable();
                var settings = context.RequestServices.GetRequiredService<IConfiguration>();
                if (!settings.GetValue<bool>("Registration:Enabled") && identity.Personal?.RequiresUpgrade != true)
                    return Error(503, "Регистрация временно приостановлена. Попробуйте позже.");
                var codes = context.RequestServices.GetRequiredService<RegistrationEmailCodes>();
                if (emailCode is not null)
                    return action == "send_verification_code" ? await codes.Send(context, emailCode.Email, identity.Personal)
                        : await codes.Verify(context, emailCode);
                return await RegistrationEndpoint.Register(context, registration, identity.Personal, codes);
            }
            if (login is not null) return await LoginPreviewEndpoint.Login(context, login);
            if (action == "legacy_account_status")
            {
                var identity = await AuthPreviewIdentity.Read(context, includeCorporateProfile: false);
                if (identity.Unavailable) return LoginPreviewEndpoint.Unavailable();
                return Results.Json(new { success = true, data = new { required = identity.Personal?.RequiresUpgrade == true } });
            }
            if (action == "get_notifications") return await AuthNotificationsEndpoint.Handle(context, null);
            if (action == "mark_notification_read")
                return notificationId is not null ? await AuthNotificationsEndpoint.Handle(context, notificationId)
                    : Error(422, "Некорректное уведомление.");
            if (action == "logout")
            {
                await AuthPreviewIdentity.SignOut(context);
                return Results.Json(new { success = true, data = new { logged_out = true } });
            }

            return Error(400, "Unknown action");
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(data, clearArray: true);
        }
    }

    internal static async Task ResetCsrfSession(HttpContext context)
    {
        await context.Session.LoadAsync(context.RequestAborted);
        context.Session.Clear();
        await context.Session.CommitAsync(context.RequestAborted);
        var cookie = context.RequestServices.GetRequiredService<IOptions<SessionOptions>>().Value.Cookie;
        context.Response.Cookies.Delete(cookie.Name!, cookie.Build(context));
    }

    internal static bool HasValidCsrf(HttpContext context)
    {
        var expected = context.Session.GetString(CsrfKey);
        var supplied = context.Request.Headers["X-CSRF-TOKEN"].ToString();
        return expected is not null && supplied.Length == expected.Length
            && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(supplied));
    }

    internal static bool IsJson(string? contentType)
    {
        const string json = "application/json";
        if (contentType is null || !contentType.StartsWith(json, StringComparison.OrdinalIgnoreCase)) return false;
        return contentType.Length == json.Length || contentType.AsSpan(json.Length).TrimStart().StartsWith(";");
    }

    private static IResult InvalidJson(int length) => length > StandardLimit
        ? Error(413, "Request is too large")
        : Error(400, "Invalid JSON request");

    private static IResult Error(int status, string error) =>
        Results.Json(new { success = false, error }, statusCode: status);
}
