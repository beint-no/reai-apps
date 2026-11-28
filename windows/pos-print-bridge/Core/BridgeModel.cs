using System.Globalization;

namespace ReAI.POSPrintBridge.Core;

/// <summary>Polls ReAI for new fiscal receipts on the chosen cash points and prints each original once. Runs on the UI thread.</summary>
public sealed class BridgeModel(ReAIClient api, Store store, IRawPrinting printing)
{
    /// <summary>Polling interval while healthy; errors back off to at most one minute.</summary>
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(3);
    /// <summary>Each poll re-reads this much of the past so late-arriving receipts are not missed.</summary>
    public static readonly TimeSpan Overlap = TimeSpan.FromMinutes(10);
    /// <summary>Receipts older than this are not printed automatically after downtime.</summary>
    public static readonly TimeSpan AutoPrintLimit = TimeSpan.FromHours(24);

    private string? token;
    private Merchant? merchant;
    private Dictionary<string, decimal> vatRates = [];
    private DateTimeOffset? referenceLoaded;
    private readonly Dictionary<long, Sale> sales = [];
    private TimeSpan clockOffset;
    private int failures;
    private DateTimeOffset printerRetryAt = DateTimeOffset.MinValue;

    public event Action? Changed;
    public BridgeState State { get; private set; } = new();
    public bool Readable { get; private set; }
    public Company? Company { get; private set; }
    public bool Busy { get; private set; }
    public bool Finding { get; private set; }
    public string Status { get; private set; } = "Starting…";
    public DateTimeOffset? LastCheck { get; private set; }
    public string? ConnectionProblem { get; private set; }
    public string? PrinterProblem { get; private set; }
    public string? Error { get; set; }
    public string? Notice { get; set; }

    public IEnumerable<ReceiptRecord> Receipts => State.Receipts.Where(record => record.TenantId == Company?.Id).OrderByDescending(record => record.Id);
    public int Waiting => Receipts.Count(record => record.State == ReceiptState.Pending);
    public IEnumerable<ReceiptRecord> Attention => Receipts.Where(record => record.State is ReceiptState.Uncertain or ReceiptState.Blocked or ReceiptState.Skipped || record.Copy == CopyState.Uncertain);
    public IEnumerable<int> KnownCashPoints => State.KnownCashPoints.Keys.Select(key => int.TryParse(key, out var id) ? id : 0).Where(id => id > 0).Concat(State.CashPoints).Distinct().Order();
    public DateTimeOffset ServerNow => DateTimeOffset.UtcNow + clockOffset;
    public bool Selecting => State.AllCashPoints || State.CashPoints.Count > 0;
    public bool Problem => Error != null || ConnectionProblem != null || PrinterProblem != null || Attention.Any();
    public string? Hint(int id) => State.KnownCashPoints.GetValueOrDefault(id.ToString(CultureInfo.InvariantCulture));

    public void Load()
    {
        try
        {
            State = store.Load();
            Readable = true;
            bool changed = false;
            foreach (var record in State.Receipts)
            {
                if (record.State == ReceiptState.Printing) { record.State = ReceiptState.Uncertain; record.Detail = "The app stopped while printing. Check the printer before printing again."; changed = true; }
                if (record.Copy == CopyState.Printing) { record.Copy = CopyState.Uncertain; changed = true; }
            }
            if (changed) Save();
        }
        catch
        {
            Readable = false;
            Error = $"The receipt ledger could not be read. Printing is paused to prevent duplicates. Move {store.FilePath} away to start over.";
        }
        Changed?.Invoke();
    }

    /// <summary>Checks the token and loads company details. The caller saves the token only after this succeeds.</summary>
    public async Task Activate(string accessToken)
    {
        var company = await api.Account(accessToken);
        token = accessToken;
        Company = company;
        if (State.TenantId != company.Id)
        {
            // Another company: start a fresh selection, keep the other company's receipt history.
            State.TenantId = company.Id;
            State.AllCashPoints = false; State.CashPoints = []; State.KnownCashPoints = []; State.Baselines = []; State.Cursors = [];
            Save();
        }
        await LoadReference(force: true);
        if (State.KnownCashPoints.Count == 0) await FindCashPoints();
        Changed?.Invoke();
    }

    public void Disconnect()
    {
        token = null; Company = null; merchant = null; referenceLoaded = null; sales.Clear();
        Notice = "Disconnected. Revoke access in your ReAI profile to remove it from ReAI.";
        Changed?.Invoke();
    }

    private async Task LoadReference(bool force)
    {
        if (token == null || Company == null) return;
        if (!force && referenceLoaded is { } loaded && DateTimeOffset.UtcNow - loaded < TimeSpan.FromHours(6)) return;
        merchant = await api.Merchant(token, Company.Id);
        vatRates = await api.VatRates(token, Company.Id);
        referenceLoaded = DateTimeOffset.UtcNow;
    }

    public async Task FindCashPoints()
    {
        if (token == null || Company == null) return;
        Finding = true; Changed?.Invoke();
        try
        {
            for (int page = 1; page <= 5; page++)
            {
                var result = await api.Sales(token, Company.Id, ServerNow.AddDays(-30), null, page);
                AdjustClock(result.ServerDate);
                foreach (var sale in result.Value.Items) State.KnownCashPoints[sale.CashPointId.ToString(CultureInfo.InvariantCulture)] = $"Last receipt {sale.ReceiptNumber}";
                if (!result.Value.HasNext) break;
            }
            Save();
            if (State.KnownCashPoints.Count == 0) Notice = "No receipts in the last 30 days. Add the cash point ID shown on a ReAI receipt.";
        }
        catch (Exception e) { Error = e.Message; }
        finally { Finding = false; Changed?.Invoke(); }
    }

    public void SetAllCashPoints(bool on)
    {
        State.AllCashPoints = on;
        if (on) State.Baselines[Key(null)] = BaselineNow();
        Save(); Changed?.Invoke();
    }

    public void SetCashPoint(int id, bool on)
    {
        State.CashPoints.Remove(id);
        if (on)
        {
            State.CashPoints.Add(id); State.CashPoints.Sort();
            State.Baselines[Key(id)] = BaselineNow();
            State.Cursors.Remove(Key(id));
        }
        Save(); Changed?.Invoke();
    }

    public void AddCashPoint(string text)
    {
        if (!int.TryParse(text.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id <= 0) { Error = "Enter the numeric cash point ID."; Changed?.Invoke(); return; }
        State.KnownCashPoints.TryAdd(id.ToString(CultureInfo.InvariantCulture), "Added manually");
        SetCashPoint(id, true);
    }

    public void Update(Action<BridgeState> change) { change(State); Save(); Changed?.Invoke(); }

    private string Key(int? cashPoint) => $"{Company?.Id ?? 0}:{(cashPoint is int id ? id.ToString(CultureInfo.InvariantCulture) : "all")}";

    /// <summary>The next whole server second, so history up to now is never printed.</summary>
    private DateTimeOffset BaselineNow() => DateTimeOffset.FromUnixTimeSeconds(ServerNow.ToUnixTimeSeconds() + 1);

    private void AdjustClock(DateTimeOffset server) => clockOffset = server - DateTimeOffset.UtcNow;

    /// <summary>Runs until cancelled: one poll and print pass, then a short wait.</summary>
    public async Task Run(CancellationToken cancellation)
    {
        while (!cancellation.IsCancellationRequested)
        {
            var delay = await Tick();
            Changed?.Invoke();
            try { await Task.Delay(delay, cancellation); } catch (OperationCanceledException) { return; }
        }
    }

    private async Task<TimeSpan> Tick()
    {
        if (!Readable) { Status = "Paused: the receipt ledger could not be read."; return TimeSpan.FromSeconds(30); }
        if (token == null || Company is not { } company) { Status = "Connect to ReAI to print receipts."; return TimeSpan.FromSeconds(5); }
        if (!Selecting) { Status = "Choose the cash points this computer prints for."; return TimeSpan.FromSeconds(5); }
        if (State.Paused) { Status = "Printing is paused."; return TimeSpan.FromSeconds(5); }
        try
        {
            await LoadReference(force: false);
            foreach (var cashPoint in State.AllCashPoints ? [null] : State.CashPoints.Select(id => (int?)id).ToList()) await Poll(cashPoint, token, company);
            failures = 0; LastCheck = DateTimeOffset.Now; ConnectionProblem = null;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or InvalidDataException or System.Text.Json.JsonException)
        {
            failures++;
            ConnectionProblem = e.Message;
            var delay = TimeSpan.FromSeconds(Math.Min(60, Interval.TotalSeconds * Math.Pow(2, Math.Min(failures, 5))));
            Status = $"Could not reach ReAI. Retrying in {delay.TotalSeconds:0} s.";
            return delay;
        }
        await PrintPending();
        var where = State.AllCashPoints ? "all cash points" : State.CashPoints.Count == 1 ? $"cash point {State.CashPoints[0]}" : "cash points " + string.Join(", ", State.CashPoints);
        Status = !State.Printer.Configured ? "Choose a receipt printer." : PrinterProblem != null && Waiting > 0 ? $"{PrinterProblem} {Waiting} receipt(s) waiting." : $"Printing for {where}.";
        return Interval;
    }

    private async Task Poll(int? cashPoint, string accessToken, Company company)
    {
        var key = Key(cashPoint);
        if (!State.Baselines.TryGetValue(key, out var baseline)) { State.Baselines[key] = BaselineNow(); Save(); return; }
        var start = State.Cursors.TryGetValue(key, out var cursor) && cursor > baseline ? cursor : baseline;
        var known = State.Receipts.Where(record => record.TenantId == company.Id).Select(record => record.Id).ToHashSet();
        DateTimeOffset serverDate = ServerNow, latest = start;
        for (int page = 1; ; page++)
        {
            var result = await api.Sales(accessToken, company.Id, start, cashPoint, page);
            if (page == 1) { serverDate = result.ServerDate; AdjustClock(result.ServerDate); }
            foreach (var sale in result.Value.Items)
            {
                State.KnownCashPoints[sale.CashPointId.ToString(CultureInfo.InvariantCulture)] = $"Last receipt {sale.ReceiptNumber}";
                if (known.Contains(sale.Id) || ReceiptRenderer.ParseInstant(sale.OccurredAt) is not { } date || date < baseline) continue;
                known.Add(sale.Id);
                sales[sale.Id] = sale;
                if (date > latest) latest = date;
                State.Receipts.Add(new ReceiptRecord
                {
                    Id = sale.Id, TenantId = company.Id, CashPointId = sale.CashPointId, ReceiptNumber = sale.ReceiptNumber, Type = sale.Type, OccurredAt = sale.OccurredAt,
                    GrossAmount = sale.GrossAmount, Cash = ReceiptRenderer.HasCash(sale), State = ReceiptState.Pending, UpdatedAt = DateTimeOffset.UtcNow
                });
            }
            if (!result.Value.HasNext) break;
            if (page == 10)
            {
                // Bounded work per pass; continue after the newest receipt next time.
                State.Cursors[key] = latest > baseline ? latest : baseline;
                Prune(); Save(); return;
            }
        }
        var next = serverDate - Overlap;
        State.Cursors[key] = next > baseline ? next : baseline;
        Prune(); Save();
    }

    private void Prune()
    {
        var cutoff = DateTimeOffset.UtcNow.AddDays(-30);
        State.Receipts.RemoveAll(record => record.UpdatedAt < cutoff && record.Date < cutoff && record.State != ReceiptState.Pending);
        if (State.Receipts.Count > 5000) State.Receipts.RemoveRange(0, State.Receipts.Count - 5000);
    }

    private async Task PrintPending()
    {
        if (!State.Printer.Configured || DateTimeOffset.UtcNow < printerRetryAt || Busy) return;
        foreach (var record in Receipts.Where(record => record.State == ReceiptState.Pending).OrderBy(record => record.Id).ToList())
        {
            if (record.Date < ServerNow - AutoPrintLimit)
            {
                Change(record, r => { r.State = ReceiptState.Skipped; r.Detail = "Not printed automatically: older than 24 hours."; });
                continue;
            }
            if (!await PrintOriginal(record.Id)) return;
        }
    }

    /// <summary>Prints the original receipt. Returns false when the printer or ReAI is unavailable, so the queue waits.</summary>
    public async Task<bool> PrintOriginal(long id)
    {
        if (token == null || Company is not { } company || Receipts.FirstOrDefault(r => r.Id == id) is not { } record || record.State is ReceiptState.Printed or ReceiptState.Printing) return false;
        Busy = true; Changed?.Invoke();
        try
        {
            List<ReceiptElement> elements;
            Sale sale;
            try
            {
                if (record.State == ReceiptState.Blocked) await LoadReference(force: true);
                if (!sales.TryGetValue(id, out sale!)) sales[id] = sale = await api.Sale(id, token, company.Id);
                elements = ReceiptRenderer.Render(sale, Context(company, copy: false));
            }
            catch (ReceiptException e) { Change(record, r => { r.State = ReceiptState.Blocked; r.Detail = e.Message + " Print it from ReAI."; }); return true; }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or InvalidDataException or InvalidOperationException or System.Text.Json.JsonException)
            { ConnectionProblem = e.Message; return false; }
            Change(record, r => { r.State = ReceiptState.Printing; r.Attempts++; });
            var data = EscPos.Encode(elements, State.Printer.Columns, State.OpenDrawerForCash && ReceiptRenderer.HasCash(sale));
            switch (await Send(data))
            {
                case SendOutcome.Sent:
                    Change(record, r => { r.State = ReceiptState.Printed; r.Detail = null; });
                    sales.Remove(id); printerRetryAt = DateTimeOffset.MinValue; PrinterProblem = null;
                    return true;
                case SendOutcome.NotSent notSent:
                    Change(record, r => { r.State = ReceiptState.Pending; r.Detail = notSent.Reason; });
                    printerRetryAt = DateTimeOffset.UtcNow.AddSeconds(Math.Min(60, Interval.TotalSeconds * Math.Pow(2, Math.Min(record.Attempts, 4))));
                    PrinterProblem = notSent.Reason;
                    return false;
                case SendOutcome.Uncertain uncertain:
                    Change(record, r => { r.State = ReceiptState.Uncertain; r.Detail = uncertain.Reason; });
                    PrinterProblem = null;
                    return true;
            }
            return true;
        }
        finally { Busy = false; Changed?.Invoke(); }
    }

    /// <summary>Prints the single permitted copy, marked «KOPI». Copies never open the cash drawer.</summary>
    public async Task PrintCopy(long id)
    {
        if (token == null || Company is not { } company || Receipts.FirstOrDefault(r => r.Id == id) is not { State: ReceiptState.Printed, Copy: null } record) return;
        Busy = true; Changed?.Invoke();
        try
        {
            var sale = await api.Sale(id, token, company.Id);
            var elements = ReceiptRenderer.Render(sale, Context(company, copy: true));
            Change(record, r => r.Copy = CopyState.Printing);
            switch (await Send(EscPos.Encode(elements, State.Printer.Columns, openDrawer: false)))
            {
                case SendOutcome.Sent: Change(record, r => r.Copy = CopyState.Printed); Notice = $"Copy of {record.ReceiptNumber} sent to the printer."; break;
                case SendOutcome.NotSent notSent: Change(record, r => r.Copy = null); Error = notSent.Reason; break;
                case SendOutcome.Uncertain uncertain: Change(record, r => r.Copy = CopyState.Uncertain); Error = uncertain.Reason + " No further copy can be printed."; break;
            }
        }
        catch (Exception e) { Error = e.Message; }
        finally { Busy = false; Changed?.Invoke(); }
    }

    public async Task TestPrint() => await Manual(EscPos.Encode(ReceiptRenderer.TestPage(State.Printer.Columns, State.Printer.Title), State.Printer.Columns, openDrawer: false), $"Test page sent to {State.Printer.Title}.");

    public async Task OpenDrawer() => await Manual(EscPos.DrawerOnly(), "Drawer signal sent.");

    private async Task Manual(byte[] data, string success)
    {
        Busy = true; Changed?.Invoke();
        try
        {
            switch (await Send(data))
            {
                case SendOutcome.Sent: Notice = success; Error = null; printerRetryAt = DateTimeOffset.MinValue; PrinterProblem = null; break;
                case SendOutcome.NotSent notSent: Error = notSent.Reason; break;
                case SendOutcome.Uncertain uncertain: Error = uncertain.Reason; break;
            }
        }
        finally { Busy = false; Changed?.Invoke(); }
    }

    private Task<SendOutcome> Send(byte[] data) => !State.Printer.Configured ? Task.FromResult<SendOutcome>(new SendOutcome.NotSent("Choose a receipt printer."))
        : State.Printer.Kind == PrinterKind.Network ? NetworkPrinter.Send(data, State.Printer.Host, State.Printer.Port) : printing.SendToQueue(data, State.Printer.Queue);

    private ReceiptContext Context(Company company, bool copy) =>
        new(company.Id, merchant ?? throw new InvalidOperationException("Company details from ReAI are not loaded yet."), company.CurrencyCode, vatRates, State.Printer.Columns, copy, State.PrintQrCode);

    private void Change(ReceiptRecord record, Action<ReceiptRecord> edit)
    {
        edit(record);
        record.UpdatedAt = DateTimeOffset.UtcNow;
        Save();
    }

    private void Save()
    {
        if (!Readable) return;
        try { store.Save(State); }
        catch { Error = "The receipt ledger could not be saved. Printing is paused to prevent duplicates."; Readable = false; }
    }
}
