using System.Diagnostics;
using Microsoft.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using ReAI.DocumentScanner.Core;
using Windows.ApplicationModel.DataTransfer;
using Windows.Graphics;
using Windows.Storage;
using Windows.Storage.Pickers;

namespace ReAI.DocumentScanner;

public sealed class MainWindow : Window
{
    public const string ShowEvent = "Local\\ReAI.DocumentScanner.Show";
    private static readonly GridLength Auto = GridLength.Auto, Fill = new(1, GridUnitType.Star);
    private readonly ReAIClient api = new();
    private readonly ScannerModel model;
    private readonly Shell shell;
    private readonly string data;
    private readonly Version version = typeof(MainWindow).Assembly.GetName().Version is { } assembly ? new(assembly.Major, assembly.Minor, assembly.Build) : new();
    private readonly Updater updater;
    private readonly EventWaitHandle show = new(false, EventResetMode.AutoReset, ShowEvent);
    private string? staged;
    private bool updating, quitting, hiddenNoticeShown;
    private DateTime nextUpdateCheck, captureUntil;
    private uint captureSequence;
    private QuickDropWindow? quickDrop;
    private readonly TextBlock subtitle = Text("", dim: true), approval = Text(""), explanation = Text("", dim: true), dropTitle = Text("", 18, bold: true),
        hotKeyHint = Text("", 12, dim: true), noFolders = Text("No watched folders for this company yet.", dim: true), empty = Text("No uploads yet. Drop a file, capture a receipt or scan a document.", dim: true);
    private readonly ProgressRing progress = new() { Width = 20, Height = 20 };
    private readonly Button connect = new() { Style = (Style)Application.Current.Resources["AccentButtonStyle"] }, disconnect, update, pause;
    private readonly RadioButtons destinations = new() { Header = "Upload destination", ItemsSource = Destinations.All.Select(destination => destination.Title()).ToList() };
    private readonly StackPanel folders = new() { Spacing = 10 };
    private readonly ListView uploads = new() { SelectionMode = ListViewSelectionMode.None };
    private readonly TextBox search = new() { PlaceholderText = "Find an upload" };
    private readonly Border drop = new() { CornerRadius = new CornerRadius(12), Padding = new Thickness(24), BorderThickness = new Thickness(1), AllowDrop = true };
    private readonly InfoBar notice = new() { Severity = InfoBarSeverity.Informational }, error = new() { Severity = InfoBarSeverity.Warning };
    private readonly FrameworkElement connectView, mainView;
    private CancellationTokenSource? connecting;
    private string shownUploads = "", shownFolders = "";

    public MainWindow()
    {
        Title = "ReAI Document Scanner";
        SystemBackdrop = new MicaBackdrop();
        var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
        AppWindow.Resize(new SizeInt32(Math.Min(1080, area.Width - 80), Math.Min(800, area.Height - 80)));
        var iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "document-scanner.ico");
        AppWindow.SetIcon(iconPath);
        data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ReAI", "DocumentScanner");
        model = new(api, new Store(data), new Stager(Path.Combine(data, "copies"), Imaging.ToJpeg));
        updater = new(Path.Combine(data, "update"), version, "ReAI.DocumentScanner.exe");
        model.Changed += Render;

        shell = new Shell(iconPath, "ReAI Document Scanner");
        shell.IconClicked += ToggleQuickDrop;
        shell.MenuRequested += TrayMenu;
        shell.HotKeyPressed += async () => await CaptureReceipt();
        shell.ClipboardChanged += async () => await PickUpCapture();
        model.Notify += shell.Notify;
        hotKeyHint.Text = shell.HotKeyRegistered ? "Ctrl+Shift+B from any app captures a screen region to Receipt reception."
            : "Ctrl+Shift+B is used by another app. Use Capture receipt here or in the notification area menu.";
        var listener = new Thread(() => { while (show.WaitOne()) DispatcherQueue.TryEnqueue(ShowWindow); }) { IsBackground = true };
        listener.Start();

        disconnect = Command("Disconnect", Disconnect);
        update = Command("", () => Update(manual: true));
        pause = Command("", () => { model.SetPaused(!model.Paused); return Task.CompletedTask; });
        connect.Click += async (_, _) => await Connect();
        connectView = Stack(16, Text("Scan, capture and upload documents to ReAI.", 22), Text("Connect once and choose your company. Your password stays in the browser.", dim: true),
            connect, approval, Text("The app keeps running in the notification area, so watched folders and Ctrl+Shift+B keep working when the window is closed.", dim: true));

        destinations.SelectionChanged += (_, _) => { if (destinations.SelectedIndex >= 0 && Destinations.All[destinations.SelectedIndex] != model.Destination) model.Destination = Destinations.All[destinations.SelectedIndex]; };
        var left = Stack(14, destinations, Command("Choose files…", ChooseFiles), Command("Scan document…", ScanDocument),
            Command("Capture receipt", CaptureReceipt), hotKeyHint, Command("Quick drop panel", () => { ShowQuickDrop(); return Task.CompletedTask; }),
            Text("Watched folders", 16, bold: true), Text("New PDFs and images in these folders upload to the destination chosen when the folder was added. Existing files are skipped; subfolders are not watched.", 12, dim: true),
            Command("Add watched folder…", AddFolder), noFolders, folders, pause);
        left.Padding = new Thickness(0, 0, 16, 16);

        dropTitle.HorizontalAlignment = explanation.HorizontalAlignment = HorizontalAlignment.Center;
        explanation.TextAlignment = TextAlignment.Center;
        var choose = Command("Choose files…", ChooseFiles, primary: true);
        choose.HorizontalAlignment = HorizontalAlignment.Center;
        drop.Child = Stack(8, dropTitle, explanation, choose);
        drop.Background = new SolidColorBrush(Colors.Teal) { Opacity = 0.06 };
        drop.BorderBrush = new SolidColorBrush(Colors.Teal) { Opacity = 0.35 };
        drop.DragOver += (_, e) =>
        {
            if (model.Company == null || !e.DataView.Contains(StandardDataFormats.StorageItems)) return;
            e.AcceptedOperation = DataPackageOperation.Copy;
            e.DragUIOverride.Caption = "Upload to " + model.Destination.Title();
        };
        drop.Drop += async (_, e) => await model.Add(await Files(e.DataView));
        search.TextChanged += (_, _) => { shownUploads = ""; Render(); };
        var right = Table(true, (drop, Auto), (Text("Recent uploads", 16, bold: true), Auto), (search, Auto), (empty, Auto), (uploads, Fill),
            (Text("Originals stay untouched · Maximum 20 MB per file · Local copies stay on this PC", 12, dim: true), Auto));
        mainView = Table(false, (new ScrollViewer { Content = left }, new GridLength(320)), (right, Fill));

        notice.CloseButtonClick += (_, _) => model.Notice = null;
        error.CloseButtonClick += (_, _) => model.Error = null;
        var views = new Grid();
        foreach (var view in new[] { connectView, mainView }) views.Children.Add(view);
        var root = Table(true, (Table(false, (Stack(2, Text("ReAI Document Scanner", 24, bold: true), subtitle), Fill), (progress, Auto), (update, Auto), (disconnect, Auto)), Auto),
            (views, Fill), (notice, Auto), (error, Auto));
        root.Padding = new Thickness(24, 16, 24, 16);
        Content = root;

        // Closing the window keeps the app in the notification area. Quit from the notification area menu.
        AppWindow.Closing += (_, closing) =>
        {
            if (quitting) return;
            closing.Cancel = true;
            AppWindow.Hide();
            if (!hiddenNoticeShown) { hiddenNoticeShown = true; shell.Notify("Still running", "Document Scanner keeps watching folders in the notification area. Right-click its icon to quit."); }
        };
        Closed += (_, _) =>
        {
            connecting?.Cancel();
            shell.Dispose();
            // A downloaded update installs quietly when the app quits.
            try { if (staged != null) Updater.Apply(staged, relaunch: false); } catch { }
        };
        var checks = DispatcherQueue.CreateTimer();
        checks.Interval = TimeSpan.FromHours(1);
        checks.Tick += async (_, _) =>
        {
            if (staged != null || model.Uploading || connecting != null || DateTime.UtcNow < nextUpdateCheck || DateTime.Now.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) return;
            nextUpdateCheck = DateTime.UtcNow.AddDays(1);
            await Update(manual: false);
        };
        root.Loaded += async (_, _) =>
        {
            model.Load();
            // Local builds have no version and never update. Releases check once a day on weekdays, while idle.
            if (version > new Version())
            {
                updater.Clean(); staged = updater.Staged; Render();
                checks.Start();
                if (staged == null && DateTime.Now.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday)) { nextUpdateCheck = DateTime.UtcNow.AddDays(1); _ = Update(manual: false); }
            }
            try { if (Credentials.Read() is { } token) await model.Connect(token); }
            catch (Exception e) { model.Error = e.Message; Render(); }
        };
        Render();
    }

    private static TextBlock Text(string? text, double size = 14, bool dim = false, bool bold = false) =>
        new() { Text = text ?? "", FontSize = size, TextWrapping = TextWrapping.Wrap, Opacity = dim ? 0.65 : 1, FontWeight = bold ? FontWeights.SemiBold : FontWeights.Normal };
    private static StackPanel Stack(double spacing, params UIElement?[] children)
    {
        var panel = new StackPanel { Spacing = spacing };
        foreach (var child in children) if (child != null) panel.Children.Add(child);
        return panel;
    }
    private static Grid Table(bool rows, params (FrameworkElement Child, GridLength Size)[] cells)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 10 };
        foreach (var (child, size) in cells)
        {
            if (rows) { Grid.SetRow(child, grid.RowDefinitions.Count); grid.RowDefinitions.Add(new() { Height = size }); }
            else { Grid.SetColumn(child, grid.ColumnDefinitions.Count); grid.ColumnDefinitions.Add(new() { Width = size }); if (child is TextBlock or Button or ProgressRing && child.VerticalAlignment == VerticalAlignment.Stretch) child.VerticalAlignment = VerticalAlignment.Center; }
            grid.Children.Add(child);
        }
        return grid;
    }
    private static Button Command(string text, Func<Task> action, bool enabled = true, bool primary = false)
    {
        var button = new Button { Content = text, IsEnabled = enabled };
        if (primary) button.Style = (Style)Application.Current.Resources["AccentButtonStyle"];
        button.Click += async (_, _) => await action();
        return button;
    }
    private static Visibility Shown(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
    private static void Open(Uri uri) => Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    private nint Handle => WinRT.Interop.WindowNative.GetWindowHandle(this);
    internal static async Task<List<string>> Files(DataPackageView view) =>
        view.Contains(StandardDataFormats.StorageItems) ? [.. (await view.GetStorageItemsAsync()).Where(item => item.IsOfType(StorageItemTypes.File)).Select(item => item.Path)] : [];
    private async Task<bool> Confirm(string title, string content, string action)
    {
        ShowWindow();
        return await new ContentDialog
        {
            XamlRoot = Content.XamlRoot, Title = title, Content = content, PrimaryButtonText = action, CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Close
        }.ShowAsync() == ContentDialogResult.Primary;
    }

    internal void ShowWindow()
    {
        AppWindow.Show();
        if (AppWindow.Presenter is OverlappedPresenter { State: OverlappedPresenterState.Minimized } presenter) presenter.Restore();
        Activate();
    }

    private void ShowQuickDrop()
    {
        quickDrop ??= new QuickDropWindow(model, ShowWindow, CaptureReceipt);
        quickDrop.ShowNearTray();
    }
    private void ToggleQuickDrop()
    {
        if (quickDrop is { Visible: true }) quickDrop.AppWindow.Hide(); else ShowQuickDrop();
    }

    private async void TrayMenu()
    {
        var command = shell.Menu([(1, "Open Document Scanner", true), (2, "Quick drop panel", true), (3, "Capture receipt\tCtrl+Shift+B", model.Company != null),
            (4, model.Paused ? "Resume uploads" : "Pause uploads", model.Company != null), (0, null, true), (5, "Quit", true)]);
        switch (command)
        {
            case 1: ShowWindow(); break;
            case 2: ShowQuickDrop(); break;
            case 3: await CaptureReceipt(); break;
            case 4: model.SetPaused(!model.Paused); break;
            case 5: await Quit(); break;
        }
    }

    private async Task Quit()
    {
        if (model.Uploading && !await Confirm("Quit while uploading?", "The current upload stops and is marked Check ReAI. Check ReAI before retrying it.", "Quit")) return;
        quitting = true;
        quickDrop?.Quit();
        Close();
        Application.Current.Exit();
    }

    private async Task Connect()
    {
        if (connecting != null) { connecting.Cancel(); return; }
        connecting = new(); model.Error = null; Render();
        try
        {
            var token = await api.Connect((code, uri) => { approval.Text = $"Compare {code} in your browser, choose a company and approve."; Open(uri); }, connecting.Token);
            if (await model.Connect(token)) { Credentials.Save(token); model.Notice = "Connected. Drop a file or press Ctrl+Shift+B to capture a receipt."; }
        }
        catch (OperationCanceledException) { }
        catch (Exception e) { model.Error = e.Message; }
        finally { connecting.Dispose(); connecting = null; approval.Text = ""; Render(); }
    }

    private async Task Disconnect()
    {
        if (model.Uploading || !await Confirm("Disconnect this PC?", "This removes the access key from this PC. Revoke access in your ReAI profile to remove it from ReAI.", "Disconnect")) return;
        try { if (model.Disconnect()) Credentials.Clear(); }
        catch (Exception e) { model.Error = e.Message; Render(); }
    }

    private async Task ChooseFiles()
    {
        var picker = new FileOpenPicker { ViewMode = PickerViewMode.List };
        foreach (var type in FileTypes.Accepted.Concat(FileTypes.Converted)) picker.FileTypeFilter.Add(type);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, Handle);
        var files = await picker.PickMultipleFilesAsync();
        if (files.Count > 0) await model.Add(files.Select(file => file.Path));
    }

    private async Task AddFolder()
    {
        var picker = new FolderPicker();
        picker.FileTypeFilter.Add("*");
        WinRT.Interop.InitializeWithWindow.Initialize(picker, Handle);
        if (await picker.PickSingleFolderAsync() is { } folder) model.AddFolder(folder.Path);
    }

    /// <summary>Opens the Snipping Tool region picker. The snip arrives on the clipboard and is uploaded to Receipt reception.</summary>
    private async Task CaptureReceipt()
    {
        if (model.Company == null) { ShowWindow(); model.Error = "Connect to ReAI before capturing receipts."; Render(); return; }
        captureSequence = Shell.ClipboardSequence;
        captureUntil = DateTime.UtcNow.AddMinutes(2);
        try { Process.Start(new ProcessStartInfo("ms-screenclip:") { UseShellExecute = true })?.Dispose(); }
        catch (Exception e) { captureUntil = default; model.Error = "Could not open the Snipping Tool. " + e.Message; Render(); }
        await Task.CompletedTask;
    }

    private async Task PickUpCapture()
    {
        if (DateTime.UtcNow > captureUntil || Shell.ClipboardSequence == captureSequence) return;
        var folder = Path.Combine(Path.GetTempPath(), "ReAI Document Scanner", Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(folder);
            var path = Path.Combine(folder, $"Receipt capture {DateTime.Now:yyyy-MM-dd HH.mm.ss}.png");
            // The Snipping Tool may update the clipboard more than once; keep waiting until it holds an image.
            if (!await Imaging.SaveClipboardImage(path)) { Directory.Delete(folder, true); return; }
            captureUntil = default;
            await model.AddCreated(path, Destination.Receipts, announce: true);
        }
        catch (Exception e)
        {
            captureUntil = default;
            try { Directory.Delete(folder, true); } catch { }
            model.Error = "The capture could not be saved. " + e.Message; shell.Notify("Capture failed", e.Message); Render();
        }
    }

    private async Task ScanDocument()
    {
        if (model.Company == null) return;
        var devices = new ComboBox { Header = "Scanner", PlaceholderText = "Looking for scanners…", MinWidth = 320 };
        var sources = new ComboBox { Header = "Source", MinWidth = 200 };
        var resolution = new ComboBox { Header = "Resolution", ItemsSource = new List<string> { "150 dpi", "300 dpi" }, SelectedIndex = 1 };
        var destination = new ComboBox { Header = "Upload to", ItemsSource = Destinations.All.Select(item => item.Title()).ToList(), SelectedIndex = Array.IndexOf(Destinations.All, model.Destination) };
        var status = Text("", dim: true);
        var pages = new List<string>();
        var folder = Path.Combine(Path.GetTempPath(), "ReAI Document Scanner", "scan-" + Guid.NewGuid().ToString("N"));
        List<Scanning.Device> found = [];
        List<Scanning.Source> available = [];
        var dialog = new ContentDialog
        {
            XamlRoot = Content.XamlRoot, Title = "Scan a document", PrimaryButtonText = "Upload as one PDF", SecondaryButtonText = "Scan page", CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Secondary, IsPrimaryButtonEnabled = false, IsSecondaryButtonEnabled = false,
            Content = Stack(12, devices, sources, resolution, destination, status, Text("Pages are combined into one PDF in the order scanned. A document feeder scans all loaded pages at once.", 12, dim: true))
        };
        int Dpi() => resolution.SelectedIndex == 0 ? 150 : 300;
        void Count() { status.Text = pages.Count == 0 ? "Place the document in the scanner, then click Scan page." : $"{pages.Count} {(pages.Count == 1 ? "page" : "pages")} scanned."; dialog.IsPrimaryButtonEnabled = pages.Count > 0; }
        devices.SelectionChanged += async (_, _) =>
        {
            dialog.IsSecondaryButtonEnabled = false;
            if (devices.SelectedIndex < 0) return;
            try
            {
                available = await Scanning.Sources(found[devices.SelectedIndex].Id);
                sources.ItemsSource = available.Select(source => source switch { Scanning.Source.Flatbed => "Flatbed", Scanning.Source.Feeder => "Document feeder", _ => "Automatic" }).ToList();
                sources.SelectedIndex = available.Count > 0 ? 0 : -1;
                dialog.IsSecondaryButtonEnabled = available.Count > 0;
                Count();
            }
            catch (Exception e) { status.Text = "This scanner is not available. " + e.Message; }
        };
        dialog.SecondaryButtonClick += async (_, args) =>
        {
            args.Cancel = true;
            var deferral = args.GetDeferral();
            dialog.IsSecondaryButtonEnabled = dialog.IsPrimaryButtonEnabled = false;
            status.Text = "Scanning…";
            try { pages.AddRange(await Scanning.Scan(found[devices.SelectedIndex].Id, available[Math.Max(0, sources.SelectedIndex)], Dpi(), folder)); Count(); }
            catch (Exception e) { status.Text = "Scan failed. " + e.Message; dialog.IsPrimaryButtonEnabled = pages.Count > 0; }
            finally { dialog.IsSecondaryButtonEnabled = true; deferral.Complete(); }
        };
        _ = DispatcherQueue.TryEnqueue(async () =>
        {
            try
            {
                found = await Scanning.Devices();
                devices.ItemsSource = found.Select(device => device.Name).ToList();
                devices.PlaceholderText = found.Count == 0 ? "No scanner found" : "Choose a scanner";
                if (found.Count > 0) devices.SelectedIndex = 0;
                else status.Text = "Connect a scanner or add it in Settings → Bluetooth & devices → Printers & scanners.";
            }
            catch (Exception e) { status.Text = "Could not look for scanners. " + e.Message; }
        });
        try
        {
            if (await dialog.ShowAsync() != ContentDialogResult.Primary || pages.Count == 0) return;
            var output = Path.Combine(Path.GetTempPath(), "ReAI Document Scanner", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(output);
            var pdf = Path.Combine(output, $"Scan {DateTime.Now:yyyy-MM-dd HH.mm.ss}.pdf");
            await File.WriteAllBytesAsync(pdf, Scanning.Combine(pages, Dpi()));
            await model.AddCreated(pdf, Destinations.All[Math.Max(0, destination.SelectedIndex)], announce: false);
        }
        catch (Exception e) { model.Error = e.Message; Render(); }
        finally { try { Directory.Delete(folder, true); } catch { } }
    }

    private async Task Retry(Transfer transfer)
    {
        if (transfer.Status == Status.CheckReAI && !await Confirm("Retry this upload?", "Check whether the document already exists in ReAI. Retrying an upload that was accepted can create a duplicate.", "I checked ReAI, retry")) return;
        model.Retry(transfer.Id);
    }

    /// <summary>The button checks for and downloads an update, then restarts into it. Automatic checks only download.</summary>
    private async Task Update(bool manual)
    {
        if (updating || model.Uploading) return;
        if (staged != null)
        {
            if (!manual) return;
            try { Updater.Apply(staged, relaunch: true); staged = null; quitting = true; quickDrop?.Quit(); Close(); Application.Current.Exit(); }
            catch (Exception e) { model.Error = $"This folder cannot be updated ({e.Message}). Download the new version from the ReAI apps page."; Render(); }
            return;
        }
        updating = true; Render();
        try
        {
            if (await updater.Download()) staged = updater.Staged;
            if (manual) model.Notice = staged == null ? $"You have the latest version ({version})." : "The update is ready. Restart to update now, or it installs when you quit the app.";
        }
        catch (Exception e) { if (manual) model.Error = "Could not check for updates. " + e.Message; }
        finally { updating = false; Render(); }
    }

    private void Render()
    {
        bool connected = model.Company != null;
        subtitle.Text = model.Company?.CompanyName ?? "Connect once. Scan, capture and upload here.";
        progress.IsActive = model.Uploading || connecting != null;
        disconnect.Visibility = Shown(connected); disconnect.IsEnabled = !model.Uploading;
        update.Visibility = Shown(version > new Version()); update.IsEnabled = !model.Uploading && !updating;
        update.Content = staged != null ? "Restart to update" : updating ? "Checking for updates…" : "Check for updates";
        connect.Content = connecting == null ? "Connect to ReAI" : "Cancel";
        approval.Visibility = Shown(approval.Text != "");
        connectView.Visibility = Shown(!connected); mainView.Visibility = Shown(connected);
        notice.Message = model.Notice ?? ""; notice.IsOpen = model.Notice != null;
        error.Message = model.Error ?? ""; error.IsOpen = model.Error != null;
        shell.UpdateTip("ReAI Document Scanner · " + model.UploadStatus);
        quickDrop?.Render();
        if (!connected) return;
        destinations.SelectedIndex = Array.IndexOf(Destinations.All, model.Destination);
        dropTitle.Text = "Drop files into " + model.Destination.Title().ToLowerInvariant();
        explanation.Text = model.Destination.Explanation();
        pause.Content = model.Paused ? "Resume uploads" : "Pause uploads";
        RenderFolders();
        RenderUploads();
    }

    private void RenderFolders()
    {
        var list = model.Folders.ToList();
        var key = string.Join("|", list.Select(folder => $"{folder.Id}:{folder.Enabled}:{model.FolderStatus.GetValueOrDefault(folder.Id)}"));
        if (key == shownFolders) return;
        shownFolders = key;
        noFolders.Visibility = Shown(list.Count == 0);
        folders.Children.Clear();
        foreach (var folder in list)
        {
            var enabled = new CheckBox { Content = Path.GetFileName(folder.Path), IsChecked = folder.Enabled, FontWeight = FontWeights.SemiBold };
            enabled.Click += (_, _) => model.SetFolderEnabled(folder.Id, enabled.IsChecked == true);
            var scan = Command("Scan", () => { model.ScheduleFolderScan(folder.Id); return Task.CompletedTask; }, folder.Enabled);
            var remove = Command("Remove", () => { model.RemoveFolder(folder.Id); return Task.CompletedTask; });
            var open = Command("Open", () => { Process.Start(new ProcessStartInfo(folder.Path) { UseShellExecute = true })?.Dispose(); return Task.CompletedTask; });
            var row = Stack(4, enabled, Text($"{folder.Destination.Title()} · {folder.Path}", 12, dim: true),
                Text(model.FolderStatus.GetValueOrDefault(folder.Id) ?? (folder.Enabled ? "Starting…" : "Paused"), 12, dim: true));
            var buttons = Stack(8, open, scan, remove); buttons.Orientation = Orientation.Horizontal;
            row.Children.Add(buttons);
            folders.Children.Add(new Border { Child = row, Padding = new Thickness(12), CornerRadius = new CornerRadius(8), Background = new SolidColorBrush(Colors.Gray) { Opacity = 0.08 } });
        }
    }

    private void RenderUploads()
    {
        var list = model.Transfers.Where(transfer => search.Text == "" || transfer.Filename.Contains(search.Text, StringComparison.CurrentCultureIgnoreCase)).Take(200).ToList();
        var key = string.Join("|", list.Select(transfer => $"{transfer.Id}:{transfer.Status}"));
        empty.Visibility = Shown(!model.Transfers.Any());
        if (key == shownUploads) return;
        shownUploads = key;
        uploads.ItemsSource = list.Select(transfer =>
        {
            var details = Stack(2, Text(transfer.Filename, bold: true), Text(transfer.Detail == "" ? transfer.Destination.Title() : transfer.Detail, 12, dim: true));
            var actions = Stack(8, Text(transfer.Status, 12, dim: true));
            actions.Orientation = Orientation.Horizontal;
            if (transfer.Status is Status.CheckReAI or Status.Rejected) actions.Children.Add(Command(transfer.Status == Status.CheckReAI ? "Retry…" : "Retry", () => Retry(transfer)));
            actions.Children.Add(Command("Show file", () => { Process.Start("explorer.exe", $"/select,\"{transfer.File}\"")?.Dispose(); return Task.CompletedTask; }));
            var row = Table(false, (details, Fill), (actions, Auto));
            row.Padding = new Thickness(0, 6, 0, 6);
            return row;
        }).ToList();
    }
}
