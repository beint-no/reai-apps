using System.Diagnostics;
using System.Globalization;
using Microsoft.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using ReAI.POSPrintBridge.Core;
using Windows.Graphics;

namespace ReAI.POSPrintBridge;

public sealed class MainWindow : Window
{
    private readonly ReAIClient api = new();
    private readonly BridgeModel model;
    private readonly WinSpool spool = new();
    private readonly Tray tray;
    private readonly CancellationTokenSource running = new();
    private readonly TextBlock subtitle = Text("", dim: true), status = Text(""), approval = Text(""), problem = Warning(""), lastCheck = Text("", 12, dim: true);
    private readonly Button connect = new() { Content = "Connect to ReAI", Style = (Style)Application.Current.Resources["AccentButtonStyle"] }, disconnect;
    private readonly CheckBox all = new() { Content = "All cash points" }, drawer = new() { Content = "Open cash drawer for cash payments" },
        qr = new() { Content = "Print receipt QR code" }, paused = new() { Content = "Pause printing" }, atLogin = new() { Content = "Open at sign-in" };
    private readonly StackPanel cashPoints = new() { Spacing = 4 }, receipts = new() { Spacing = 8 };
    private readonly TextBox cashPointId = new() { PlaceholderText = "Cash point ID", Width = 140 }, host = new() { Header = "IP address or host name", MinWidth = 220 };
    private readonly NumberBox port = new() { Header = "Port", Minimum = 1, Maximum = 65535, MinWidth = 110 };
    private readonly ComboBox kind = new() { Header = "Printer", ItemsSource = new[] { "Network printer (port 9100)", "Installed printer (raw)" }, MinWidth = 260 },
        queue = new() { Header = "Installed printer", PlaceholderText = "Choose a printer", MinWidth = 260 },
        paper = new() { Header = "Paper width", ItemsSource = new[] { "80 mm", "58 mm" }, MinWidth = 120 };
    private readonly Button find, testPrint, openDrawer, refreshQueues;
    private readonly ProgressRing progress = new() { Width = 20, Height = 20 };
    private readonly InfoBar notice = new() { Severity = InfoBarSeverity.Informational }, error = new() { Severity = InfoBarSeverity.Warning };
    private readonly FrameworkElement connectView, connectedView;
    private CancellationTokenSource? connecting;
    private bool rendering, quitting;
    private string shownCashPoints = "", shownReceipts = "";
    private object? shownQueues;

    public MainWindow(bool background)
    {
        Title = "ReAI POS Print Bridge";
        SystemBackdrop = new MicaBackdrop();
        var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
        AppWindow.Resize(new SizeInt32(Math.Min(760, area.Width - 80), Math.Min(900, area.Height - 80)));
        var icon = Path.Combine(AppContext.BaseDirectory, "Assets", "pos-print-bridge.ico");
        AppWindow.SetIcon(icon);
        var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ReAI", "POS Print Bridge");
        model = new(api, new Store(data), spool);
        model.Changed += () => DispatcherQueue.TryEnqueue(Render);

        disconnect = Command("Disconnect", Disconnect);
        connect.Click += async (_, _) => await Connect();
        connectView = Stack(16, Text("Print ReAI POS receipts on your receipt printer.", 22),
            Text("Connect once and choose your company. Your password stays in the browser.", dim: true), connect, approval,
            Text("Your ReAI user needs kassasystem read and company read permission.", 12, dim: true));

        all.Click += (_, _) => { if (!rendering) model.SetAllCashPoints(all.IsChecked == true); };
        find = Command("Find cash points", model.FindCashPoints);
        cashPointId.KeyDown += (_, key) => { if (key.Key == Windows.System.VirtualKey.Enter) AddCashPoint(); };
        var cashPointSection = Section("Cash points", all, cashPoints,
            Row(cashPointId, Command("Add", () => { AddCashPoint(); return Task.CompletedTask; }), find),
            Text("New receipts from the chosen cash points print here. Receipts from before you choose a cash point are not printed. Let one computer print each cash point.", 12, dim: true));

        kind.SelectionChanged += (_, _) => { if (!rendering && kind.SelectedIndex >= 0) model.Update(s => s.Printer.Kind = kind.SelectedIndex == 0 ? PrinterKind.Network : PrinterKind.Installed); };
        host.LostFocus += (_, _) => { if (!rendering) model.Update(s => s.Printer.Host = host.Text.Trim()); };
        port.ValueChanged += (_, change) => { if (!rendering && !double.IsNaN(change.NewValue)) model.Update(s => s.Printer.Port = (int)change.NewValue); };
        queue.SelectionChanged += (_, _) => { if (!rendering && queue.SelectedItem is string name) model.Update(s => s.Printer.Queue = name); };
        paper.SelectionChanged += (_, _) => { if (!rendering && paper.SelectedIndex >= 0) model.Update(s => s.Printer.PaperWidth = paper.SelectedIndex == 0 ? 80 : 58); };
        drawer.Click += (_, _) => model.Update(s => s.OpenDrawerForCash = drawer.IsChecked == true);
        qr.Click += (_, _) => model.Update(s => s.PrintQrCode = qr.IsChecked == true);
        paused.Click += (_, _) => model.Update(s => s.Paused = paused.IsChecked == true);
        refreshQueues = Command("Refresh printers", () => { shownQueues = null; Render(); return Task.CompletedTask; });
        refreshQueues.VerticalAlignment = VerticalAlignment.Bottom;
        testPrint = Command("Test print", model.TestPrint);
        openDrawer = Command("Open drawer", model.OpenDrawer);
        var printerSection = Section("Receipt printer", Row(kind, paper), Row(host, port), Row(queue, refreshQueues), drawer, qr, Row(testPrint, openDrawer, paused),
            Text("ESC/POS thermal printers such as Epson TM or Star in ESC/POS mode. The drawer connects to the printer's drawer port.", 12, dim: true));

        connectedView = Stack(20, cashPointSection, printerSection, Section("Recent receipts", receipts));
        atLogin.IsChecked = LoginItem.Enabled;
        atLogin.Click += (_, _) =>
        {
            try { LoginItem.Enabled = atLogin.IsChecked == true; }
            catch (Exception e) { model.Error = "Windows did not allow opening at sign-in. " + e.Message; Render(); }
        };
        notice.CloseButtonClick += (_, _) => model.Notice = null;
        error.CloseButtonClick += (_, _) => model.Error = null;

        var views = new Grid();
        views.Children.Add(connectView);
        views.Children.Add(connectedView);
        var header = Table((Stack(2, Text("ReAI POS Print Bridge", 24, bold: true), subtitle), new(1, GridUnitType.Star)), (progress, GridLength.Auto), (disconnect, GridLength.Auto));
        var root = Stack(14, header, Stack(2, status, lastCheck), problem, views, atLogin, notice, error);
        root.Padding = new Thickness(24, 16, 24, 24);
        Content = new ScrollViewer { Content = root };

        tray = new Tray(WinRT.Interop.WindowNative.GetWindowHandle(this), icon,
        [
            ("Open ReAI POS Print Bridge", ShowWindow, () => true),
            ("Test print", () => _ = model.TestPrint(), () => model.State.Printer.Configured && !model.Busy),
            ("Open drawer", () => _ = model.OpenDrawer(), () => model.State.Printer.Configured && !model.Busy),
            ("-", () => { }, () => true),
            ("Quit", Quit, () => !model.Busy)
        ]);
        // Closing the window keeps printing in the tray. Quit from the tray icon.
        AppWindow.Closing += (_, closing) => { if (quitting) return; closing.Cancel = true; AppWindow.Hide(); };
        Closed += (_, _) => { running.Cancel(); connecting?.Cancel(); tray.Dispose(); };

        model.Load();
        _ = Start();
        Render();
        if (!background) Activate();
    }

    private async Task Start()
    {
        try { if (Credentials.Read() is { } token) await model.Activate(token); }
        catch (Exception e) { model.Error = e.Message; }
        Render();
        await model.Run(running.Token);
    }

    public void ShowWindow()
    {
        AppWindow.Show();
        Activate();
    }

    private void Quit()
    {
        quitting = true;
        Close();
        Application.Current.Exit();
    }

    private static TextBlock Text(string text, double size = 14, bool dim = false, bool bold = false) =>
        new() { Text = text, FontSize = size, TextWrapping = TextWrapping.Wrap, Opacity = dim ? 0.65 : 1, FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal };
    private static TextBlock Warning(string text) { var block = Text(text); block.Foreground = new SolidColorBrush(Colors.DarkOrange); return block; }
    private static StackPanel Stack(double spacing, params UIElement[] children)
    {
        var panel = new StackPanel { Spacing = spacing };
        foreach (var child in children) panel.Children.Add(child);
        return panel;
    }
    private static StackPanel Row(params UIElement[] children) { var panel = Stack(8, children); panel.Orientation = Orientation.Horizontal; return panel; }
    private static StackPanel Section(string title, params UIElement[] children) => Stack(10, [Text(title, 18, bold: true), .. children]);
    private static Grid Table(params (FrameworkElement Child, GridLength Width)[] cells)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        foreach (var (child, width) in cells)
        {
            Grid.SetColumn(child, grid.ColumnDefinitions.Count);
            grid.ColumnDefinitions.Add(new() { Width = width });
            child.VerticalAlignment = VerticalAlignment.Center;
            grid.Children.Add(child);
        }
        return grid;
    }
    private static Button Command(string text, Func<Task> action)
    {
        var button = new Button { Content = text };
        button.Click += async (_, _) => await action();
        return button;
    }
    private static Visibility Shown(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
    private async Task<bool> Confirm(string title, string content, string action) => await new ContentDialog
    {
        XamlRoot = Content.XamlRoot, Title = title, Content = content, PrimaryButtonText = action, CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Close
    }.ShowAsync() == ContentDialogResult.Primary;

    private void AddCashPoint() { model.AddCashPoint(cashPointId.Text); cashPointId.Text = ""; }

    private async Task Connect()
    {
        if (connecting != null) { connecting.Cancel(); return; }
        connecting = new(); model.Error = null; Render();
        try
        {
            var token = await api.Connect((code, uri) =>
            {
                approval.Text = $"Compare {code} in your browser, choose a company and approve.";
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            }, connecting.Token);
            await model.Activate(token);
            Credentials.Save(token);
            model.Notice = "Connected. Choose the cash points this computer prints for.";
        }
        catch (OperationCanceledException) { }
        catch (Exception e) { model.Error = e.Message; }
        finally { connecting.Dispose(); connecting = null; approval.Text = ""; Render(); }
    }

    private async Task Disconnect()
    {
        if (model.Busy || !await Confirm("Disconnect this PC?", "Receipts stop printing here. Revoke access in your ReAI profile to remove it from ReAI.", "Disconnect")) return;
        try { Credentials.Clear(); model.Disconnect(); }
        catch (Exception e) { model.Error = e.Message; Render(); }
    }

    private void Render()
    {
        rendering = true;
        try
        {
            bool connected = model.Company != null, busy = model.Busy;
            var state = model.State;
            subtitle.Text = model.Company?.CompanyName ?? "Not connected";
            status.Text = model.Status;
            lastCheck.Text = model.LastCheck is { } check ? "Last check " + check.ToLocalTime().ToString("T", CultureInfo.CurrentCulture) : "";
            lastCheck.Visibility = Shown(model.LastCheck != null);
            problem.Text = model.ConnectionProblem ?? model.PrinterProblem ?? "";
            problem.Visibility = Shown(problem.Text.Length > 0);
            progress.IsActive = busy || connecting != null || model.Finding;
            disconnect.Visibility = Shown(connected); disconnect.IsEnabled = !busy;
            connect.Content = connecting == null ? "Connect to ReAI" : "Cancel";
            approval.Visibility = Shown(approval.Text.Length > 0);
            connectView.Visibility = Shown(!connected); connectedView.Visibility = Shown(connected);
            notice.Message = model.Notice ?? ""; notice.IsOpen = model.Notice != null;
            error.Message = model.Error ?? ""; error.IsOpen = model.Error != null;
            tray.SetTip("ReAI POS Print Bridge: " + model.Status);
            if (!connected) return;

            all.IsChecked = state.AllCashPoints;
            find.IsEnabled = !model.Finding;
            var cashPointKey = $"{state.AllCashPoints}|{string.Join(",", model.KnownCashPoints)}|{string.Join(",", state.CashPoints)}|{string.Join(",", state.KnownCashPoints.Values)}";
            if (cashPointKey != shownCashPoints)
            {
                shownCashPoints = cashPointKey;
                cashPoints.Children.Clear();
                if (!state.AllCashPoints)
                    foreach (var id in model.KnownCashPoints)
                    {
                        var box = new CheckBox { Content = $"Cash point {id}" + (model.Hint(id) is { } hint ? $" · {hint}" : ""), IsChecked = state.CashPoints.Contains(id) };
                        box.Click += (_, _) => model.SetCashPoint(id, box.IsChecked == true);
                        cashPoints.Children.Add(box);
                    }
            }

            var printer = state.Printer;
            kind.SelectedIndex = printer.Kind == PrinterKind.Network ? 0 : 1;
            paper.SelectedIndex = printer.PaperWidth == 58 ? 1 : 0;
            if (host.FocusState == FocusState.Unfocused) host.Text = printer.Host;
            port.Value = printer.Port;
            host.Visibility = port.Visibility = Shown(printer.Kind == PrinterKind.Network);
            queue.Visibility = refreshQueues.Visibility = Shown(printer.Kind == PrinterKind.Installed);
            if (printer.Kind == PrinterKind.Installed && shownQueues == null) queue.ItemsSource = shownQueues = spool.Queues();
            queue.SelectedItem = printer.Queue.Length > 0 ? printer.Queue : null;
            drawer.IsChecked = state.OpenDrawerForCash; qr.IsChecked = state.PrintQrCode; paused.IsChecked = state.Paused;
            testPrint.IsEnabled = openDrawer.IsEnabled = printer.Configured && !busy;

            var records = model.Receipts.Take(40).ToList();
            var receiptKey = $"{busy}|{printer.Configured}|" + string.Join(";", records.Select(r => $"{r.Id}:{r.State}:{r.Detail}"));
            if (receiptKey == shownReceipts) return;
            shownReceipts = receiptKey;
            receipts.Children.Clear();
            if (records.Count == 0) receipts.Children.Add(Text("Printed receipts will appear here.", dim: true));
            foreach (var record in records)
            {
                var detail = Text(Describe(record), 12, dim: record.State == ReceiptState.Printed);
                if (record.State != ReceiptState.Printed) detail.Foreground = new SolidColorBrush(Colors.DarkOrange);
                var info = Stack(2, Text($"{record.ReceiptNumber} · cash point {record.CashPointId}", bold: true),
                    Text(record.Date.ToLocalTime().ToString("g", CultureInfo.CurrentCulture) + " · " + ReceiptRenderer.Money(record.GrossAmount), 12, dim: true), detail);
                Button? action = null;
                if (record.State is ReceiptState.Blocked or ReceiptState.Skipped)
                {
                    action = Command("Print", async () =>
                    {
                        if (await Confirm("Print this receipt?", "This receipt was never sent to the printer. It prints once.", "Print receipt")) await model.PrintOriginal(record.Id);
                    });
                    action.IsEnabled = !busy && printer.Configured;
                }
                receipts.Children.Add(action == null ? info : Table((info, new(1, GridUnitType.Star)), (action, GridLength.Auto)));
            }
        }
        finally { rendering = false; }
    }

    private static string Describe(ReceiptRecord record) => record.State switch
    {
        ReceiptState.Pending => record.Detail is { } detail ? "Waiting: " + detail : "Waiting for the printer",
        ReceiptState.Printing => "Printing",
        ReceiptState.Printed => "Sent to printer",
        _ => record.Detail ?? "Check the printer"
    };
}
