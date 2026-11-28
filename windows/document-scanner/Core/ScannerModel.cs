namespace ReAI.DocumentScanner.Core;

/// <summary>
/// Uploads, duplicate detection and watched folders. Methods run on the UI thread; folder events are posted back to it.
/// An upload without a definite answer becomes "Check ReAI" and is only retried after the user confirms.
/// </summary>
public sealed class ScannerModel(ReAIClient api, Store store, Stager stager)
{
    private const string Unreadable = "Upload history could not be read. Uploads are paused so nothing is sent twice.";
    private readonly SynchronizationContext? ui = SynchronizationContext.Current;
    private LocalState state = new();
    private string? token;
    private bool running;
    private readonly Dictionary<Guid, FileSystemWatcher> watchers = [];
    private readonly Dictionary<Guid, Task> folderScans = [];
    private readonly HashSet<Guid> folderChanges = [];
    private readonly HashSet<Guid> announced = [];

    public event Action? Changed;
    /// <summary>Title and message for a notification, such as the result of a hotkey capture.</summary>
    public event Action<string, string>? Notify;
    public Company? Company { get; private set; }
    public string Email { get; private set; } = "";
    public bool Readable { get; private set; }
    public bool Paused { get; private set; }
    public bool Uploading => running;
    public string? Error { get; set; }
    public string? Notice { get; set; }
    public Dictionary<Guid, string> FolderStatus { get; } = [];

    public Destination Destination { get => state.Destination; set => Remember(() => state.Destination = value); }
    public Destination QuickDestination { get => state.QuickDestination; set => Remember(() => state.QuickDestination = value); }
    public IEnumerable<Transfer> Transfers => state.Transfers.Where(transfer => transfer.Company.Id == Company?.Id).Reverse();
    public IEnumerable<WatchedFolder> Folders => state.Folders.Where(folder => folder.Company.Id == Company?.Id && folder.AccountEmail == Email);
    public int Pending => Transfers.Count(transfer => transfer.Status is Status.Queued or Status.Uploading);
    public bool NeedsAttention => Error != null || Transfers.Any(transfer => transfer.Status is Status.CheckReAI or Status.Rejected);
    public string UploadStatus => Company == null ? "Connect to ReAI to upload documents"
        : NeedsAttention ? "Uploads need attention" : Paused ? "Uploads paused" : Pending > 0 ? $"{Pending} uploads waiting" : "No uploads waiting";

    private void Post(Action action)
    {
        if (ui == null) action(); else ui.Post(_ => action(), null);
    }
    private void Save()
    {
        // Never replace a state file that could not be read: it holds the upload history used against duplicates.
        if (!Readable) throw new InvalidOperationException(Unreadable);
        store.Save(state);
    }
    private void Remember(Action change)
    {
        change();
        try { Save(); } catch (Exception e) { Error = e.Message; }
        Changed?.Invoke();
    }

    public void Load()
    {
        try
        {
            state = store.Load(); Readable = true;
            Paused = state.Transfers.Any(transfer => transfer.Status == Status.Queued);
            if (Paused) Notice = "Uploads from the last session are waiting. Resume to send them.";
        }
        catch { Error = Unreadable; Paused = true; }
        Changed?.Invoke();
    }

    public async Task<bool> Connect(string key)
    {
        if (Uploading) return false;
        try
        {
            (Email, Company) = await api.Account(key);
            token = key; Error = null;
            RestoreFolders();
            RunQueue();
            return true;
        }
        catch (Exception e) { Error = e.Message; return false; }
        finally { Changed?.Invoke(); }
    }

    public bool Disconnect()
    {
        if (Uploading) { Error = "Pause and wait for the current upload before disconnecting."; Changed?.Invoke(); return false; }
        StopFolders();
        token = null; Company = null; Email = "";
        Changed?.Invoke();
        return true;
    }

    public void SetPaused(bool paused)
    {
        Paused = paused;
        if (!paused) { Notice = null; RunQueue(); }
        Changed?.Invoke();
    }

    public Task Add(IEnumerable<string> paths) => Company is { } company ? Stage(paths, company, Destination) : Task.FromResult(false);
    public Task QuickAdd(IEnumerable<string> paths)
    {
        if (Company is { } company) return Stage(paths, company, QuickDestination);
        Error = "Connect to ReAI before dropping files."; Changed?.Invoke();
        return Task.CompletedTask;
    }

    /// <summary>Stages a file the app created (capture or scan) and removes its temporary folder.</summary>
    public async Task<bool> AddCreated(string path, Destination destination, bool announce)
    {
        try
        {
            if (Company is not { } company)
            {
                Error = $"Connect to ReAI to upload {Path.GetFileName(path)}.";
                if (announce) Notify?.Invoke("Not uploaded", "Connect ReAI Document Scanner to a company first.");
                return false;
            }
            var before = state.Transfers.Select(transfer => transfer.Id).ToHashSet();
            var succeeded = await Stage([path], company, destination);
            if (announce)
            {
                var added = state.Transfers.FirstOrDefault(transfer => !before.Contains(transfer.Id));
                if (added is { Status: not Status.Duplicate })
                {
                    announced.Add(added.Id);
                    if (Paused) Notify?.Invoke("Capture saved", $"Uploads are paused. Resume to send it to {destination.Title()}.");
                }
                else Notify?.Invoke(succeeded ? "Already uploaded" : "Not uploaded", succeeded ? Notice ?? "The same file was uploaded before." : Error ?? "The capture could not be saved.");
            }
            return succeeded;
        }
        finally
        {
            try { Directory.Delete(Path.GetDirectoryName(path)!, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            Changed?.Invoke();
        }
    }

    private async Task<bool> Stage(IEnumerable<string> paths, Company company, Destination destination, bool waitForBusy = false)
    {
        bool succeeded = true;
        foreach (var path in paths)
        {
            try
            {
                if (!Readable) throw new InvalidOperationException(Unreadable);
                var result = await stager.Stage(path, company, destination, state.Transfers.Select(transfer => transfer.Fingerprint).ToHashSet());
                if (result.Staged is { } entry)
                {
                    if (state.Transfers.Any(transfer => transfer.Fingerprint == entry.Fingerprint)) RecordDuplicate(path, entry.Fingerprint);
                    else { state.Transfers.Add(entry); Save(); }
                }
                else if (result.Duplicate is { } fingerprint) RecordDuplicate(path, fingerprint);
            }
            catch (FileBusyException) when (waitForBusy) { throw; }
            catch (Exception e) { Error = e.Message; succeeded = false; }
        }
        RunQueue();
        Changed?.Invoke();
        return succeeded;
    }

    private void RecordDuplicate(string source, string fingerprint)
    {
        if (state.Transfers.FirstOrDefault(transfer => transfer.Fingerprint == fingerprint && transfer.Status != Status.Duplicate) is not { } original) return;
        var name = Path.GetFileName(source);
        var match = original.RemoteId is int id ? $"ReAI document #{id}" : $"existing upload ({original.Status.ToLowerInvariant()})";
        var detail = $"Same contents as {original.Filename}: {match}.";
        Notice = $"Duplicate skipped: {name} ({original.Company.CompanyName}). {detail}";
        if (!state.Transfers.Any(transfer => transfer.Status == Status.Duplicate && transfer.Filename == name && transfer.Fingerprint == fingerprint))
            state.Transfers.Add(new Transfer { Company = original.Company, Destination = original.Destination, Filename = name, Fingerprint = fingerprint, File = original.File, Status = Status.Duplicate, Detail = detail, RemoteId = original.RemoteId });
        Save();
    }

    public void RunQueue()
    {
        if (running || token == null || Paused || !Readable) return;
        running = true;
        _ = Work();
    }

    private async Task Work()
    {
        try
        {
            while (!Paused && token is { } key && Company is { } company &&
                   state.Transfers.FirstOrDefault(entry => entry.Status == Status.Queued && entry.Company.Id == company.Id) is { } transfer)
            {
                transfer.Status = Status.Uploading;
                try { Save(); }
                catch (Exception e) { transfer.Status = Status.Queued; Error = e.Message; break; }
                Changed?.Invoke();
                try
                {
                    var id = await api.Upload(transfer, key);
                    transfer.RemoteId = id; transfer.Status = Status.Uploaded; transfer.Detail = $"ReAI document #{id}";
                }
                catch (UploadRejectedException e) { transfer.Status = Status.Rejected; transfer.Detail = e.Message; }
                catch (Exception e)
                {
                    transfer.Status = Status.CheckReAI;
                    transfer.Detail = e.Message + (e.Message.EndsWith('.') ? " " : ". ") + "Check ReAI before retrying; the server may have received the file.";
                }
                if (announced.Remove(transfer.Id)) Announce(transfer);
                try { Save(); } catch (Exception e) { Error = e.Message; Paused = true; }
                Changed?.Invoke();
            }
        }
        finally { running = false; Changed?.Invoke(); }
    }

    private void Announce(Transfer transfer) => Notify?.Invoke(transfer.Status switch
    {
        Status.Uploaded => $"Uploaded to {transfer.Destination.Title()}",
        Status.Rejected => "Not uploaded",
        _ => "Check ReAI"
    }, transfer.Status switch
    {
        Status.Uploaded => $"{transfer.Filename} · {transfer.Detail}",
        Status.Rejected => $"{transfer.Filename}: {transfer.Detail}",
        _ => $"{transfer.Filename} may not have uploaded. Check ReAI before retrying."
    });

    /// <summary>Uncertain uploads are retried only after the user has checked ReAI (the caller confirms). Rejected ones directly.</summary>
    public void Retry(Guid id)
    {
        if (state.Transfers.FirstOrDefault(transfer => transfer.Id == id) is not { Status: Status.CheckReAI or Status.Rejected } transfer) return;
        transfer.Status = Status.Queued; transfer.Detail = "";
        try { Save(); RunQueue(); } catch (Exception e) { Error = e.Message; }
        Changed?.Invoke();
    }

    // Watched folders

    public void AddFolder(string path)
    {
        try
        {
            if (Company is not { } company) return;
            var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
            var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetDirectoryName(stager.Root) ?? stager.Root));
            if (full.Equals(root, StringComparison.OrdinalIgnoreCase) || full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Choose a folder outside the app's own data folder.");
            if (state.Folders.Any(folder => folder.Path.Equals(full, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidOperationException("This folder is already mapped. Remove its existing mapping before assigning it again.");
            var entry = new WatchedFolder { Company = company, Destination = Destination, AccountEmail = Email, Path = full, KnownFiles = Stager.Snapshot(full) };
            state.Folders.Add(entry);
            Save();
            Activate(entry);
        }
        catch (Exception e) { Error = e.Message; }
        Changed?.Invoke();
    }

    public void SetFolderEnabled(Guid id, bool enabled)
    {
        if (state.Folders.FirstOrDefault(folder => folder.Id == id) is not { } folder) return;
        folder.Enabled = enabled;
        StopFolder(id);
        try { Save(); FolderStatus[id] = enabled ? "Starting…" : "Paused"; if (enabled) Activate(folder); }
        catch (Exception e) { Error = e.Message; }
        Changed?.Invoke();
    }

    public void RemoveFolder(Guid id)
    {
        StopFolder(id);
        state.Folders.RemoveAll(folder => folder.Id == id);
        FolderStatus.Remove(id);
        try { Save(); } catch (Exception e) { Error = e.Message; }
        Changed?.Invoke();
    }

    private void RestoreFolders()
    {
        StopFolders();
        foreach (var folder in state.Folders.Where(folder => folder.Enabled && folder.AccountEmail == Email && folder.Company.Id == Company?.Id).ToList()) Activate(folder);
    }

    private void StopFolders()
    {
        foreach (var id in watchers.Keys.ToList()) StopFolder(id);
        FolderStatus.Clear();
    }

    private void StopFolder(Guid id)
    {
        if (watchers.Remove(id, out var watcher)) watcher.Dispose();
        folderChanges.Remove(id);
    }

    private void Activate(WatchedFolder folder)
    {
        if (token == null || !folder.Enabled || folder.AccountEmail != Email || folder.Company.Id != Company?.Id) return;
        StopFolder(folder.Id);
        try
        {
            if (!Directory.Exists(folder.Path)) throw new DirectoryNotFoundException($"{Path.GetFileName(folder.Path)} is no longer available.");
            var watcher = new FileSystemWatcher(folder.Path) { IncludeSubdirectories = false, NotifyFilter = NotifyFilters.FileName | NotifyFilters.Size | NotifyFilters.LastWrite };
            void OnChange(object? _, EventArgs __) => Post(() => ScheduleFolderScan(folder.Id));
            watcher.Created += OnChange; watcher.Changed += OnChange; watcher.Renamed += OnChange;
            watcher.Error += (_, _) => Post(() => ScheduleFolderScan(folder.Id));
            watcher.EnableRaisingEvents = true;
            watchers[folder.Id] = watcher;
            FolderStatus[folder.Id] = "Watching";
            ScheduleFolderScan(folder.Id);
        }
        catch (Exception e)
        {
            StopFolder(folder.Id);
            FolderStatus[folder.Id] = "Unavailable. Remove it and choose the folder again.";
            Error = e.Message;
        }
    }

    public void ScheduleFolderScan(Guid id)
    {
        if (!watchers.ContainsKey(id)) return;
        folderChanges.Add(id);
        if (folderScans.ContainsKey(id)) return;
        // A scan that finishes without waiting has already removed itself.
        var scan = ScanFolder(id);
        if (!scan.IsCompleted) folderScans[id] = scan;
    }

    /// <summary>Uploads new or changed files once their size and time have stayed the same between two scans.</summary>
    private async Task ScanFolder(Guid id)
    {
        try
        {
            var previous = new Dictionary<string, FileStamp>();
            for (int attempt = 1; watchers.ContainsKey(id) && token != null; attempt++)
            {
                folderChanges.Remove(id);
                if (attempt > 100) { FolderStatus[id] = "Still copying. Use Scan after the copy finishes."; return; }
                if (state.Folders.FirstOrDefault(folder => folder.Id == id && folder.Enabled) is not { } folder || folder.AccountEmail != Email) return;
                var snapshot = await Task.Run(() => Stager.Snapshot(folder.Path));
                bool waiting = false;
                foreach (var (name, stamp) in snapshot)
                {
                    if (folder.KnownFiles.GetValueOrDefault(name) == stamp) continue;
                    if (!watchers.ContainsKey(id)) return;
                    if (previous.GetValueOrDefault(name) != stamp || stamp.Size == 0) { waiting = true; continue; }
                    FolderStatus[id] = $"Queuing {name}"; Changed?.Invoke();
                    bool success;
                    try { success = await Stage([Path.Combine(folder.Path, name)], folder.Company, folder.Destination, waitForBusy: true); }
                    catch (FileBusyException) { waiting = true; continue; }
                    if (!success) { FolderStatus[id] = "File needs attention. Check the upload error, then Scan."; return; }
                    folder.KnownFiles[name] = stamp;
                    Save();
                }
                previous = snapshot;
                if (!waiting && !folderChanges.Contains(id)) { FolderStatus[id] = "Watching"; return; }
                FolderStatus[id] = "Waiting for files to finish copying…"; Changed?.Invoke();
                await Task.Delay(TimeSpan.FromSeconds(3));
            }
        }
        catch (Exception e) { FolderStatus[id] = "Cannot scan folder"; Error = e.Message; }
        finally { folderScans.Remove(id); Changed?.Invoke(); }
    }
}
