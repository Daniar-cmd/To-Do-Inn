using System.Net;
using System.Reflection;
using Microsoft.Extensions.Http;

[assembly: HostingStartup(typeof(LocalMailStartup))]

if (Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT") != "Development")
    throw new InvalidOperationException("The smoke-test host requires Development.");

Environment.SetEnvironmentVariable("ASPNETCORE_HOSTINGSTARTUPASSEMBLIES", typeof(LocalMailStartup).Assembly.GetName().Name);
var entry = Assembly.Load("Workspace.Api").EntryPoint ?? throw new InvalidOperationException("Missing API entry point.");
return entry.Invoke(null, [args]) switch
{
    int exitCode => exitCode,
    Task<int> completion => await completion,
    _ => throw new InvalidOperationException("Unexpected API entry point return type."),
};

public sealed class LocalMailStartup : IHostingStartup
{
    public void Configure(IWebHostBuilder builder)
    {
        builder.ConfigureServices(services => services.PostConfigure<HttpClientFactoryOptions>("Resend", options =>
        {
            options.HttpMessageHandlerBuilderActions.Add(handler => handler.PrimaryHandler = new LocalMailHandler());
        }));
    }
}

internal sealed class LocalMailHandler : HttpMessageHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.RequestUri?.AbsoluteUri != "https://api.resend.com/emails" || request.Method != HttpMethod.Post
            || request.Content is null)
            throw new InvalidOperationException("Unexpected mail request.");
        var capture = Environment.GetEnvironmentVariable("TODO_INN_SMOKE_MAIL")
            ?? throw new InvalidOperationException("Set TODO_INN_SMOKE_MAIL.");
        var payload = await request.Content.ReadAsStringAsync(cancellationToken);
        await File.AppendAllTextAsync(capture, payload + "\n", cancellationToken);
        return new HttpResponseMessage(File.Exists(capture + ".fail") ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.OK);
    }
}
