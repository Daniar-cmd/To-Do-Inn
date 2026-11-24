using System.Globalization;
using System.Text.Json;
using Npgsql;

namespace Workspace.Api.Workspaces.Tasks;

internal static class RepeatTaskEndpoint
{
    public static async Task<IResult> Run(HttpContext context, TaskRecurrenceService recurrence, ILoggerFactory loggerFactory)
    {
        var ownerId = WorkspaceActor.From(context).Id;
        Guid seriesId;
        DateOnly today;
        try
        {
            using var document = await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted);
            var input = document.RootElement;
            if (input.ValueKind != JsonValueKind.Object
                || !input.TryGetProperty("action", out var action) || action.ValueKind != JsonValueKind.String
                || action.GetString() != "repeat_tasks"
                || !input.TryGetProperty("series_id", out var series) || series.ValueKind != JsonValueKind.String
                || !Guid.TryParse(series.GetString(), out seriesId) || seriesId == Guid.Empty
                || !input.TryGetProperty("as_of", out var asOf) || asOf.ValueKind != JsonValueKind.String
                || !DateOnly.TryParseExact(asOf.GetString(), "yyyy-MM-dd", CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out today) || today.Year < 1000
                || today > DateOnly.FromDateTime(DateTime.UtcNow))
                return Error(422, "Некорректная серия повторений.");
        }
        catch (JsonException) { return Error(400, "Invalid JSON request"); }

        if (!recurrence.IsConfigured) return Error(503, "Сервис задач временно недоступен.");
        try
        {
            var result = await recurrence.GenerateForBridge(ownerId, seriesId, today, context.RequestAborted);
            return result.Status switch
            {
                TaskRecurrenceService.RepeatStatus.OwnerMissing => Error(401, "Требуется войти в аккаунт."),
                TaskRecurrenceService.RepeatStatus.SeriesMoved => Error(409, "Серия перемещена. Повторите запуск."),
                _ => Results.Json(new { success = true, data = new { generated = result.Generated } }),
            };
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException or OverflowException or ArgumentOutOfRangeException or InvalidOperationException)
        {
            loggerFactory.CreateLogger("WorkspaceTasks").LogError(exception, "Repeat generation failed");
            return Error(503, "Сервис задач временно недоступен.");
        }
    }

    private static IResult Error(int status, string message) =>
        Results.Json(new { success = false, error = message }, statusCode: status);
}
