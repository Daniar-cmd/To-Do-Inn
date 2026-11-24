using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Npgsql;

namespace Workspace.Api.Workspaces;

internal static class CreateFlagEndpoint
{
    private sealed record CreateInput([property: JsonPropertyName("board_id")] long BoardId, string? Name);

    public static async Task<IResult> Create(HttpContext context, IConfiguration configuration, ILoggerFactory loggerFactory)
    {
        var cancellation = context.RequestAborted;
        CreateInput? input;
        try
        {
            input = await context.Request.ReadFromJsonAsync<CreateInput>(cancellation);
        }
        catch (JsonException)
        {
            return Error(400, "Invalid JSON request");
        }
        return await Create(context, configuration, loggerFactory, input);
    }

    internal static Task<IResult> CreateFromRequest(HttpContext context, IConfiguration configuration,
        ILoggerFactory loggerFactory, JsonElement request)
    {
        var name = WorkspacePreviewEndpoint.Text(request, "name");
        if (name is null || name.Any(WorkspacePreviewEndpoint.IsControl))
            return Task.FromResult(Error(422, "Проверьте название флага."));
        return Create(context, configuration, loggerFactory,
            new CreateInput(WorkspacePreviewEndpoint.Id(request, "board_id") ?? 0, WorkspacePreviewEndpoint.Trim(name)));
    }

    private static async Task<IResult> Create(HttpContext context, IConfiguration configuration,
        ILoggerFactory loggerFactory, CreateInput? input)
    {
        var cancellation = context.RequestAborted;
        var name = input?.Name?.Trim(' ');
        if (input is null || input.BoardId <= 0 || string.IsNullOrEmpty(name)
            || name.EnumerateRunes().Count() > 40 || name.Any(character => character < ' ' || character == '\u007f'))
            return Error(422, "Проверьте название флага.");

        var connectionString = configuration.GetConnectionString("Workspace");
        if (string.IsNullOrWhiteSpace(connectionString))
            return Error(503, "Сервис флагов временно недоступен.");

        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellation);
            await using var transaction = await connection.BeginTransactionAsync(cancellation);
            if (!await WorkspaceActor.From(context).CheckWriteSession(transaction, context.RequestAborted))
                return Error(401, "Требуется войти в аккаунт.");
            await using var command = new NpgsqlCommand(InsertSql, connection, transaction);
            command.Parameters.AddWithValue("user_id", WorkspaceActor.From(context).Id);
            command.Parameters.AddWithValue("board_id", input.BoardId);
            command.Parameters.AddWithValue("name", name);
            IResult result;
            await using (var reader = await command.ExecuteReaderAsync(cancellation))
            {
                if (!await reader.ReadAsync(cancellation))
                    return Error(404, "Рабочая доска не найдена.");
                var flag = new { id = reader.GetInt64(0), board_id = reader.GetInt64(1), name = reader.GetString(2), color = reader.GetString(3) };
                result = Results.Json(new { success = true, data = new { flag } }, statusCode: 201);
            }
            await transaction.CommitAsync(cancellation);
            return result;
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return Error(409, "Это название уже используется. Выберите другое.");
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.ForeignKeyViolation)
        {
            return Error(404, "Рабочая доска не найдена.");
        }
        catch (Exception exception) when (exception is NpgsqlException or TimeoutException)
        {
            loggerFactory.CreateLogger(nameof(CreateFlagEndpoint)).LogError(exception, "Flag creation failed");
            return Error(503, "Сервис флагов временно недоступен.");
        }
    }

    private static IResult Error(int status, string error) =>
        Results.Json(new { success = false, error }, statusCode: status);

    private const string InsertSql = """
        INSERT INTO user_flags (user_id, board_id, name)
        SELECT b.user_id, b.id, @name
        FROM boards b
        WHERE b.id = @board_id AND (
            (b.user_id = @user_id AND b.corporate_account_id IS NULL)
            OR EXISTS (
                SELECT 1 FROM corporate_account_members m
                WHERE m.corporate_account_id = b.corporate_account_id
                  AND m.user_id = @user_id AND m.accepted_at IS NOT NULL
            )
        )
        RETURNING id, board_id, name, color
        """;
}
