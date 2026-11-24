using Workspace.Api.Hosting;
using Workspace.Api.Infrastructure.Postgres;
using Workspace.Api.Workspaces.Tasks;

if (args is ["tasks:repeat", ..])
    return await RepeatTasksCommand.Run(args);
if (args is ["diagnostics:check", ..])
    return await WorkspaceReadiness.RunCommand(args);
if (args is ["schema:init", ..])
    return await InitializeWorkspaceSchema.Run(args);
if (args is ["schema:baseline", ..])
    return await SchemaBaseline.Run(args);
if (args is ["schema:migrate", ..])
    return await SchemaMigrations.Run(args);

var builder = WebApplication.CreateBuilder(args);
var hosting = ApiHosting.Configure(builder);
var app = builder.Build();

hosting.MapPublicApi(app);
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/ready", WorkspaceReadiness.Handle);
InternalApiRoutes.Map(app, hosting.PublicApiEnabled);

app.Run();
return 0;
