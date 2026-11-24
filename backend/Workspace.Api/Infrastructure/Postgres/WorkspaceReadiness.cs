using Npgsql;

namespace Workspace.Api.Infrastructure.Postgres;

internal static class WorkspaceReadiness
{
    private enum Status
    {
        Ready,
        NotConfigured,
        InvalidConfiguration,
        DatabaseUnavailable,
        SchemaMismatch,
        InsufficientPrivileges,
    }

    internal static async Task<IResult> Handle(HttpContext context, IConfiguration configuration, IHostEnvironment environment)
    {
        context.Response.Headers.CacheControl = "no-store";
        var status = await Check(configuration, environment, context.RequestAborted);
        return status == Status.Ready
            ? Results.Ok(new { status = "ready" })
            : Results.Json(new { status = "not_ready" }, statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    internal static async Task<int> RunCommand(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("Usage: Workspace.Api diagnostics:check");
            return 2;
        }

        using var host = Host.CreateApplicationBuilder().Build();
        var configuration = host.Services.GetRequiredService<IConfiguration>();
        var status = await Check(configuration, host.Services.GetRequiredService<IHostEnvironment>(), CancellationToken.None);
        switch (status)
        {
            case Status.Ready:
                Console.WriteLine("Ready: PostgreSQL is reachable and the workspace schema is readable.");
                return 0;
            case Status.NotConfigured:
                Console.Error.WriteLine("ConnectionStrings:Workspace is missing.");
                break;
            case Status.InvalidConfiguration:
                Console.Error.WriteLine("ConnectionStrings:Workspace is invalid.");
                break;
            case Status.SchemaMismatch:
                Console.Error.WriteLine("PostgreSQL is reachable, but the workspace schema is missing required tables or columns.");
                break;
            case Status.InsufficientPrivileges:
                Console.Error.WriteLine("PostgreSQL is reachable, but the configured role cannot read the workspace schema.");
                break;
            default:
                Console.Error.WriteLine("The PostgreSQL readiness check could not complete.");
                break;
        }
        return 1;
    }

    private static async Task<Status> Check(IConfiguration configuration, IHostEnvironment environment, CancellationToken cancellation)
    {
        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString)) return Status.NotConfigured;

        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(TimeSpan.FromSeconds(5));
        try
        {
            var settings = new NpgsqlConnectionStringBuilder(connectionString)
            {
                Timeout = 3,
                CommandTimeout = 3,
            };
            await using var connection = new NpgsqlConnection(settings.ConnectionString);
            await connection.OpenAsync(deadline.Token);
            var persistentSessions = (environment.IsProduction() && configuration.GetValue<bool>("PublicApi:Enabled"))
                || (environment.IsDevelopment() && configuration.GetValue<bool>("AuthPreview:Enabled")
                    && !string.IsNullOrWhiteSpace(configuration["AuthPreview:SessionKeyDirectory"]));
            await using var command = new NpgsqlCommand(persistentSessions ? SchemaProbe + SessionProbe : SchemaProbe, connection);
            await command.ExecuteNonQueryAsync(deadline.Token);
            return Status.Ready;
        }
        catch (ArgumentException) { return Status.InvalidConfiguration; }
        catch (PostgresException exception) when (exception.SqlState is
            PostgresErrorCodes.UndefinedTable or PostgresErrorCodes.UndefinedColumn or PostgresErrorCodes.InvalidSchemaName)
        {
            return Status.SchemaMismatch;
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.InsufficientPrivilege)
        {
            return Status.InsufficientPrivileges;
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException
            || exception is OperationCanceledException && !cancellation.IsCancellationRequested)
        {
            return Status.DatabaseUnavailable;
        }
    }

    // PostgreSQL checks relation names, column names and SELECT grants without returning user rows.
    private const string SchemaProbe = """
        SELECT u.id, b.id, l.id, t.repeat_series_id, n.image_mime, f.id, a.id, m.accepted_at
        FROM users u
        CROSS JOIN boards b
        CROSS JOIN task_lists l
        CROSS JOIN tasks t
        CROSS JOIN notes n
        CROSS JOIN user_flags f
        CROSS JOIN corporate_accounts a
        CROSS JOIN corporate_account_members m
        WHERE FALSE
        """;

    private const string SessionProbe = """
        ;
        SELECT cache_key, data, expires_at, absolute_expires_at, sliding_seconds
        FROM public.todo_inn_auth_sessions WHERE FALSE;
        SELECT bucket_key, request_count, expires_at
        FROM public.todo_inn_auth_rate_limits WHERE FALSE
        """;
}
