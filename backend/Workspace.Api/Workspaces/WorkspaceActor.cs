using Npgsql;

namespace Workspace.Api.Workspaces;

internal readonly record struct WorkspaceActor(long Id, long? PasswordVersion = null)
{
    private static readonly object ItemKey = new();

    internal void Attach(HttpContext context) => context.Items[ItemKey] = this;

    internal static WorkspaceActor From(HttpContext context) => (WorkspaceActor)context.Items[ItemKey]!;

    internal async Task<bool> CheckWriteSession(NpgsqlTransaction transaction, CancellationToken cancellation)
    {
        // A signed compatibility request is authorized by the bridge and has no session version.
        if (PasswordVersion is not long version) return true;

        await using var writer = new NpgsqlCommand(
            "SELECT password_version FROM users WHERE id = @id FOR NO KEY UPDATE", transaction.Connection!, transaction);
        writer.Parameters.AddWithValue("id", Id);
        return await writer.ExecuteScalarAsync(cancellation) is long actual && actual == version;
    }
}
