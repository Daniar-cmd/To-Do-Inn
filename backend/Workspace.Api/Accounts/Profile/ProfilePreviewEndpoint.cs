using System.Buffers;
using System.Text;
using System.Text.Json;
using Npgsql;
using Workspace.Api.Accounts.Auth;

namespace Workspace.Api.Accounts.Profile;

internal static class ProfilePreviewEndpoint
{
    private const int WriteBodyLimit = 1_500_000;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    internal static async Task<IResult> Handle(HttpContext context, AuthPreviewLimits limits, ProfileReader profiles)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.XContentTypeOptions = "nosniff";
        await context.Session.LoadAsync(context.RequestAborted);
        var identity = await AuthPreviewIdentity.Read(context, includeCorporateProfile: false);
        if (identity.Unavailable) return Unavailable();
        if (identity.Personal is not { } session) return Unauthorized();

        var request = context.Request;
        var write = HttpMethods.IsPost(request.Method);
        if (!write && !HttpMethods.IsGet(request.Method))
        {
            context.Response.Headers.Allow = "GET, POST";
            return Error(405, "Method not allowed");
        }

        if (write)
        {
            if (!SessionCsrf.IsValid(context))
                return Error(403, "Сессия истекла. Обновите страницу.");
            return await WriteProfile(context, session, limits, profiles);
        }

        if (await limits.RejectProfileAsync(context, session.Id, write: false) is { } rejected) return rejected;
        return await ReadProfile(context, session, profiles);
    }

    private static async Task<IResult> ReadProfile(HttpContext context, AuthPreviewIdentity.PersonalSession session, ProfileReader profiles)
    {
        if (!profiles.IsConfigured) return Unavailable();
        try
        {
            var profile = await profiles.Read(session.Id, session.PasswordVersion, context.RequestAborted);
            return profile is null ? Unauthorized() : Results.Json(new { success = true, data = new { profile } });
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(ProfilePreviewEndpoint))
                .LogError(exception, "Preview profile lookup failed");
            return Unavailable();
        }
    }

    private static async Task<IResult> WriteProfile(HttpContext context, AuthPreviewIdentity.PersonalSession session,
        AuthPreviewLimits limits, ProfileReader profiles)
    {
        var request = context.Request;
        if (request.ContentLength > WriteBodyLimit) return TooLarge();
        var data = ArrayPool<byte>.Shared.Rent(WriteBodyLimit + 1);
        try
        {
            var length = await request.Body.ReadAtLeastAsync(data.AsMemory(0, WriteBodyLimit + 1),
                WriteBodyLimit + 1, throwOnEndOfStream: false, cancellationToken: request.HttpContext.RequestAborted);
            if (length > WriteBodyLimit) return TooLarge();
            _ = StrictUtf8.GetCharCount(data.AsSpan(0, length));
            using var document = JsonDocument.Parse(data.AsMemory(0, length), new JsonDocumentOptions { MaxDepth = 511 });
            if (document.RootElement.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array)) return InvalidJson();
            if (await limits.RejectProfileAsync(context, session.Id, write: true) is { } rejected) return rejected;
            return await ProfilePreviewWriter.Save(context, session, limits, profiles, document.RootElement);
        }
        catch (Exception exception) when (exception is JsonException or DecoderFallbackException)
        {
            return InvalidJson();
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(data, clearArray: true);
        }
    }

    private static IResult Unauthorized() => Error(401, "Требуется войти в аккаунт.");
    private static IResult Unavailable() => Error(503, "Не удалось загрузить профиль. Попробуйте позже.");
    private static IResult TooLarge() => Error(413, "Запрос слишком большой.");
    private static IResult InvalidJson() => Error(400, "Некорректный JSON-запрос.");
    private static IResult Error(int status, string error) => Results.Json(new { success = false, error }, statusCode: status);
}
