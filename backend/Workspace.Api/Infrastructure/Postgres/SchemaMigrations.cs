using System.Security.Cryptography;
using System.Text;
using Npgsql;

namespace Workspace.Api.Infrastructure.Postgres;

internal static class SchemaMigrations
{
    private const string Journal = "public.todo_inn_schema_migrations";
    private static readonly (string Id, string Table)[] Migrations =
    [
        ("0002_auth_sessions", "public.todo_inn_auth_sessions"),
        ("0003_auth_rate_limits", "public.todo_inn_auth_rate_limits"),
    ];

    internal static async Task<int> Run(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("Usage: Workspace.Api schema:migrate");
            return 2;
        }

        using var host = Host.CreateApplicationBuilder().Build();
        var settings = host.Services.GetRequiredService<IConfiguration>();
        var connectionString = settings.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString))
            return Fail("ConnectionStrings:Workspace is missing.");

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            await SchemaBaseline.Execute(transaction, "SET LOCAL lock_timeout TO '5s'");
            await SchemaBaseline.Execute(transaction, SchemaBaseline.MigrationLockSql);
            await using var journalExists = new NpgsqlCommand($"SELECT to_regclass('{Journal}') IS NOT NULL", connection, transaction);
            if (await journalExists.ExecuteScalarAsync() is not true)
                return Fail("Record the verified Laravel baseline before applying .NET migrations.");

            await using var find = new NpgsqlCommand($"SELECT manifest_sha256 FROM {Journal} WHERE id = @id", connection, transaction);
            var id = find.Parameters.AddWithValue("id", SchemaBaseline.MigrationId);
            if (await find.ExecuteScalarAsync() is not string baseline
                || baseline != Fingerprint(SchemaBaseline.ReadResource("baseline.json")))
                return Fail("The Laravel baseline fingerprint does not match.");

            var applied = new List<string>();
            foreach (var (migration, table) in Migrations)
            {
                var sql = SchemaBaseline.ReadResource(migration + ".sql");
                var fingerprint = Fingerprint(sql);
                id.Value = migration;
                if (await find.ExecuteScalarAsync() is string recorded)
                {
                    if (recorded != fingerprint) return Fail($"The recorded fingerprint for {migration} does not match.");
                    await using var relation = new NpgsqlCommand("SELECT to_regclass(@table) IS NOT NULL", connection, transaction);
                    relation.Parameters.AddWithValue("table", table);
                    if (await relation.ExecuteScalarAsync() is not true)
                        return Fail($"The recorded migration {migration} is missing its PostgreSQL table.");
                    continue;
                }

                await SchemaBaseline.Execute(transaction, sql);
                await using var insert = new NpgsqlCommand($"INSERT INTO {Journal} (id, manifest_sha256) VALUES (@id, @hash)",
                    connection, transaction);
                insert.Parameters.AddWithValue("id", migration);
                insert.Parameters.AddWithValue("hash", fingerprint);
                await insert.ExecuteNonQueryAsync();
                applied.Add(migration);
            }

            await transaction.CommitAsync();
            if (applied.Count == 0) Console.WriteLine("All .NET migrations are already recorded.");
            foreach (var migration in applied) Console.WriteLine($"Applied .NET migration {migration}.");
            return 0;
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException or ArgumentException)
        {
            return Fail($"Schema migration could not complete ({exception.GetType().Name}).");
        }
    }

    internal static string Fingerprint(string artifact) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(artifact)));

    private static int Fail(string error)
    {
        Console.Error.WriteLine(error);
        return 1;
    }
}
