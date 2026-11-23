using Npgsql;
using NpgsqlTypes;

internal static class InitializeWorkspaceSchema
{
    internal static async Task<int> Run(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("Usage: Workspace.Api schema:init");
            return 2;
        }

        using var host = Host.CreateApplicationBuilder().Build();
        if (!host.Services.GetRequiredService<IHostEnvironment>().IsDevelopment())
            return Fail("Schema initialization is available only in Development.");

        try
        {
            var settings = host.Services.GetRequiredService<IConfiguration>();
            var target = new NpgsqlConnectionStringBuilder(settings.GetConnectionString("Workspace") ?? "");
            if (target.Host is not ("127.0.0.1" or "localhost" or "::1") || string.IsNullOrWhiteSpace(target.Database))
                return Fail("Schema initialization requires an explicitly named loopback PostgreSQL database.");

            await using var connection = new NpgsqlConnection(target.ConnectionString);
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            await SchemaBaseline.Execute(transaction, "SET LOCAL search_path TO pg_catalog");
            await SchemaBaseline.Execute(transaction, "SET LOCAL lock_timeout TO '5s'");
            await SchemaBaseline.Execute(transaction, SchemaBaseline.MigrationLockSql);

            await using var check = new NpgsqlCommand("""
                SELECT EXISTS (
                    SELECT FROM pg_class WHERE relnamespace = to_regnamespace('public')
                    UNION ALL SELECT FROM pg_proc WHERE pronamespace = to_regnamespace('public')
                    UNION ALL SELECT FROM pg_type WHERE typnamespace = to_regnamespace('public')
                )
                """, connection, transaction);
            if (await check.ExecuteScalarAsync() is true)
                return Fail("The public schema is not empty. Use schema:baseline for an existing workspace.");

            await SchemaBaseline.Execute(transaction, SchemaBaseline.ReadResource("initial-schema.sql"));
            await using var history = new NpgsqlCommand("""
                INSERT INTO public.migrations (migration, batch)
                SELECT substr(name, 9), 1
                FROM jsonb_object_keys(@baseline) AS entries(name)
                WHERE starts_with(name, 'laravel:')
                ORDER BY name
                """, connection, transaction);
            history.Parameters.AddWithValue("baseline", NpgsqlDbType.Jsonb, SchemaBaseline.ReadResource("baseline.json"));
            await history.ExecuteNonQueryAsync();
            await transaction.CommitAsync();
            Console.WriteLine("Empty workspace schema created. Run schema:baseline --apply and schema:migrate.");
            return 0;
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException or ArgumentException)
        {
            return Fail($"Schema initialization could not complete ({exception.GetType().Name}).");
        }
    }

    private static int Fail(string message)
    {
        Console.Error.WriteLine(message);
        return 1;
    }
}
