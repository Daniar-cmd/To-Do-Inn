using Npgsql;

namespace Workspace.Api.Workspaces.Tasks;

internal static class RepeatTasksCommand
{
    internal static async Task<int> Run(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("Usage: Workspace.Api tasks:repeat");
            return 2;
        }

        var builder = Host.CreateApplicationBuilder();
        builder.Services.AddSingleton<TaskRecurrenceService>();
        using var host = builder.Build();
        var recurrence = host.Services.GetRequiredService<TaskRecurrenceService>();
        var logger = host.Services.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(RepeatTasksCommand));
        if (!recurrence.IsConfigured)
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
            var result = await recurrence.GenerateAll(today, stop.Token);
            if (result.SeriesMoved)
            {
                logger.LogError("A repeat series moved during generation. Run the command again");
                return 1;
            }

            logger.LogInformation("Generated {TaskCount} repeating tasks across {SeriesCount} active series",
                result.Generated, result.SeriesCount);
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
}
