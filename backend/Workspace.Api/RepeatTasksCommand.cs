using Npgsql;

internal static class RepeatTasksCommand
{
    internal static async Task<int> Run(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("Usage: Workspace.Api tasks:repeat");
            return 2;
        }

        using var host = Host.CreateApplicationBuilder().Build();
        var configuration = host.Services.GetRequiredService<IConfiguration>();
        var logger = host.Services.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(RepeatTasksCommand));
        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            logger.LogError("ConnectionStrings:Workspace is required to generate repeating tasks");
            return 1;
        }

        using var stop = new CancellationTokenSource();
        ConsoleCancelEventHandler onCancel = (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            stop.Cancel();
        };
        Console.CancelKeyPress += onCancel;
        try
        {
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(stop.Token);
            var series = await ReadActiveSeries(connection, stop.Token);
            long generated = 0;
            foreach (var (ownerId, seriesId) in series)
            {
                var result = await RepeatTaskEndpoint.Generate(connection, ownerId, seriesId, today,
                    lockOwner: true, stop.Token);
                if (result.Status == RepeatTaskEndpoint.RepeatStatus.SeriesMoved)
                {
                    logger.LogError("A repeat series moved during generation. Run the command again");
                    return 1;
                }
                generated += result.Generated;
            }

            logger.LogInformation("Generated {TaskCount} repeating tasks across {SeriesCount} active series",
                generated, series.Count);
            return 0;
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested)
        {
            return 130;
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException or OverflowException
            or ArgumentException or InvalidOperationException)
        {
            logger.LogError("Repeat generation failed: {ErrorType}", exception.GetType().Name);
            return 1;
        }
        finally
        {
            Console.CancelKeyPress -= onCancel;
        }
    }

    private static async Task<List<(long OwnerId, Guid SeriesId)>> ReadActiveSeries(
        NpgsqlConnection connection, CancellationToken cancellation)
    {
        await using var command = new NpgsqlCommand("""
            SELECT DISTINCT user_id, repeat_series_id
            FROM tasks
            WHERE repeat_interval IS NOT NULL AND repeat_series_id IS NOT NULL
            ORDER BY user_id, repeat_series_id
            """, connection);
        await using var row = await command.ExecuteReaderAsync(cancellation);
        var series = new List<(long, Guid)>();
        while (await row.ReadAsync(cancellation))
            series.Add((row.GetInt64(0), row.GetGuid(1)));
        return series;
    }
}
