using System.Diagnostics;
using Microsoft.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using ReAI.Shipping.Core;
using Windows.Graphics;
using Windows.System;
using static ReAI.Shipping.Core.Texts;

namespace ReAI.Shipping;

public sealed class MainWindow : Window
{
    private static readonly GridLength Auto = GridLength.Auto, Fill = new(1, GridUnitType.Star);
    private readonly ReAIClient api = new(Environment.GetEnvironmentVariable("REAI_TMP_FAKE") == null ? null : new TmpFake()); // TEMPORARY
    private readonly ShippingModel model;
    private readonly TextBlock subtitle = Text("", dim: true), approval = Text(""), age = Text("", 12, dim: true), empty = Text("", dim: true), count = Text("", 12, dim: true),
        caption = Text("", 12, dim: true), noPlaces = Text(T("No locations found. Create locations in ReAI, then refresh here."), dim: true), previewText = Text("", dim: true);
    private readonly ProgressRing progress = new() { Width = 20, Height = 20 };
    private readonly Button connect = new() { Style = (Style)Application.Current.Resources["AccentButtonStyle"] }, disconnect, more;
    private readonly SelectorBar sections = new(), tabs = new();
    private readonly TextBox search = new(), find = new() { PlaceholderText = T("Find a location"), VerticalAlignment = VerticalAlignment.Bottom };
    private readonly CheckBox older = new() { Content = T("Include older orders") };
    private readonly ListView orders = new() { IsItemClickEnabled = true }, places = new() { IsItemClickEnabled = true };
    private readonly StackPanel details = new() { Spacing = 14, Padding = new Thickness(8, 0, 20, 20) };
    private readonly ComboBox printers = new() { PlaceholderText = T("Choose a printer"), MinWidth = 260 }, warehouses = new() { Header = T("Warehouse"), PlaceholderText = T("Choose a warehouse"), MinWidth = 220 },
        zones = new() { Header = T("Zone"), MinWidth = 180 }, sizes = new() { Header = T("Label size"), ItemsSource = LabelSize.All.Select(size => size.ToString()).ToList() };
    private readonly Image preview = new() { MaxWidth = 380, MaxHeight = 300, HorizontalAlignment = HorizontalAlignment.Left };
    private readonly InfoBar notice = new() { Severity = InfoBarSeverity.Informational }, error = new() { Severity = InfoBarSeverity.Warning };
    private readonly FrameworkElement connectView, shippingView, locationsView, footer;
    private readonly List<Action> placeUpdates = [];
    private StackPanel rates = new(), actions = new();
    private TextBlock summary = Text("");
    private CancellationTokenSource? connecting;
    private bool locations;
    private int zone;
    private Location? chosen;
    private object? shownOrders, shownPrinters, shownWarehouses, shownZones, shownPlaces, shownPreview;

    public MainWindow()
    {
        Title = "ReAI Shipping";
        SystemBackdrop = new MicaBackdrop();
        var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
        AppWindow.Resize(new SizeInt32(Math.Min(1100, area.Width - 80), Math.Min(860, area.Height - 80)));
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "shipping.ico"));
        model = new(api, new Store(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ReAI", "Shipping")), new Printing());
        model.Changed += Render;

        disconnect = Command(T("Disconnect"), Disconnect);
        connect.Click += async (_, _) => await Connect();
        connectView = Stack(16, Text(T("Open orders, shipping and labels in one place."), 22), Text(T("Connect once and choose your company. Your password stays in the browser."), dim: true),
            connect, approval, Text(T("Add your Zebra in Windows Settings → Printers & scanners. A single Zebra is selected automatically."), dim: true));
        foreach (var (bar, names) in new[] { (sections, new[] { "Shipping", "Locations" }), (tabs, ["Ready to ship", "History"]) })
            foreach (var name in names) bar.Items.Add(new SelectorBarItem { Text = T(name) });
        sections.SelectionChanged += async (_, _) =>
        {
            if (sections.Items.IndexOf(sections.SelectedItem) == 1 == locations) return;
            locations = !locations; Render();
            if (locations) await model.RefreshLocations();
        };

        tabs.SelectionChanged += async (_, _) => { if (tabs.Items.IndexOf(tabs.SelectedItem) == 1 != model.History) await model.Show(!model.History, model.IncludeOlder); };
        older.Click += async (_, _) => await model.Show(false, older.IsChecked == true);
        search.TextChanged += (_, _) => model.Search = search.Text;
        search.KeyDown += async (_, key) => { if (key.Key == VirtualKey.Enter) await model.RefreshOrders(); };
        orders.ItemClick += async (_, click) => await model.Select((Order)((FrameworkElement)click.ClickedItem).Tag);
        more = Command(T("Load more"), () => model.RefreshOrders(more: true));
        var left = Table(true, (Table(false, (Text(T("Orders"), 16, bold: true), Fill), (Command(T("Refresh"), () => model.RefreshOrders()), Auto)), Auto), (tabs, Auto),
            (Table(false, (search, Fill), (Command(T("Search"), () => model.RefreshOrders()), Auto)), Auto), (older, Auto), (age, Auto), (empty, Auto), (orders, Fill), (more, Auto), (count, Auto));
        shippingView = Table(false, (left, new GridLength(330)), (new ScrollViewer { Content = details }, Fill));

        warehouses.SelectionChanged += async (_, _) =>
        {
            if (warehouses.SelectedIndex < 0 || model.Warehouses[warehouses.SelectedIndex].Id == model.WarehouseId) return;
            chosen = null; zone = 0;
            await model.RefreshLocations(model.Warehouses[warehouses.SelectedIndex].Id);
        };
        zones.SelectionChanged += (_, _) =>
        {
            int selected = zones.SelectedIndex > 0 ? model.Zones[zones.SelectedIndex - 1].Id : 0;
            if (zones.SelectedIndex >= 0 && selected != zone) { zone = selected; Render(); }
        };
        sizes.SelectionChanged += (_, _) => { if (sizes.SelectedIndex >= 0 && LabelSize.All[sizes.SelectedIndex] != model.LabelSize) model.ChooseLabelSize(LabelSize.All[sizes.SelectedIndex]); };
        find.TextChanged += (_, _) => Render();
        places.ItemClick += (_, click) => { chosen = (Location)((FrameworkElement)click.ClickedItem).Tag; Render(); };
        var refresh = Command(T("Refresh"), () => model.RefreshLocations());
        refresh.VerticalAlignment = VerticalAlignment.Bottom;
        locationsView = Table(true, (Table(false, (warehouses, Auto), (zones, Auto), (find, Fill), (sizes, Auto), (refresh, Auto)), Auto),
            (Text(T("Match the label size to the roll loaded in your printer. One location per label, at actual size."), 12, dim: true), Auto), (noPlaces, Auto),
            (Table(false, (places, Fill), (Stack(12, Text(T("Preview"), 16, bold: true), preview, previewText), new GridLength(400))), Fill));

        printers.SelectionChanged += (_, _) => { if (printers.SelectedItem is string name && name != model.Printer) model.ChoosePrinter(name); };
        footer = Table(false, (Text(T("Printer")), Auto), (printers, Auto), (Command(T("Refresh printers"), () => { model.RefreshPrinters(); return Task.CompletedTask; }), Auto),
            (Command(T("Add printer"), () => { Open(new("ms-settings:printers")); return Task.CompletedTask; }), Auto), (caption, Fill));
        notice.CloseButtonClick += (_, _) => model.Notice = null;
        error.CloseButtonClick += (_, _) => model.Error = null;

        var views = new Grid();
        foreach (var view in new[] { connectView, shippingView, locationsView }) views.Children.Add(view);
        var root = Table(true, (Table(false, (Stack(2, Text("ReAI Shipping", 24, bold: true), subtitle), Fill), (progress, Auto), (disconnect, Auto)), Auto), (sections, Auto), (views, Fill), (footer, Auto), (notice, Auto), (error, Auto));
        root.Padding = new Thickness(24, 16, 24, 16);
        Content = root;
        AppWindow.Closing += (_, closing) =>
        {
            if (!model.Busy) return;
            closing.Cancel = true; model.Notice = T("Finishing the current request. Close the window once it completes."); Render();
        };
        Closed += (_, _) => connecting?.Cancel();
        root.Loaded += async (_, _) =>
        {
            model.Load();
            if (Environment.GetEnvironmentVariable("REAI_TMP_FAKE") != null) { await model.Connect("fake"); return; } // TEMPORARY
            try { if (Credentials.Read() is { } token) await model.Connect(token); }
            catch (Exception e) { model.Error = e.Message; Render(); }
        };
        Render();
    }

    private static TextBlock Text(string? text, double size = 14, bool dim = false, bool bold = false) =>
        new() { Text = text ?? "", FontSize = size, TextWrapping = TextWrapping.Wrap, Opacity = dim ? 0.65 : 1, FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal };
    private static TextBlock Warning(string text) { var block = Text(text); block.Foreground = new SolidColorBrush(Colors.DarkOrange); return block; }
    private static StackPanel Stack(double spacing, params UIElement?[] children)
    {
        var panel = new StackPanel { Spacing = spacing };
        foreach (var child in children) if (child != null) panel.Children.Add(child);
        return panel;
    }
    private static StackPanel Row(params UIElement?[] children) { var panel = Stack(8, children); panel.Orientation = Orientation.Horizontal; return panel; }
    private static Grid Table(bool rows, params (FrameworkElement Child, GridLength Size)[] cells)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 10 };
        foreach (var (child, size) in cells)
        {
            if (rows) { Grid.SetRow(child, grid.RowDefinitions.Count); grid.RowDefinitions.Add(new() { Height = size }); }
            else { Grid.SetColumn(child, grid.ColumnDefinitions.Count); grid.ColumnDefinitions.Add(new() { Width = size }); child.VerticalAlignment = child is TextBlock ? VerticalAlignment.Center : child.VerticalAlignment; }
            grid.Children.Add(child);
        }
        return grid;
    }
    private static Button Command(string text, Func<Task> action, bool enabled = true, bool primary = false)
    {
        var button = new Button { Content = text, IsEnabled = enabled };
        if (primary) { button.Style = (Style)Application.Current.Resources["AccentButtonStyle"]; button.HorizontalAlignment = HorizontalAlignment.Stretch; button.Height = 44; }
        button.Click += async (_, _) => await action();
        return button;
    }
    private static HyperlinkButton Link(string text, string path) => new() { Content = text, NavigateUri = new(ReAIClient.Origin, path), Padding = new Thickness(0) };
    private static Visibility Shown(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
    private static void Open(Uri uri) => Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    private async Task<bool> Confirm(string title, string content, string action) => await new ContentDialog
    {
        XamlRoot = Content.XamlRoot, Title = title, Content = content, PrimaryButtonText = action, CloseButtonText = T("Cancel"), DefaultButton = ContentDialogButton.Close
    }.ShowAsync() == ContentDialogResult.Primary;

    private async Task Connect()
    {
        if (connecting != null) { connecting.Cancel(); return; }
        connecting = new(); model.Error = null; Render();
        try
        {
            var token = await api.Connect((code, uri) => { approval.Text = string.Format(T("Compare {0} in your browser, choose a company and approve."), code); Open(uri); }, connecting.Token);
            if (await model.Connect(token)) { Credentials.Save(token); model.Notice = T("Connected. Choose an order to ship."); }
        }
        catch (OperationCanceledException) { }
        catch (Exception e) { model.Error = e.Message; }
        finally { connecting.Dispose(); connecting = null; approval.Text = ""; Render(); }
    }
    private async Task Disconnect()
    {
        if (model.Busy || !await Confirm(T("Disconnect this PC?"), T("This removes the access key from this PC. Revoke access in your ReAI profile to remove it from ReAI."), T("Disconnect"))) return;
        try { Credentials.Clear(); model.Disconnect(); }
        catch (Exception e) { model.Error = e.Message; Render(); }
    }
    /// <summary>A label that already has a receipt is only printed again after explicit confirmation.</summary>
    private async Task Reprint(int shipment)
    {
        if (!model.HasReceipt(shipment) || await Confirm(T("Print again? Check the printer queue first."), "1 × " + T("Shipping label"), T("Print again"))) await model.Reprint(shipment);
    }

    private void Render()
    {
        bool connected = model.Company != null, busy = model.Busy;
        subtitle.Text = model.Company?.CompanyName ?? T("Connect once. Ship and print here.");
        progress.IsActive = busy || model.LoadingOrders || model.LoadingLocations || connecting != null;
        disconnect.Visibility = Shown(connected); disconnect.IsEnabled = !busy;
        connect.Content = T(connecting == null ? "Connect to ReAI" : "Cancel"); connect.IsEnabled = !busy;
        approval.Visibility = Shown(approval.Text != "");
        connectView.Visibility = Shown(!connected); shippingView.Visibility = Shown(connected && !locations); locationsView.Visibility = Shown(connected && locations);
        sections.Visibility = footer.Visibility = Shown(connected); sections.IsEnabled = !busy && !model.LoadingLocations;
        sections.SelectedItem = sections.Items[locations ? 1 : 0];
        notice.Message = model.Notice ?? ""; notice.IsOpen = model.Notice != null;
        error.Message = model.Error ?? ""; error.IsOpen = model.Error != null;
        if (!connected) return;
        if (shownPrinters != model.Printers) printers.ItemsSource = (shownPrinters = model.Printers) is Printer[] queues ? queues.Select(queue => queue.Name).ToList() : null;
        printers.SelectedItem = model.Printer; printers.IsEnabled = !busy;
        caption.Text = T(locations ? "One copy · Actual label size" : "One copy · Carrier PDF size");
        if (locations) RenderLocations(); else RenderShipping();
    }

    private void RenderShipping()
    {
        bool idle = !model.Busy && !model.LoadingOrders;
        tabs.SelectedItem = tabs.Items[model.History ? 1 : 0]; tabs.IsEnabled = older.IsEnabled = more.IsEnabled = idle;
        search.PlaceholderText = T(model.History ? "Order number, ID or link" : "Order or customer");
        older.IsChecked = model.IncludeOlder; older.Visibility = age.Visibility = Shown(!model.History);
        age.Text = T(model.IncludeOlder ? "All order dates" : "Orders from the last 14 days");
        if (shownOrders != model.Orders)
            orders.ItemsSource = ((List<Order>)(shownOrders = model.Orders)).Select(order =>
            {
                var row = Stack(2, Text(order.OrderNumber + (order.PreparedShipmentId == null ? "" : " · " + Status("prepared")), bold: true), Text(order.CustomerName), Text(order.Date, 12, dim: true));
                row.Padding = new Thickness(0, 6, 0, 6); row.Tag = order;
                return row;
            }).ToList();
        orders.SelectedIndex = model.Orders.FindIndex(order => order.OrderId == model.Selected?.OrderId);
        empty.Text = T(model.History ? "Search all past orders by number, ID or ReAI link." : "No orders ready to ship. Find past labels in History.");
        empty.Visibility = Shown(model.Orders.Count == 0 && !model.LoadingOrders); more.Visibility = Shown(model.CanLoadMore);
        count.Text = $"{model.TotalOrders} {T("orders")}";

        details.Children.Clear();
        void Add(params UIElement?[] items) { foreach (var item in items) if (item != null) details.Children.Add(item); }
        if (model.Selected is { } order)
        {
            var shipment = model.Shipment;
            Add(Stack(2, Text(order.OrderNumber, 28, bold: true), Text(order.CustomerName, 18, dim: true)), model.TestMode ? Warning(T("Carrier test mode")) : null,
                shipment != null ? Saved(shipment) : model.Draft is { } draft ? Proposal(draft) : model.Options?.UnavailableReason is { } reason ? Text(reason, dim: true) : null);
            actions = Stack(6); FillActions(); Add(actions);
            if (shipment?.CustomsInvoiceAvailable == true) Add(Link(T("Open customs invoice in ReAI (A4)"), $"shipments/{shipment.Id}/customs-invoice/preview?tenantId={model.Company!.Id}"));
            if (model.SavedShipments.Count > 0) Add(Text(T("Saved shipments"), 16, bold: true));
            foreach (var saved in model.SavedShipments)
            {
                var choice = new RadioButton { GroupName = "shipment", Content = $"#{saved.Id} · {Status(saved.Status)}", IsChecked = shipment?.Id == saved.Id, IsEnabled = !model.Busy };
                choice.Click += async (_, _) => await model.ChooseShipment(saved.Id);
                Add(choice);
            }
            Add(model.ShipmentBefore != null ? Command(T("Load more"), model.LoadMoreShipments, !model.Busy) : null, Link(T("Open order in ReAI"), $"order/{order.OrderId}?tenantId={model.Company!.Id}"));
        }
        else Add(Text(T("Choose an order"), 22), Text(T("Review the parcel and price, then ship and print in one click."), dim: true));

        var unfinished = model.Unfinished.ToList();
        if (unfinished.Count > 0) Add(Text(T("Shipping requests to check"), 16, bold: true));
        foreach (var operation in unfinished)
            Add(Table(false, (Text($"{T("Order")} #{operation.OrderId}"), Fill), (operation.State is "rejected" or "failed"
                ? Command(T("Review parcel again"), () => model.Review(operation), !model.Busy) : Command(T("Resume safely"), () => model.Resume(operation), model.CanPrint), Auto)));
        if (unfinished.Count > 0) Add(Text(T("Resume checks the saved request and shipment before continuing. It never creates a replacement after an uncertain response."), 12, dim: true));

        var prints = model.Prints.Take(10).ToList();
        Add(Text(T("Recent prints"), 16, bold: true), prints.Count == 0 ? Text(T("Printed documents will appear here."), dim: true) : null);
        foreach (var print in prints)
            Add(Table(false, (Stack(2, Text($"{T("Shipment")} #{print.ShipmentId} · {T("Shipping label")}"), print.Printer == null ? null : Text(print.Printer, 12, dim: true),
                Text(T(print.State == "queued" ? "In printer queue" : "Check before reprinting"), 12, dim: true)), Fill), (Command(T("Reprint"), () => Reprint(print.ShipmentId), model.CanPrint), Auto)));
    }

    private StackPanel Saved(Shipment shipment) => Stack(8, Text(Status(shipment.Status), 16, bold: true), Text(shipment.Recipient.Summary("\n")),
        Text($"{shipment.Parcel.WeightGrams} g · {shipment.Parcel.LengthCm:0.##} × {shipment.Parcel.WidthCm:0.##} × {shipment.Parcel.HeightCm:0.##} cm", dim: true),
        shipment.CustomerCharge is { Amount: { } amount, CurrencyCode: { } currency } ? Text($"{T("Shipping price")}: {amount:N2} {currency}", 16, bold: true) : null,
        shipment.Error == null ? null : Warning(shipment.Error),
        !model.History && shipment.Actions.Contains("cancel") ? Command(T("Cancel preparation"), model.CancelPreparation, !model.Busy) : null,
        shipment.InventoryRecordingPending || shipment.CustomerCharge.RecordingPending ? Warning(T("Booked shipment has pending recording in ReAI. Check its status before further action.")) : null);

    private StackPanel Proposal(Draft draft)
    {
        bool enabled = !model.Busy && !model.Blocked;
        // Handlers act only on a real change: editing makes the displayed price stale, rendering must not.
        void Edited() { model.InvalidateQuote(); summary.Text = draft.Recipient.Summary(", "); FillRates(); FillActions(); }
        TextBox Field(string title, Func<string?> get, Action<string?> set)
        {
            var box = new TextBox { Header = T(title), Text = get() ?? "", IsEnabled = enabled, MinWidth = 160 };
            box.TextChanged += (_, _) => { if ((box.Text == "" ? null : box.Text) is var value && value != get()) { set(value); Edited(); } };
            return box;
        }
        NumberBox Number(string title, Func<decimal> get, Action<decimal> set)
        {
            var box = new NumberBox { Header = title, Value = (double)get(), Minimum = 0, IsEnabled = enabled, MinWidth = 110 };
            box.ValueChanged += (_, change) =>
            {
                if (double.IsNaN(change.NewValue)) box.Value = (double)get();
                else if ((decimal)change.NewValue != get()) { set((decimal)change.NewValue); Edited(); }
            };
            return box;
        }
        Recipient to = draft.Recipient; Parcel parcel = draft.Parcel;
        var recipient = new Expander
        {
            Header = T("Recipient"), HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Content = Stack(8, Field("Name", () => to.Name, value => to.Name = value), Field("Email", () => to.Email, value => to.Email = value), Field("Phone", () => to.Phone, value => to.Phone = value),
                Field("Address", () => to.AddressPart1, value => to.AddressPart1 = value), Field("Address 2", () => to.AddressPart2, value => to.AddressPart2 = value),
                Row(Field("Postal code", () => to.PostalCode, value => to.PostalCode = value), Field("City", () => to.City, value => to.City = value), Field("Country code", () => to.CountryCode, value => to.CountryCode = value)))
        };
        var items = new Expander
        {
            Header = T("Items in this parcel"), HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Content = Stack(8, [.. draft.Lines.Select(line => Number(model.Options?.AvailableLines.FirstOrDefault(available => available.OrderLineId == line.OrderLineId)?.Name ?? $"#{line.OrderLineId}", () => line.Quantity, value => line.Quantity = value))])
        };
        summary = Text(to.Summary(", "), dim: true);
        rates = Stack(8); FillRates();
        return Stack(14, recipient, summary, model.Options?.WeightEstimated == true ? Warning(T("Estimated weight. Weigh the actual parcel before shipping.")) : null,
            Row(Number(T("Weight (g)"), () => parcel.WeightGrams, value => parcel.WeightGrams = (int)Math.Round(value)), Number(T("Length (cm)"), () => parcel.LengthCm, value => parcel.LengthCm = value),
                Number(T("Width (cm)"), () => parcel.WidthCm, value => parcel.WidthCm = value), Number(T("Height (cm)"), () => parcel.HeightCm, value => parcel.HeightCm = value)),
            items, Command(T("Refresh shipping rates"), model.RefreshRates, enabled), rates);
    }

    private void FillRates()
    {
        bool enabled = !model.Busy && !model.Blocked;
        rates.Children.Clear();
        var quoted = model.Rates.Where(rate => rate is { Status: "quoted", BookingBlockedReason: null }).ToList();
        if (quoted.Count > 0) rates.Children.Add(Text(T("Shipping service"), 16, bold: true));
        foreach (var rate in quoted)
        {
            var service = model.Options?.Services.FirstOrDefault(service => service.CarrierCode + ":" + service.DeliveryMethod == rate.Service);
            var name = service == null ? rate.Name ?? rate.Service : service.CarrierName + " · " + (rate.Name ?? service.Name);
            var choice = new RadioButton { GroupName = "rate", Content = $"{name} — {rate.Quote?.Display}", IsChecked = model.SelectedRate == rate.Id, IsEnabled = enabled };
            choice.Click += async (_, _) => await model.ChooseRate(rate);
            rates.Children.Add(choice);
        }
        if (model.Pickups.Count == 0 || model.Draft is not { } draft) return;
        var pickups = model.Pickups;
        var pickup = new ComboBox { Header = T("Pickup place"), PlaceholderText = T("Choose pickup place"), ItemsSource = pickups.Select(place => place.DisplayName).ToList(), IsEnabled = enabled, HorizontalAlignment = HorizontalAlignment.Stretch };
        pickup.SelectedIndex = pickups.FindIndex(place => place.ProviderId == draft.PickupProviderId);
        pickup.SelectionChanged += async (_, _) => { if (pickup.SelectedIndex >= 0 && pickups[pickup.SelectedIndex].ProviderId != draft.PickupProviderId) await model.ChoosePickup(pickups[pickup.SelectedIndex].ProviderId); };
        rates.Children.Add(pickup);
    }

    private void FillActions()
    {
        actions.Children.Clear();
        if (model.Shipment is { Status: "booked", LabelAvailable: true } booked)
        {
            actions.Children.Add(Command(T("Print label"), () => Reprint(booked.Id), model.CanPrint, primary: true));
            actions.Children.Add(Text(T("Sends one label to your printer."), 12, dim: true));
        }
        else if (!model.History && (model.Draft != null || model.Shipment?.Actions.Contains("book") == true))
        {
            actions.Children.Add(Command(T("Ship & print") + (model.Quote == null ? "" : " · " + model.Quote.Display), model.ShipAndPrint, model.CanShip, primary: true));
            actions.Children.Add(Text(T("Books this parcel, updates ReAI and sends one label to your printer."), 12, dim: true));
        }
        else return;
        if (model.Printer == "") actions.Children.Add(Text(T("Choose a printer below to ship and print."), 12, dim: true));
    }

    private void RenderLocations()
    {
        bool idle = !model.Busy && !model.LoadingLocations;
        if (shownWarehouses != model.Warehouses) warehouses.ItemsSource = ((List<Warehouse>)(shownWarehouses = model.Warehouses)).Select(warehouse => warehouse.Name).ToList();
        warehouses.SelectedIndex = model.Warehouses.FindIndex(warehouse => warehouse.Id == model.WarehouseId);
        if (shownZones != model.Zones) zones.ItemsSource = ((List<Zone>)(shownZones = model.Zones)).Select(zone => zone.Name).Prepend(T("All zones")).ToList();
        if (model.Zones.All(candidate => candidate.Id != zone)) zone = 0;
        zones.SelectedIndex = model.Zones.FindIndex(candidate => candidate.Id == zone) + 1;
        sizes.SelectedIndex = Array.IndexOf(LabelSize.All, model.LabelSize);
        warehouses.IsEnabled = zones.IsEnabled = idle; sizes.IsEnabled = !model.Busy;

        // Rebuild the list only when its contents change, so printing a label keeps the scroll position.
        var key = (model.Locations, zone, find.Text);
        if (!key.Equals(shownPlaces))
        {
            shownPlaces = key; placeUpdates.Clear();
            var visible = model.Locations.Where(location => (zone == 0 || location.ZoneId == zone) && $"{location.Name} {location.Description}".Contains(find.Text, StringComparison.CurrentCultureIgnoreCase)).ToList();
            noPlaces.Visibility = Shown(visible.Count == 0 && !model.LoadingLocations);
            places.ItemsSource = visible.Select(location =>
            {
                var status = Text("", 12, dim: true);
                var print = Command("", async () =>
                {
                    chosen = location; Render();
                    if (model.LocationReceipt(location.Id) == null) await model.PrintLocation(location);
                    else if (await Confirm(T("Print again? Check the printer queue first."), $"{location.Name} · {model.LabelSize}", T("Print again"))) await model.PrintLocation(location, confirmed: true);
                });
                placeUpdates.Add(() =>
                {
                    var receipt = model.LocationReceipt(location.Id);
                    status.Text = receipt == null ? "" : $"{T(receipt.State == "queued" ? "In printer queue" : "Check before reprinting")} · {receipt.Result ?? receipt.Printer}";
                    status.Visibility = Shown(receipt != null);
                    print.Content = T(receipt == null ? "Print label" : "Print again"); print.IsEnabled = model.CanPrint && !model.LoadingLocations;
                });
                var row = Table(false, (Stack(2, Text(location.Name, bold: true), location.Description == null ? null : Text(location.Description, 12, dim: true), status), Fill), (print, Auto));
                row.Padding = new Thickness(0, 6, 0, 6); row.Tag = location;
                return row;
            }).ToList();
        }
        foreach (var update in placeUpdates) update();

        if (chosen != null && !model.Locations.Contains(chosen)) chosen = null;
        if ((chosen, model.LabelSize).Equals(shownPreview)) return;
        shownPreview = (chosen, model.LabelSize); preview.Source = null;
        previewText.Text = chosen == null ? T("Choose a location to preview its QR label.") : $"{chosen.Name} · {model.LabelSize}";
        if (chosen == null) return;
        try
        {
            var image = new BitmapImage();
            image.SetSource(new MemoryStream(Printing.Preview(model.Label(chosen))).AsRandomAccessStream());
            preview.Source = image;
        }
        catch (Exception e) { previewText.Text = e.Message; }
    }
}
