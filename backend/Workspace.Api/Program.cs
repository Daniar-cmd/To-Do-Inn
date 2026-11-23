using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Npgsql;

if (args is ["tasks:repeat", ..])
    return await RepeatTasksCommand.Run(args);
if (args is ["diagnostics:check", ..])
    return await WorkspaceReadiness.RunCommand(args);
if (args is ["schema:init", ..])
    return await InitializeWorkspaceSchema.Run(args);
if (args is ["schema:baseline", ..])
    return await SchemaBaseline.Run(args);
if (args is ["schema:migrate", ..])
    return await SchemaMigrations.Run(args);

var builder = WebApplication.CreateBuilder(args);
var authPreview = builder.Environment.IsDevelopment() && builder.Configuration.GetValue<bool>("AuthPreview:Enabled");
var publicApi = builder.Environment.IsProduction() && builder.Configuration.GetValue<bool>("PublicApi:Enabled");
var publicHost = builder.Configuration["PublicApi:Host"];
var keyDirectory = builder.Configuration[publicApi ? "PublicApi:SessionKeyDirectory" : "AuthPreview:SessionKeyDirectory"];
var persistentSessions = publicApi || (authPreview && !string.IsNullOrWhiteSpace(keyDirectory));
var sessionCookie = publicApi ? "__Host-todo_inn_session" : AuthPreviewEndpoint.PreviewSessionCookie;
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
var app = builder.Build();
var seenNonces = new ConcurrentDictionary<string, long>();

if (authPreview || publicApi)
{
    app.UseRouting();
    app.UseWhen(context => context.GetEndpoint()?.Metadata.GetMetadata<ApiRoute>() is not null,
        branch =>
        {
            branch.Use(async (context, next) =>
            {
                var peer = context.Connection.RemoteIpAddress;
                if (peer is null || (publicApi ? !peer.Equals(IPAddress.Loopback) : !IPAddress.IsLoopback(peer)))
                {
                    context.Response.StatusCode = StatusCodes.Status404NotFound;
                    return;
                }
                await next(context);
            });
            if (publicApi)
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
                        || !string.Equals(context.Request.Host.Host, publicHost, StringComparison.OrdinalIgnoreCase))
                    {
                        context.Response.StatusCode = StatusCodes.Status404NotFound;
                        return;
                    }
                    await next(context);
                });
            }
            if (persistentSessions)
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

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/ready", WorkspaceReadiness.Handle);

var internalApi = app.MapGroup("/internal").AddEndpointFilter(async (context, next) =>
{
    if (publicApi) return Results.NotFound();
    var request = context.HttpContext.Request;
    var remote = context.HttpContext.Connection.RemoteIpAddress;
    if (remote is null || !IPAddress.IsLoopback(remote)) return Results.StatusCode(403);

    var secretText = app.Configuration["WorkspaceBridge:Secret"];
    byte[] secret;
    try { secret = Convert.FromBase64String(secretText ?? ""); }
    catch (FormatException) { return Results.StatusCode(503); }
    if (secret.Length < 32) return Results.StatusCode(503);

    if (!long.TryParse(request.Headers["X-Workspace-Issued-At"], out var issuedAt)
        || !long.TryParse(request.Headers["X-Workspace-User"], out var userId)
        || userId <= 0) return Results.Unauthorized();
    var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    if (Math.Abs(now - issuedAt) > 30) return Results.Unauthorized();
    var nonce = request.Headers["X-Workspace-Nonce"].ToString();
    var signature = request.Headers["X-Workspace-Signature"].ToString();
    if (nonce.Length != 32 || !nonce.All(Uri.IsHexDigit) || signature.Length != 64) return Results.Unauthorized();

    request.EnableBuffering();
    // Normalization and JSON escaping can grow validated content payloads.
    var limit = request.Path.Value switch
    {
        "/internal/notes/image" => 1_400_000, // 1 MiB in base64 plus a small JSON envelope.
        "/internal/boards/save" or "/internal/lists/save" or "/internal/notes/save" => 16384,
        _ => 8192,
    };
    var buffer = new byte[limit + 1];
    var length = await request.Body.ReadAtLeastAsync(buffer, buffer.Length, throwOnEndOfStream: false,
        cancellationToken: request.HttpContext.RequestAborted);
    if (length > limit) return Results.StatusCode(413);
    request.Body.Position = 0;
    var bodyHash = Convert.ToHexStringLower(SHA256.HashData(buffer.AsSpan(0, length)));
    var message = $"{request.Method}\n{request.Path}\n{userId}\n{issuedAt}\n{nonce}\n{bodyHash}";
    var expected = HMACSHA256.HashData(secret, Encoding.UTF8.GetBytes(message));
    byte[] supplied;
    try { supplied = Convert.FromHexString(signature); }
    catch (FormatException) { return Results.Unauthorized(); }
    if (!CryptographicOperations.FixedTimeEquals(expected, supplied)) return Results.Unauthorized();

    foreach (var entry in seenNonces)
        if (entry.Value < now) seenNonces.TryRemove(entry.Key, out _);
    if (!seenNonces.TryAdd(nonce, issuedAt + 30)) return Results.Unauthorized();
    context.HttpContext.Items["WorkspaceUserId"] = userId;
    return await next(context);
});

internalApi.MapTaskEndpoints();
internalApi.MapPost("/workspace/read", WorkspaceReadEndpoint.Read);
internalApi.MapPost("/flags/create", CreateFlagEndpoint.Create);
internalApi.MapPost("/boards/save", SaveBoardEndpoint.Save);
internalApi.MapPost("/lists/save", SaveListEndpoint.Save);
internalApi.MapPost("/notes/save", SaveNoteEndpoint.Save);
internalApi.MapPost("/notes/image", NoteImageEndpoint.Handle);
internalApi.MapPost("/organizations/invite", InviteMemberEndpoint.Invite);
internalApi.MapPost("/workspace/card-layout", CardLayoutEndpoint.Change);
internalApi.MapPost("/workspace/delete", DeleteWorkspaceEndpoint.Delete);

internalApi.MapGet("/handshake", (HttpContext context) =>
    Results.Ok(new { success = true, data = new { user_id = (long)context.Items["WorkspaceUserId"]! } }));

app.Run();
return 0;

file sealed class ApiRoute;
