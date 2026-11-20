using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
var seenNonces = new ConcurrentDictionary<string, long>();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

var internalApi = app.MapGroup("/internal").AddEndpointFilter(async (context, next) =>
{
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
    using var buffer = new MemoryStream();
    await request.Body.CopyToAsync(buffer);
    if (buffer.Length > 8192) return Results.StatusCode(413);
    request.Body.Position = 0;
    var bodyHash = Convert.ToHexStringLower(SHA256.HashData(buffer.ToArray()));
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

internalApi.MapGet("/handshake", (HttpContext context) =>
    Results.Ok(new { success = true, data = new { user_id = (long)context.Items["WorkspaceUserId"]! } }));

app.Run();
