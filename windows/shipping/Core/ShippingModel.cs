using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Text.Json;

namespace ReAI.Shipping.Core;

/// <summary>The private journal: unresolved shipping requests, print receipts and preferences. No access key is stored here.</summary>
public sealed class Store(string directory)
{
    private string FilePath => Path.Combine(directory, "shipping.json");
    public LocalState Load() => File.Exists(FilePath) ? JsonSerializer.Deserialize<LocalState>(File.ReadAllBytes(FilePath), ReAIClient.Json) ?? throw new InvalidDataException() : new();
    public void Save(LocalState state)
    {
        Directory.CreateDirectory(directory);
        var temporary = FilePath + ".tmp";
        using (var file = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            JsonSerializer.Serialize(file, state, ReAIClient.Json); file.Flush(true);
        }
        File.Move(temporary, FilePath, true);
    }
}

public sealed class ShippingModel(ReAIClient api, Store store, IPrinting printing)
{
    private const string Unreadable = "Shipping history could not be read. Shipping and printing are paused to prevent duplicates.";
    private LocalState state = new();
    private string? token;
    private string readyFrom = "";
    private int page, totalPages;
    private int? historyBefore;

    public event Action? Changed;
    public Company? Company { get; private set; }
    public bool Busy { get; private set; }
    public bool LoadingOrders { get; private set; }
    public bool LoadingLocations { get; private set; }
    public bool Readable { get; private set; }
    public string? Error { get; set; }
    public string? Notice { get; set; }
    public Printer[] Printers { get; private set; } = [];
    public string Printer => state.Printer;
    public LabelSize LabelSize => LabelSize.All.FirstOrDefault(size => size.Width == state.LabelWidth) ?? LabelSize.All[0];

    public string Search { get; set; } = "";
    public bool History { get; private set; }
    public bool IncludeOlder { get; private set; }
    public List<Order> Orders { get; private set; } = [];
    public int TotalOrders { get; private set; }
    public bool CanLoadMore => History ? historyBefore != null : page + 1 < totalPages;
    public Order? Selected { get; private set; }
    public Options? Options { get; private set; }
    public Draft? Draft { get; private set; }
    public List<Rate> Rates { get; private set; } = [];
    public string SelectedRate { get; private set; } = "";
    public List<Pickup> Pickups { get; private set; } = [];
    public Quote? Quote { get; private set; }
    public Shipment? Shipment { get; private set; }
    public List<ShipmentSummary> SavedShipments { get; private set; } = [];
    public int? ShipmentBefore { get; private set; }
    public List<Warehouse> Warehouses { get; private set; } = [];
    public int WarehouseId { get; private set; }
    public List<Zone> Zones { get; private set; } = [];
    public List<Location> Locations { get; private set; } = [];

    public IEnumerable<Operation> Unfinished => state.Operations.Where(operation => operation.TenantId == Company?.Id);
    public IEnumerable<PrintRecord> Prints => state.Prints.Where(print => print.TenantId == Company?.Id);
    public bool Blocked => Unfinished.Any(operation => operation.OrderId == Selected?.OrderId);
    public bool TestMode => Options?.Services.FirstOrDefault(service => service.CarrierCode == (Shipment?.CarrierCode ?? Draft?.CarrierCode))?.TestMode ?? false;
    public bool CanPrint => Readable && !Busy && state.Printer != "";
    public bool CanShip => !History && CanPrint && !Blocked && (Shipment is { } shipment ? shipment.Actions.Contains("book") : Quote != null);
    public bool HasReceipt(int shipment) => Prints.Any(print => print.ShipmentId == shipment);
    public LocationPrint? LocationReceipt(int location) => state.LocationPrints.FirstOrDefault(print => print.TenantId == Company?.Id && print.LocationId == location);

    public void Load()
    {
        try
        {
            state = store.Load(); Readable = true;
            if (state.Prints.Any(print => print.State == "submitting") || state.LocationPrints.Any(print => print.State == "submitting"))
                Notice = "A previous print was interrupted. Check the printer queue before reprinting.";
        }
        catch { Error = Unreadable; }
        RefreshPrinters();
    }
    private void Save()
    {
        // Never replace a journal that could not be read: it may hold unresolved shipments and print receipts.
        if (!Readable) throw new InvalidOperationException(Unreadable);
        store.Save(state);
    }
    private void Remember(Action change)
    {
        change();
        try { Save(); } catch (Exception e) { Error = e.Message; }
        Changed?.Invoke();
    }
    public void ChoosePrinter(string name) => Remember(() => state.Printer = name);
    public void ChooseLabelSize(LabelSize size) => Remember(() => state.LabelWidth = size.Width);
    public void RefreshPrinters()
    {
        try
        {
            Printers = printing.Printers();
            if (state.Printer == "" && Readable && Printers.Where(printer => printer.IsZebra).ToArray() is [var zebra]) state.Printer = zebra.Name;
        }
        catch (Exception e) { Error = e.Message; }
        Changed?.Invoke();
    }

    private async Task Run(Func<string, int, Task> action)
    {
        if (Busy || token is not { } key || Company is not { Id: var company }) return;
        Busy = true; Error = null; Changed?.Invoke();
        try { await action(key, company); }
        catch (Exception e) { Error = e.Message; }
        finally { Busy = false; Changed?.Invoke(); }
    }
    private void Clear()
    {
        Selected = null; Options = null; Draft = null; Rates = []; SelectedRate = ""; Pickups = []; Quote = null; Shipment = null; SavedShipments = []; ShipmentBefore = null;
    }

    public async Task<bool> Connect(string key)
    {
        if (Busy) return false;
        Busy = true; Error = null; Changed?.Invoke();
        try { Company = await api.Account(key); token = key; }
        catch (Exception e) { Error = e.Message; }
        finally { Busy = false; Changed?.Invoke(); }
        if (Company != null) await LoadOrders();
        return Company != null;
    }
    public void Disconnect()
    {
        token = null; Company = null; Orders = []; Warehouses = []; WarehouseId = 0; Zones = []; Locations = []; Notice = null; Clear();
        Changed?.Invoke();
    }

    public Task RefreshOrders(bool more = false)
    {
        Error = null;
        return LoadOrders(more);
    }
    private async Task LoadOrders(bool more = false)
    {
        if (LoadingOrders || token is not { } key || Company is not { Id: var company }) return;
        LoadingOrders = true; Changed?.Invoke();
        try
        {
            List<Order> items; int? before = null;
            if (History) (items, before) = await api.History(key, company, Search, more ? historyBefore : null);
            else
            {
                // Keep the date cutoff stable while paging.
                if (!more) readyFrom = IncludeOlder ? "1900-01-01" : DateTime.Today.AddDays(-14).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                var result = await api.Orders(key, company, Search, more ? page + 1 : 0, readyFrom);
                items = result.Items; page = result.Page; totalPages = result.TotalPages; TotalOrders = result.TotalItems;
            }
            if (Company?.Id != company) return;
            Orders = more ? [.. Orders, .. items.Where(item => Orders.All(order => order.OrderId != item.OrderId))] : items;
            if (History) { historyBefore = before; TotalOrders = Orders.Count; }
        }
        catch (Exception e) { Error = e.Message; }
        finally { LoadingOrders = false; Changed?.Invoke(); }
    }
    public async Task Show(bool history, bool includeOlder)
    {
        if (Busy || LoadingOrders) return;
        History = history; IncludeOlder = includeOlder; historyBefore = null; Error = null; Notice = null; Orders = []; Clear();
        await RefreshOrders();
    }

    public Task Select(Order order) => Run(async (key, company) =>
    {
        Clear(); Selected = order; Notice = null;
        var saved = await api.Shipments(order.OrderId, null, key, company);
        SavedShipments = saved.Items; ShipmentBefore = saved.NextBeforeId;
        if (History)
        {
            if ((SavedShipments.FirstOrDefault(s => s.Status == "booked") ?? SavedShipments.FirstOrDefault()) is { } latest) Shipment = await api.Shipment(latest.Id, key, company);
            else Notice = "No saved shipping labels for this order.";
        }
        else if (Unfinished.FirstOrDefault(operation => operation.OrderId == order.OrderId) is { } unfinished)
        {
            if (unfinished.ShipmentId is int id) Shipment = await api.Shipment(id, key, company);
            else { Draft = unfinished.Draft; Notice = "A saved shipping request needs checking. Use Resume below."; }
        }
        else if (order.PreparedShipmentId is int prepared) Shipment = await api.Shipment(prepared, key, company);
        else
        {
            Options = await api.Options(order.OrderId, key, company);
            if (Options.ExistingShipments.Items.FirstOrDefault(s => s.Status == "prepared") is { } existing) Shipment = await api.Shipment(existing.Id, key, company);
            else if ((Draft = Options.Defaults) != null) await LoadRates(key, company);
        }
    });
    public Task LoadMoreShipments() => Run(async (key, company) =>
    {
        if (Selected is not { } order || ShipmentBefore is not int before) return;
        var result = await api.Shipments(order.OrderId, before, key, company);
        SavedShipments = [.. SavedShipments, .. result.Items.Where(item => SavedShipments.All(s => s.Id != item.Id))];
        ShipmentBefore = result.NextBeforeId;
    });
    public Task ChooseShipment(int id) => Run(async (key, company) =>
    {
        Notice = null;
        Shipment = await api.Shipment(id, key, company); Draft = null; Quote = null;
    });

    public Task RefreshRates() => Run(LoadRates);
    public Task ChooseRate(Rate rate) => Run((key, company) => SelectRate(rate, key, company));
    public Task ChoosePickup(string? id) => Run((key, company) =>
    {
        Draft?.PickupProviderId = id;
        return LoadQuote(key, company);
    });
    /// <summary>Any edit to the parcel makes the displayed price stale; rates must be fetched again before shipping.</summary>
    public void InvalidateQuote()
    {
        Quote = null; Rates = []; Pickups = []; SelectedRate = ""; Draft?.AcceptedQuote = null;
    }
    private async Task LoadRates(string key, int company)
    {
        if (Draft is not { } draft || Selected is not { } order) return;
        Quote = null; Pickups = []; draft.AcceptedQuote = null; draft.PickupProviderId = null; draft.ProductCode = null;
        Rates = await api.Rates(order.OrderId, draft, key, company);
        var available = Rates.Where(rate => rate is { Status: "quoted", BookingBlockedReason: null, Quote: not null }).ToList();
        var choice = available.FirstOrDefault(rate => rate.Id == state.Service) ?? available.FirstOrDefault(rate => rate.Service == state.Service)
            ?? available.FirstOrDefault(rate => rate.DeliveryMethod is not ("pickup_point" or "parcel_locker")) ?? available.FirstOrDefault();
        if (choice != null) await SelectRate(choice, key, company);
        else Error = Rates.Select(rate => rate.BookingBlockedReason ?? rate.Error).FirstOrDefault(reason => reason != null) ?? "No shipping rate is available for this parcel.";
    }
    private async Task SelectRate(Rate rate, string key, int company)
    {
        if (Draft is not { } draft) return;
        SelectedRate = rate.Id; Quote = null; Pickups = [];
        draft.CarrierCode = rate.CarrierCode; draft.DeliveryMethod = rate.DeliveryMethod; draft.ProductCode = rate.Quote?.ProductCode; draft.PickupProviderId = null; draft.AcceptedQuote = null;
        if (Readable && state.Service != rate.Id) { state.Service = rate.Id; store.Save(state); }
        await LoadQuote(key, company);
    }
    private async Task LoadQuote(string key, int company)
    {
        if (Draft is not { } draft || Selected is not { } order) return;
        Quote = null; Error = null;
        var result = await api.Quote(order.OrderId, draft, key, company);
        Pickups = result.PickupPlaces;
        if ((result.BookingBlockedReason ?? result.Error) is { } blocked) Error = blocked;
        else if (!result.PickupRequired || result.SelectedPickupProviderId != null) Quote = result.Quote;
    }

    /// <summary>Journals the request UUID and the exact accepted proposal before anything is sent.</summary>
    public async Task ShipAndPrint()
    {
        if (!CanShip || Company is not { Id: var company } || Selected is not { } order) return;
        Draft?.AcceptedQuote = Quote;
        var operation = new Operation { Id = Guid.NewGuid(), TenantId = company, OrderId = order.OrderId, Draft = Shipment == null ? Draft : null, ShipmentId = Shipment?.Id };
        state.Operations.Add(operation);
        try { Save(); }
        catch (Exception e) { state.Operations.Remove(operation); Error = e.Message; Changed?.Invoke(); return; }
        await Resume(operation);
    }

    /// <summary>Continues one journalled request. An uncertain create is looked up by its request UUID; nothing here creates a replacement.</summary>
    public Task Resume(Operation operation) => Run(async (key, company) =>
    {
        if (!Readable || state.Printer == "" || operation.TenantId != company) return;
        Notice = "Preparing shipment…"; Changed?.Invoke();
        try
        {
            Shipment current;
            if (operation.ShipmentId is int id) current = await api.Shipment(id, key, company);
            else
            {
                var proposal = operation.Draft ?? throw new InvalidOperationException("The saved shipping request is incomplete. Contact ReAI support.");
                var existing = await api.Find(proposal.RequestId, key, company);
                if (existing == null)
                    try { existing = await api.Create(operation.OrderId, proposal, key, company); }
                    catch (HttpRequestException e) when ((int?)e.StatusCode is >= 400 and < 500 and not (408 or 429))
                    {
                        operation.State = "rejected"; Save();
                        throw;
                    }
                current = existing;
                operation.ShipmentId = current.Id; operation.Draft = null; operation.State = "prepared"; Save();
            }
            if (current.Status is "prepared" or "failed" or "capture_pending" && current.Actions.Contains("book"))
            {
                operation.State = "booking"; Save();
                current = await api.Book(current.Id, key, company);
            }
            for (var elapsed = Stopwatch.StartNew(); current.Pending && elapsed.Elapsed < TimeSpan.FromMinutes(2);)
            {
                Notice = "Waiting for payment and carrier confirmation…"; Changed?.Invoke();
                await Task.Delay(TimeSpan.FromSeconds(2));
                current = await api.Shipment(current.Id, key, company);
            }
            Shipment = current;
            if (current.Status != "booked")
            {
                if (current is { Status: "failed", CheckoutManaged: false } && !current.Actions.Contains("book")) { operation.State = "failed"; Save(); }
                throw new InvalidOperationException(current.Error ?? (current.Pending ? "Still processing. Resume checks this same shipment; it will not create another."
                    : "This shipment needs review in ReAI. A replacement will not be booked automatically."));
            }
            operation.State = "booked"; Save();
            if (HasReceipt(current.Id)) Notice = "This label already has a print receipt. Check the queue and use Reprint if needed.";
            else await PrintLabel(current.Id, key, company);
            state.Operations.Remove(operation); Save();
        }
        catch { Notice = null; throw; }
        await LoadOrders();
    });

    /// <summary>A rejected or failed request may be priced again only after ReAI confirms that no usable shipment exists.</summary>
    public async Task Review(Operation operation)
    {
        Order? again = null;
        await Run(async (key, company) =>
        {
            if (operation.State is not ("rejected" or "failed") || operation.TenantId != company) return;
            var existing = operation.ShipmentId is int id ? await api.Shipment(id, key, company)
                : operation.Draft is { } proposal ? await api.Find(proposal.RequestId, key, company)
                : throw new InvalidOperationException("The saved shipping request is incomplete. Contact ReAI support.");
            if (existing is { Status: not ("failed" or "cancelled") })
            {
                operation.ShipmentId = existing.Id; operation.Draft = null; operation.State = "saved"; Save();
                Shipment = existing; Notice = "The original shipment exists. Resume it instead of creating another.";
            }
            else { Forget(operation); again = Orders.FirstOrDefault(order => order.OrderId == operation.OrderId); }
        });
        if (again != null) await Select(again);
    }
    public async Task CancelPreparation()
    {
        var cancelled = false;
        await Run(async (key, company) =>
        {
            if (Shipment is not { } current || !current.Actions.Contains("cancel")) return;
            var result = await api.Cancel(current.Id, key, company);
            if (result.Status != "cancelled") throw new InvalidOperationException("This shipment needs review in ReAI. A replacement will not be booked automatically.");
            if (Unfinished.FirstOrDefault(operation => operation.ShipmentId == current.Id) is { } operation) Forget(operation);
            Shipment = result; cancelled = true;
        });
        if (cancelled && Selected is { } order) await Select(order);
    }
    private void Forget(Operation operation)
    {
        state.Operations.Remove(operation);
        try { Save(); } catch { state.Operations.Add(operation); throw; }
    }

    /// <summary>Prints the stored label again. This only downloads the existing PDF; it never books shipping.</summary>
    public Task Reprint(int shipment) => Run(async (key, company) =>
    {
        if (Readable && state.Printer != "") await PrintLabel(shipment, key, company);
    });
    private async Task PrintLabel(int shipment, string key, int company)
    {
        Error = null; Notice = "Preparing document…"; Changed?.Invoke();
        PrintRecord? receipt = null;
        try
        {
            var submit = await printing.Label(await api.Label(shipment, key, company), state.Printer, $"ReAI {shipment} · {"Shipping label"}");
            state.Prints.RemoveAll(print => print.TenantId == company && print.ShipmentId == shipment);
            state.Prints.Insert(0, receipt = new() { TenantId = company, ShipmentId = shipment, State = "submitting", Printer = state.Printer });
            // Persist before handing off: a crash must never cause an automatic second print.
            Save();
            receipt.Result = await submit(); receipt.State = "queued"; Save();
            Notice = "Sent to the printer queue.";
        }
        catch (Exception e)
        {
            if (receipt != null) receipt.State = "check_queue";
            else if (!HasReceipt(shipment)) state.Prints.Insert(0, new() { TenantId = company, ShipmentId = shipment, State = "failed" });
            try { Save(); } catch { }
            Error = e.Message; Notice = null;
        }
    }

    public async Task RefreshLocations(int? warehouse = null)
    {
        if (Busy || LoadingLocations || token is not { } key || Company is not { Id: var company }) return;
        LoadingLocations = true; Error = null; WarehouseId = warehouse ?? WarehouseId; Changed?.Invoke();
        try
        {
            var warehouses = await api.Warehouses(key, company);
            if (Company?.Id != company) return;
            Warehouses = warehouses; Locations = []; Zones = [];
            if (warehouses.All(w => w.Id != WarehouseId)) WarehouseId = warehouses.FirstOrDefault()?.Id ?? 0;
            if (WarehouseId == 0) return;
            Task<List<Location>> locations = api.Locations(WarehouseId, key, company);
            Task<List<Zone>> zones = api.Zones(WarehouseId, key, company);
            await Task.WhenAll(locations, zones);
            if (Company?.Id == company) (Locations, Zones) = (locations.Result, zones.Result);
        }
        catch (Exception e) { Error = e.Message; }
        finally { LoadingLocations = false; Changed?.Invoke(); }
    }
    public LocationLabel Label(Location location)
    {
        if (!Locations.Contains(location) || Warehouses.FirstOrDefault(w => w.Id == location.WarehouseId) is not { } warehouse) throw new InvalidOperationException("Refresh locations before printing.");
        if (location.ScanCode is not { } code || !code.StartsWith("reai:location:") || !Guid.TryParse(code["reai:location:".Length..], out _))
            throw new InvalidDataException("This location has no QR code. Refresh locations or update ReAI.");
        return new(code, location.Name, string.Join('\n', new[] { warehouse.Name, Zones.FirstOrDefault(zone => zone.Id == location.ZoneId)?.Name }.Where(line => line != null)), LabelSize);
    }
    /// <summary>Prints one QR label. A location that already has a receipt needs explicit confirmation; nothing is retried automatically.</summary>
    public Task PrintLocation(Location location, bool confirmed = false) => Run(async (_, company) =>
    {
        if (!Readable || state.Printer == "" || LoadingLocations || (LocationReceipt(location.Id) != null && !confirmed)) return;
        Notice = null;
        var submit = printing.Location(Label(location), state.Printer);
        state.LocationPrints.RemoveAll(print => print.TenantId == company && print.LocationId == location.Id);
        var receipt = new LocationPrint { TenantId = company, LocationId = location.Id, State = "submitting", Printer = state.Printer };
        state.LocationPrints.Insert(0, receipt);
        Save();
        try
        {
            receipt.Result = await submit(); receipt.State = "queued"; Save();
            Notice = "Sent to the printer queue.";
        }
        catch
        {
            receipt.State = "check_queue";
            try { Save(); } catch { }
            throw;
        }
    });
}
