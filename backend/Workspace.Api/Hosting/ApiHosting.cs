using System.Net;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Npgsql;
using Workspace.Api.Accounts.Auth;
using Workspace.Api.Accounts.Profile;
using Workspace.Api.Infrastructure.Mail;
using Workspace.Api.Infrastructure.Postgres;
using Workspace.Api.Workspaces;
using Workspace.Api.Workspaces.Notes;
using Workspace.Api.Workspaces.Tasks;

namespace Workspace.Api.Hosting;

internal sealed class ApiHosting
{
    internal bool AuthPreviewEnabled { get; }
    internal bool PublicApiEnabled { get; }
    private string? PublicHost { get; }
    private bool PersistentSessions { get; }

    private ApiHosting(bool authPreview, bool publicApi, string? publicHost, bool persistentSessions)
    {
        AuthPreviewEnabled = authPreview;
        PublicApiEnabled = publicApi;
        PublicHost = publicHost;
        PersistentSessions = persistentSessions;
    }

    internal static ApiHosting Configure(WebApplicationBuilder builder)
    {
        var authPreview = builder.Environment.IsDevelopment() && builder.Configuration.GetValue<bool>("AuthPreview:Enabled");
        var publicApi = builder.Environment.IsProduction() && builder.Configuration.GetValue<bool>("PublicApi:Enabled");
        var publicHost = builder.Configuration["PublicApi:Host"];
        var keyDirectory = builder.Configuration[publicApi ? "PublicApi:SessionKeyDirectory" : "AuthPreview:SessionKeyDirectory"];
        var persistentSessions = publicApi || (authPreview && !string.IsNullOrWhiteSpace(keyDirectory));
        var sessionCookie = publicApi ? "__Host-todo_inn_session" : "todo_inn_dotnet_preview_session";
        if (publicApi)
        {
            if (string.IsNullOrWhiteSpace(publicHost) || Uri.CheckHostName(publicHost) != UriHostNameType.Dns)
                throw new InvalidOperationException("PublicApi:Host must be the HTTPS site's DNS hostname.");
            if (builder.Configuration.GetValue<bool>("AuthPreview:UseLocalVerificationCode")
                || builder.Configuration.GetValue<bool>("FORWARDEDHEADERS_ENABLED"))
                throw new InvalidOperationException("Public API requires real verification codes and explicit proxy trust.");

            var port = builder.Configuration.GetValue("PublicApi:Port", 8002);
            if (port is < 1 or > 65535) throw new InvalidOperationException("PublicApi:Port must be a valid TCP port.");
            builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, port));
        }
        builder.Services.AddSingleton<TaskRecurrenceService>();
        if (authPreview || publicApi)
        {
            var securePolicy = authPreview && builder.Configuration.GetValue<bool>("AuthPreview:AllowLoopbackHttp")
                ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
            if (persistentSessions)
            {
                if (!Path.IsPathFullyQualified(keyDirectory!) || !Directory.Exists(keyDirectory)
                    || string.IsNullOrWhiteSpace(builder.Configuration.GetConnectionString("Workspace")))
                    throw new InvalidOperationException("Persistent auth requires an existing absolute key directory and ConnectionStrings:Workspace.");
                builder.Services.AddDataProtection().SetApplicationName(publicApi ? "ToDoInn.PublicApi" : "ToDoInn.AuthPreview")
                    .PersistKeysToFileSystem(new DirectoryInfo(keyDirectory!));
                builder.Services.AddSingleton<PostgresAuthCache>();
                builder.Services.AddSingleton<IDistributedCache>(services => services.GetRequiredService<PostgresAuthCache>());
                builder.Services.AddHostedService<AuthStorageCleanup>();
            }
            else
            {
                builder.Services.AddDataProtection().UseEphemeralDataProtectionProvider();
                builder.Services.AddDistributedMemoryCache();
            }
            builder.Services.AddSingleton<ProfileReader>();
            builder.Services.AddMemoryCache();
            builder.Services.AddSingleton(services => new AuthPreviewLimits(
                services.GetRequiredService<IMemoryCache>(),
                persistentSessions ? builder.Configuration.GetConnectionString("Workspace") : null));
            builder.Services.AddSingleton<RegistrationEmailCodes>();
            builder.Services.AddSingleton<AuthChallengeStore>();
            builder.Services.AddSingleton(TimeProvider.System);
            builder.Services.AddSingleton<PasswordRecovery>();
            builder.Services.AddSingleton<PreviewMail>();
            builder.Services.AddHttpClient(PreviewMail.ClientName, client => client.Timeout = TimeSpan.FromSeconds(10))
                .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
            builder.Services.AddAuthentication().AddCookie(AuthPreviewIdentity.Scheme, options =>
            {
                options.Cookie.Name = publicApi ? "__Host-todo_inn_auth" : "todo_inn_dotnet_preview_auth";
                options.Cookie.Path = "/";
                options.Cookie.HttpOnly = true;
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.Cookie.SecurePolicy = securePolicy;
                options.ExpireTimeSpan = TimeSpan.FromHours(2);
                options.SlidingExpiration = false;
            });
            builder.Services.AddSession(options =>
            {
                options.IdleTimeout = TimeSpan.FromHours(2);
                options.Cookie.Name = sessionCookie;
                options.Cookie.Path = "/";
                options.Cookie.HttpOnly = true;
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.Cookie.IsEssential = true;
                options.Cookie.SecurePolicy = securePolicy;
            });
        }

        return new ApiHosting(authPreview, publicApi, publicHost, persistentSessions);
    }

    internal void MapPublicApi(WebApplication app)
    {
        if (!AuthPreviewEnabled && !PublicApiEnabled) return;

        app.UseRouting();
        app.UseWhen(context => context.GetEndpoint()?.Metadata.GetMetadata<ApiRoute>() is not null,
            branch =>
            {
                branch.Use(async (context, next) =>
                {
                    var peer = context.Connection.RemoteIpAddress;
                    if (peer is null || (PublicApiEnabled ? !peer.Equals(IPAddress.Loopback) : !IPAddress.IsLoopback(peer)))
                    {
                        context.Response.StatusCode = StatusCodes.Status404NotFound;
                        return;
                    }
                    await next(context);
                });
                if (PublicApiEnabled)
                {
                    var forwarded = new ForwardedHeadersOptions
                    {
                        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
                        ForwardLimit = 1,
                        RequireHeaderSymmetry = true,
                    };
                    forwarded.KnownIPNetworks.Clear();
                    forwarded.KnownProxies.Clear();
                    forwarded.KnownProxies.Add(IPAddress.Loopback);
                    branch.UseForwardedHeaders(forwarded);
                    branch.Use(async (context, next) =>
                    {
                        if (!context.Request.IsHttps
                            || !string.Equals(context.Request.Host.Host, PublicHost, StringComparison.OrdinalIgnoreCase))
                        {
                            context.Response.StatusCode = StatusCodes.Status404NotFound;
                            return;
                        }
                        await next(context);
                    });
                }
                if (PersistentSessions)
                    branch.Use(async (context, next) =>
                    {
                        try { await next(context); }
                        catch (Exception exception) when (!context.Response.HasStarted
                            && exception is NpgsqlException or TimeoutException or CryptographicException)
                        {
                            app.Logger.LogWarning("Persistent auth failed: {ErrorType}", exception.GetType().Name);
                            await Results.Json(new { success = false, error = "Сервис временно недоступен." },
                                statusCode: 503).ExecuteAsync(context);
                        }
                    });
                branch.UseSession();
            });
        var api = app.MapGroup("/api").WithMetadata(new ApiRoute());
        api.Map("/auth.php", (Delegate)AuthPreviewEndpoint.Handle);
        api.Map("/profile.php", (Delegate)ProfilePreviewEndpoint.Handle);
        api.Map("/workspace.php", (Delegate)WorkspacePreviewEndpoint.Handle);
        api.Map("/notes/{noteId:long:regex(^[0-9]+$)}/image", (Delegate)NoteImageEndpoint.HandlePublic);
    }

    private sealed class ApiRoute;
}
