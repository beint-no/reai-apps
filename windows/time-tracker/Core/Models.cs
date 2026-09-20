using System.Text.Json;
using System.Text.Json.Serialization;

namespace ReAI.TimeTracker.Core;

public sealed record Company(int Id, string CompanyName);
public sealed record Account(string Email, Company[] Tenants);
public sealed record Project(int Id, string Name, bool Archived, int? ParentId, int[] ActivityIds);
public sealed record Activity(int Id, string Code);
public sealed record RunningTimer(int TimerId, Guid RequestId, DateTimeOffset StartedAt, DateTimeOffset? StoppedAt, int? ProjectId, string? ProjectName, int? ActivityId);
public sealed record TimerStatus(RunningTimer? Timer);
public sealed record CompletedTimer(int TimerId, int Minutes, DateTimeOffset StoppedAt, int? ProjectId, string? ProjectName, int? ActivityId);
public sealed record StartRequest(Guid RequestId, int? ProjectId, int? ActivityId);
public sealed record StopRequest(int TimerId);
public sealed record WorkChoice(int? ProjectId, int? ActivityId, string Title, string? ActivityName)
{
    public string Label => ActivityName == null ? Title : Title + " · " + ActivityName;
}
public sealed record PendingOperation(string Email, int Company, StartRequest? Start, StopRequest? Stop, WorkChoice Work);
public sealed record RecentWork(string Email, int Company, WorkChoice Work);
public sealed record SavedSession(string Email, int Company, int TimerId, int Minutes, DateTimeOffset StoppedAt, string Label);
public sealed record LocalState(PendingOperation? Pending, List<RecentWork> Recent, SavedSession? Saved)
{
    public static LocalState Empty => new(null, [], null);
}
public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
}
public static class Timing
{
    public static int Seconds(DateTimeOffset startedAt, DateTimeOffset now) => (int)Math.Clamp((now - startedAt).TotalSeconds, 0, 36_000);
    public static string Display(int seconds) => $"{seconds / 3600:00}:{seconds / 60 % 60:00}:{seconds % 60:00}";
    public static string StopPreview(int seconds) => seconds < 60 ? $"{60 - seconds}s until the first saved minute. Stopping now saves no time." : $"Stop now to save {seconds / 60} whole minute{(seconds / 60 == 1 ? "" : "s")}.";
    public static string Saved(int minutes) => minutes == 0 ? "Stopped. Under one minute — no timesheet entry created." : $"Saved {minutes} minute{(minutes == 1 ? "" : "s")} to ReAI.";
    public const string Rules = "Stop saves to ReAI immediately, in whole minutes. Under 1 minute saves nothing. For example, 1:59 saves 1 minute.";
}
