using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Workspace.Api.Organizations;
using Workspace.Api.Workspaces;
using Workspace.Api.Workspaces.Notes;
using Workspace.Api.Workspaces.Tasks;

namespace Workspace.Api.Hosting;

internal sealed class InternalApiRoutes(IConfiguration configuration, bool publicApi) : IEndpointFilter
{
    private readonly ConcurrentDictionary<string, long> seenNonces = new();

    internal static void Map(WebApplication app, bool publicApi)
    {
        var internalApi = app.MapGroup("/internal")
            .AddEndpointFilter(new InternalApiRoutes(app.Configuration, publicApi));

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
            Results.Ok(new { success = true, data = new { user_id = WorkspaceActor.From(context).Id } }));
    }

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        if (publicApi) return Results.NotFound();
        var request = context.HttpContext.Request;
        var remote = context.HttpContext.Connection.RemoteIpAddress;
        if (remote is null || !IPAddress.IsLoopback(remote)) return Results.StatusCode(403);

        var secretText = configuration["WorkspaceBridge:Secret"];
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
        new WorkspaceActor(userId).Attach(context.HttpContext);
        return await next(context);
    }
}
