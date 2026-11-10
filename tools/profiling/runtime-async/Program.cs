using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;

var mode = args.Length > 1 ? args[1] : "yield";
if (mode is not ("yield" or "completed")) throw new ArgumentException("Choose yield or completed");
using var import = new ReAI.Import.Core.ReAIClient(new FixtureHandler(mode));
using var timer = new ReAI.TimeTracker.Core.ReAIClient(new FixtureHandler(mode));
var count = args.Length > 0 ? int.Parse(args[0]) : 100000;
if (count is < 1 or > 1000000) throw new ArgumentOutOfRangeException(nameof(count));
// Warm both JIT tiers before measuring; never include build time.
for (var i = 0; i < 10000; i++) await Cycle();
await Task.Delay(300);
for (var i = 0; i < 2000; i++) await Cycle();
GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
var allocated = GC.GetTotalAllocatedBytes(true);
var cpu = Process.GetCurrentProcess().TotalProcessorTime;
var elapsed = Stopwatch.StartNew();
for (var i = 0; i < count; i++) await Cycle();
elapsed.Stop();
Console.WriteLine(JsonSerializer.Serialize(new {
    mode,
    runtime = Environment.Version.ToString(),
    stateMachines = typeof(ReAI.Import.Core.ReAIClient).GetMethod("Account")!.IsDefined(typeof(System.Runtime.CompilerServices.AsyncStateMachineAttribute), false),
    iterations = count,
    elapsedMs = elapsed.Elapsed.TotalMilliseconds,
    cpuMs = (Process.GetCurrentProcess().TotalProcessorTime - cpu).TotalMilliseconds,
    bytesPerIteration = (GC.GetTotalAllocatedBytes(true) - allocated) / count
}));

async Task Cycle()
{
    var a = await import.Account("synthetic-profile-token");
    var b = await timer.Account("synthetic-profile-token");
    if (a.Email != "profile@example.invalid" || b.Tenants[0].Id != 1) throw new InvalidDataException();
}

sealed class FixtureHandler(string mode) : HttpMessageHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (mode == "yield") await Task.Yield();
        cancellationToken.ThrowIfCancellationRequested();
        return new HttpResponseMessage(HttpStatusCode.OK) {
            Content = new StringContent("""{"email":"profile@example.invalid","tenants":[{"id":1,"companyName":"Synthetic profiling company"}]}""", Encoding.UTF8, "application/json")
        };
    }
}
