using System.Text.Json.Serialization;
using Npgsql;

namespace Workspace.Api.Accounts.Profile;

internal sealed record ProfileRecord(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("username")] string? Username,
    [property: JsonPropertyName("email")] string? Email,
    [property: JsonPropertyName("secondary_email")] string? SecondaryEmail,
    [property: JsonPropertyName("account_type")] string? AccountType,
    [property: JsonPropertyName("about")] string? About,
    [property: JsonPropertyName("github_url")] string? GithubUrl,
    [property: JsonPropertyName("telegram_url")] string? TelegramUrl,
    [property: JsonPropertyName("preferred_theme")] string? PreferredTheme,
    [property: JsonPropertyName("username_changed_at")] string? UsernameChangedAt,
    [property: JsonPropertyName("username_change_available_at")] string? UsernameChangeAvailableAt,
    [property: JsonPropertyName("avatar")] string? Avatar);

internal sealed class ProfileReader(IConfiguration configuration)
{
    private string? ConnectionString => configuration.GetConnectionString("Workspace");

    internal bool IsConfigured => !string.IsNullOrWhiteSpace(ConnectionString);

    internal async Task<ProfileRecord?> Read(long id, long version, CancellationToken cancellation)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync(cancellation);
        return await ReadRecord(connection, null, id, version, cancellation);
    }

    internal async Task<ProfileRecord?> ReadRecord(NpgsqlConnection connection, NpgsqlTransaction? transaction,
        long id, long version, CancellationToken cancellation)
    {
        await using var command = new NpgsqlCommand(ReadSql, connection, transaction);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("version", version);
        await using var reader = await command.ExecuteReaderAsync(cancellation);
        if (!await reader.ReadAsync(cancellation)) return null;
        var mime = Text(reader, 10);
        var avatar = !reader.IsDBNull(11) && mime is "image/jpeg" or "image/png" or "image/webp"
            ? $"data:{mime};base64,{Convert.ToBase64String(reader.GetFieldValue<byte[]>(11))}"
            : null;
        return new ProfileRecord(id, Text(reader, 0), Text(reader, 1), Text(reader, 2), Text(reader, 3),
            Text(reader, 4), Text(reader, 5), Text(reader, 6), Text(reader, 7), Text(reader, 8), Text(reader, 9), avatar);
    }

    private static string? Text(NpgsqlDataReader reader, int ordinal) => reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);

    private const string ReadSql = """
        SELECT username, email, secondary_email, account_type, about, github_url, telegram_url,
            preferred_theme, username_changed_at::text, (username_changed_at + INTERVAL '24 hours')::text,
            avatar_mime, avatar_data
        FROM users WHERE id = @id AND password_version = @version
        """;
}
