using System.Net;

namespace ReAI.TimeTracker.Core;

public sealed class Tracker(ReAIClient api, TrackerStore store)
{
    private LocalState state = LocalState.Empty;
    private string? token;
    public Account? Account { get; private set; }
    public Company? Company => Account?.Tenants.Single();
    public RunningTimer? Timer { get; private set; }
    public List<Project> Projects { get; private set; } = [];
    public List<Activity> Activities { get; private set; } = [];
    public PendingOperation? Pending => state.Pending;
    public SavedSession? LastSaved => state.Saved is { } saved && saved.Email == Account?.Email && saved.Company == Company?.Id ? saved : null;
    public List<WorkChoice> Recent => state.Recent.Where(r => r.Email == Account?.Email && r.Company == Company?.Id && IsAvailable(r.Work)).Select(r => r.Work).Take(5).ToList();
    public WorkChoice Selection { get; set; } = new(null, null, "Without a project", null);
    public bool Busy { get; private set; }
    public bool StorageReady { get; private set; }
    public bool Synchronized { get; private set; }
    public DateTimeOffset? LastSync { get; private set; }
    public string? ProjectNotice { get; private set; }
    public string? Error { get; private set; }
    public string? Notice { get; private set; }
    public bool CanStart => StorageReady && Account != null && Synchronized && Timer == null && Pending == null && !Busy && IsAvailable(Selection);
    public bool CanRetry => !Busy && Pending is { } pending && pending.Email == Account?.Email && pending.Company == Company?.Id;
    public Uri? TimesheetUri => Company == null ? null : new(ReAIClient.Origin, "timesheet?tenantId=" + Company.Id);
    public event Action? Changed;
    public void Load()
    {
        state = store.Load(); StorageReady = true; Changed?.Invoke();
    }
    public async Task Connect(string value)
    {
        await Guard(async () =>
        {
            var account = await api.Account(value);
            token = value; Account = account; Timer = null; Projects = []; Activities = []; Synchronized = false;
            await LoadTimer();
            await LoadProjects();
            Selection = Recent.FirstOrDefault() ?? new(null, null, "Without a project", null);
        });
    }
    public void Disconnect()
    {
        if (Busy) return;
        token = null; Account = null; Timer = null; Projects = []; Activities = []; Synchronized = false;
        Error = null; ProjectNotice = null; Notice = "Disconnected. Any running timer continues in ReAI.";
        Changed?.Invoke();
    }
    public List<Activity> AvailableActivities(int? projectId)
    {
        var project = Projects.Find(p => p.Id == projectId);
        if (project == null) return [];
        var parent = Projects.Find(p => p.Id == project.ParentId) ?? project;
        return Activities.Where(a => parent.ActivityIds.Contains(a.Id)).ToList();
    }
    public string ProjectTitle(Project project) => project.ParentId is int id && Projects.Find(p => p.Id == id) is { } parent ? parent.Name + " / " + project.Name : project.Name;
    public bool IsAvailable(WorkChoice work) => work.ProjectId == null ? work.ActivityId == null : Projects.Any(p => p.Id == work.ProjectId) && (work.ActivityId == null || AvailableActivities(work.ProjectId).Any(a => a.Id == work.ActivityId));
    public async Task Refresh(bool projects = false)
    {
        if (Account == null || Busy) return;
        await Guard(async () => { await LoadTimer(); if (projects) await LoadProjects(); });
    }
    private async Task LoadProjects()
    {
        try
        {
            var projects = await api.Get<List<Project>>("api/projects", token!, Company!.Id);
            Projects = projects.Where(p => !p.Archived && (p.ParentId == null || projects.Any(parent => parent.Id == p.ParentId && !parent.Archived))).OrderBy(p => p.Name).ToList();
            Activities = await api.Get<List<Activity>>("api/projects/activities", token!, Company.Id);
            ProjectNotice = null;
        }
        catch { Projects = []; Activities = []; ProjectNotice = "Projects are unavailable. You can still track without a project."; }
        if (!IsAvailable(Selection)) Selection = new(null, null, "Without a project", null);
    }
    private async Task LoadTimer()
    {
        Synchronized = false;
        Timer = (await api.Get<TimerStatus>("api/project-timer", token!, Company!.Id)).Timer;
        LastSync = DateTimeOffset.Now; Synchronized = true;
    }
    public async Task Start(WorkChoice? work = null)
    {
        if (work != null) Selection = work;
        if (!CanStart) return;
        await Perform(new(Account!.Email, Company!.Id, new(Guid.NewGuid(), Selection.ProjectId, Selection.ActivityId), null, Selection));
    }
    public async Task Stop()
    {
        if (Busy || Pending != null || Timer == null || Account == null) return;
        var work = new WorkChoice(Timer.ProjectId, Timer.ActivityId, Timer.ProjectName ?? (Timer.ProjectId is int id ? $"Project #{id}" : "Without a project"), Activities.Find(a => a.Id == Timer.ActivityId)?.Code);
        await Perform(new(Account.Email, Company!.Id, null, new(Timer.TimerId), work));
    }
    public async Task Retry()
    {
        if (CanRetry) await Perform(Pending!);
    }
    private async Task Perform(PendingOperation operation)
    {
        if (!StorageReady || operation.Email != Account?.Email || operation.Company != Company?.Id) return;
        await Guard(async () =>
        {
            Notice = null;
            Commit(state with { Pending = operation });
            try
            {
                if (operation.Start is { } start)
                {
                    var result = await api.Post<RunningTimer>("api/project-timer/start", start, token!, operation.Company);
                    if (result.RequestId != start.RequestId || result.TimerId <= 0) throw new InvalidDataException("Unexpected timer response. Retry the saved request.");
                    Timer = result.StoppedAt == null ? result : null;
                    var recent = state.Recent.Where(r => !(r.Email == operation.Email && r.Company == operation.Company && r.Work.ProjectId == operation.Work.ProjectId && r.Work.ActivityId == operation.Work.ActivityId)).ToList();
                    recent.Insert(0, new(operation.Email, operation.Company, operation.Work));
                    Commit(state with { Pending = null, Recent = recent.Take(30).ToList() });
                    Notice = result.StoppedAt == null ? "Timer started in ReAI." : "This session already finished in ReAI.";
                }
                else if (operation.Stop is { } stop)
                {
                    var result = await api.Post<CompletedTimer>("api/project-timer/stop", stop, token!, operation.Company);
                    if (result.TimerId != stop.TimerId || result.Minutes is < 0 or > 600) throw new InvalidDataException("Unexpected stop response. Retry the saved request.");
                    Timer = null;
                    Commit(state with { Pending = null, Saved = new(operation.Email, operation.Company, result.TimerId, result.Minutes, result.StoppedAt, operation.Work.Label) });
                    Notice = Timing.Saved(result.Minutes);
                }
            }
            catch (HttpRequestException e) when (e.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.Forbidden or HttpStatusCode.NotFound or HttpStatusCode.Conflict or HttpStatusCode.UnprocessableEntity)
            {
                Commit(state with { Pending = null }); throw;
            }
            await LoadTimer();
        });
    }
    private void Commit(LocalState next) { store.Save(next); state = next; }
    private async Task Guard(Func<Task> action)
    {
        if (Busy) return;
        Busy = true; Error = null; Changed?.Invoke();
        try { await action(); }
        catch (Exception error) { Synchronized = false; Error = error.Message; }
        finally { Busy = false; Changed?.Invoke(); }
    }
}
