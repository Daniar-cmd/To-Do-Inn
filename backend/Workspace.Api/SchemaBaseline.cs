using System.Data;
using System.Text.Json;
using System.Text.RegularExpressions;
using Npgsql;

internal static class SchemaBaseline
{
    internal const string MigrationId = "0001_laravel_baseline";
    internal const string MigrationLockSql = "SELECT pg_advisory_xact_lock(841924311, 2)";
    private const string Journal = "public.todo_inn_schema_migrations";
    private static readonly Regex TextArrayCasts = new(
        @"ARRAY\[(?<values>'(?:[^']|'')*'::character varying(?:, '(?:[^']|'')*'::character varying)*)\]::text\[\]"
        + @"|ARRAY\[(?<values>'(?:[^']|'')*'::character varying::text(?:, '(?:[^']|'')*'::character varying::text)*)\]",
        RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));
    private static readonly Regex StringLiteralCast = new(
        @"('(?:[^']|'')*')::character varying(?:::text)?", RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));

    internal static async Task<int> Run(string[] args)
    {
        var apply = args is [_, "--apply"];
        if (args.Length != 1 && !apply)
        {
            Console.Error.WriteLine("Usage: Workspace.Api schema:baseline [--apply]");
            return 2;
        }

        using var host = Host.CreateApplicationBuilder().Build();
        var connectionString = host.Services.GetRequiredService<IConfiguration>().GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString))
            return Fail("ConnectionStrings:Workspace is missing.");

        var snapshot = ReadResource("baseline.json");
        var expected = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(snapshot)
            ?? throw new InvalidOperationException("The embedded baseline is empty.");
        var fingerprint = SchemaMigrations.Fingerprint(snapshot);
        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync(
                apply ? IsolationLevel.ReadCommitted : IsolationLevel.RepeatableRead);
            if (!apply)
                await Execute(transaction, "SET TRANSACTION READ ONLY");
            await Execute(transaction, "SET LOCAL search_path TO pg_catalog, public");
            await Execute(transaction, "SET LOCAL lock_timeout TO '5s'");
            if (apply)
                await Execute(transaction, MigrationLockSql);

            var seen = new HashSet<string>(StringComparer.Ordinal);
            var differences = new List<string>();
            await using (var command = new NpgsqlCommand(ReadResource("baseline.catalog.sql"), connection, transaction))
            await using (var reader = await command.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    var name = reader.GetString(0);
                    using var actual = JsonDocument.Parse(reader.GetString(1));
                    if (!seen.Add(name))
                        differences.Add($"Unexpected: {name}");
                    else if (expected.TryGetValue(name, out var definition))
                    {
                        if (!Matches(name, definition, actual.RootElement))
                            differences.Add($"Changed: {name}");
                    }
                    else if (!MatchesLegacyTaskIndex(name, actual.RootElement))
                        differences.Add($"Unexpected: {name}");
                }
            }
            differences.AddRange(expected.Keys.Where(name => !seen.Contains(name)).Order(StringComparer.Ordinal)
                .Select(name => $"Missing: {name}"));
            if (differences.Count > 0)
            {
                foreach (var difference in differences.Take(30)) Console.Error.WriteLine(difference);
                if (differences.Count > 30) Console.Error.WriteLine($"Additional differences: {differences.Count - 30}");
                return Fail("Baseline refused. No changes made.");
            }

            await using var exists = new NpgsqlCommand($"SELECT to_regclass('{Journal}') IS NOT NULL", connection, transaction);
            var recorded = await exists.ExecuteScalarAsync() is true;
            if (recorded)
            {
                await using var entry = new NpgsqlCommand($"SELECT manifest_sha256 FROM {Journal} WHERE id = @id",
                    connection, transaction);
                entry.Parameters.AddWithValue("id", MigrationId);
                if (await entry.ExecuteScalarAsync() is not string saved || saved != fingerprint)
                    return Fail("The .NET migration journal does not contain the expected baseline fingerprint. No changes made.");
            }
            else if (apply)
            {
                // The adopted tables and Laravel history remain in place. This is the only object created.
                await Execute(transaction, $"""
                    CREATE TABLE {Journal} (
                        id text PRIMARY KEY,
                        manifest_sha256 text NOT NULL,
                        applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """);
                await using var insert = new NpgsqlCommand($"""
                    INSERT INTO {Journal} (id, manifest_sha256) VALUES (@id, @fingerprint)
                    """, connection, transaction);
                insert.Parameters.AddWithValue("id", MigrationId);
                insert.Parameters.AddWithValue("fingerprint", fingerprint);
                await insert.ExecuteNonQueryAsync();
            }
            await transaction.CommitAsync();
            Console.WriteLine(recorded ? "Schema and Laravel history match. The .NET baseline is already recorded."
                : apply ? "Baseline recorded. Only the .NET migration journal was written."
                : "Schema and Laravel history match. Read-only check completed.");
            return 0;
        }
        catch (PostgresException exception) when (exception.SqlState is PostgresErrorCodes.UndefinedTable or PostgresErrorCodes.UndefinedColumn)
        {
            return Fail("Required Laravel migration history or .NET journal structure is missing. No changes made.");
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException or ArgumentException)
        {
            return Fail($"Baseline could not complete ({exception.GetType().Name}).");
        }
    }

    private static bool Matches(string name, JsonElement expected, JsonElement actual)
    {
        if (JsonElement.DeepEquals(expected, actual)) return true;
        if (!name.StartsWith("constraint:", StringComparison.Ordinal)
            || expected[0].GetString() != "c" || actual[0].GetString() != "c"
            || !JsonElement.DeepEquals(expected[1], actual[1]))
            return false;

        // pg_dump can rewrite a text[] cast as equivalent casts on the individual varchar literals.
        return NormalizeTextArrayCasts(expected[2].GetString()!) == NormalizeTextArrayCasts(actual[2].GetString()!);
    }

    private static string NormalizeTextArrayCasts(string constraint) =>
        TextArrayCasts.Replace(constraint, match => "ARRAY[" + StringLiteralCast.Replace(match.Groups["values"].Value, "$1::text") + "]");

    // Some adopted databases retain this non-unique index from before Laravel.
    private static bool MatchesLegacyTaskIndex(string name, JsonElement actual) =>
        name == "index:tasks.tasks_list_created_idx"
        && actual[0].GetBoolean() && actual[1].GetBoolean()
        && actual[2].GetString() == "CREATE INDEX tasks_list_created_idx ON public.tasks USING btree (list_id, created_at, id)";

    internal static async Task Execute(NpgsqlTransaction transaction, string sql)
    {
        await using var command = new NpgsqlCommand(sql, transaction.Connection!, transaction);
        await command.ExecuteNonQueryAsync();
    }

    internal static string ReadResource(string name)
    {
        using var stream = typeof(SchemaBaseline).Assembly.GetManifestResourceStream("Migrations." + name)
            ?? throw new InvalidOperationException("The embedded baseline resource is missing.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private static int Fail(string message)
    {
        Console.Error.WriteLine(message);
        return 1;
    }
}
