using System.Diagnostics;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using ReAI.TimeTracker.Core;
using Windows.Graphics;
using Windows.System;

namespace ReAI.TimeTracker;

public sealed class MainWindow : Window
{
    private readonly ReAIClient api = new();
    private readonly Tracker tracker;
    private readonly StackPanel body = new() { Spacing = 18, Padding = new Thickness(28) };
    private readonly TextBlock company = Text("Choose a company when connecting", 13);
    private readonly Button connect = new() { Content = "Connect to ReAI", HorizontalAlignment = HorizontalAlignment.Left };
    private readonly Button disconnect = new() { Content = "Disconnect" };
    private readonly Button action = new() { Content = "Start tracking", HorizontalAlignment = HorizontalAlignment.Stretch, Height = 48 };
    private readonly TextBlock clock = Text("00:00:00", 48);
    private readonly TextBlock phase = Text("READY", 12);
    private readonly TextBlock work = Text("Without a project", 17);
    private readonly TextBlock preview = Text("", 13);
    private readonly TextBlock saved = Text("", 14);
    private readonly TextBlock sync = Text("", 12);
    private readonly TextBlock connectionStatus = Text("", 13);
    private readonly InfoBar error = new() { IsClosable = true, Severity = InfoBarSeverity.Error };
    private readonly TextBox search = new() { PlaceholderText = "Find a project", Header = "Project search" };
    private readonly ComboBox projects = new() { Header = "Project", HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly ComboBox activities = new() { Header = "Activity (optional)", HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly StackPanel selection = new() { Spacing = 12 };
    private readonly StackPanel recent = new() { Spacing = 8 };
    private readonly StackPanel pending = new() { Spacing = 8 };
    private readonly Button retry = new() { Content = "Retry saved request" };
    private readonly Button refresh = new() { Content = "Refresh" };
    private readonly Button timesheet = new() { Content = "Open timesheet" };
    private readonly CheckBox top = new() { Content = "Keep on top" };
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer ticker;
    private List<Project> visibleProjects = [];
    private List<Activity> visibleActivities = [];
    private CancellationTokenSource? connecting;
    private bool changing, initializing = true;
    private string? localError;
    private DateTimeOffset nextPoll = DateTimeOffset.Now.AddSeconds(30);

    public MainWindow()
    {
        Title = "ReAI Time Tracker";
        SystemBackdrop = new MicaBackdrop();
        var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
        AppWindow.Resize(new SizeInt32(490, Math.Min(840, area.Height - 70)));
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "timer.ico"));
        tracker = new(api, new TrackerStore(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ReAI", "TimeTracker")));
        tracker.Changed += Render;
        clock.FontFamily = new FontFamily("Cascadia Mono");
        body.Children.Add(Text("Time Tracker", 28)); body.Children.Add(company); body.Children.Add(connect); body.Children.Add(connectionStatus); body.Children.Add(error);
        var timer = new StackPanel { Spacing = 6 }; timer.Children.Add(phase); timer.Children.Add(clock); timer.Children.Add(work); timer.Children.Add(preview);
        body.Children.Add(new Border { Child = timer, Padding = new Thickness(20), CornerRadius = new CornerRadius(12), Background = (Brush)Application.Current.Resources["CardBackgroundFillColorDefaultBrush"] });
        selection.Children.Add(search); selection.Children.Add(projects); selection.Children.Add(activities); body.Children.Add(selection);
        body.Children.Add(action); body.Children.Add(recent);
        pending.Children.Add(Text("A request needs confirmation", 17));
        pending.Children.Add(Text("Retry the saved request with the original account and company. This will not duplicate time or stop a newer timer. Until Stop is confirmed, the timer may keep running.", 13)); pending.Children.Add(retry); body.Children.Add(pending);
        body.Children.Add(saved);
        body.Children.Add(Text(Timing.Rules, 13));
        body.Children.Add(Text("Timers keep running when you close the app or your PC sleeps. ReAI caps each session at 10 hours. Start and Stop need an internet connection.", 12));
        body.Children.Add(sync);
        var links = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; links.Children.Add(timesheet); links.Children.Add(refresh); links.Children.Add(disconnect); body.Children.Add(links); body.Children.Add(top);
        body.Children.Add(Text("Ctrl + Enter: start / stop", 12));
        Content = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        var shortcut = new KeyboardAccelerator { Key = VirtualKey.Enter, Modifiers = VirtualKeyModifiers.Control };
        shortcut.Invoked += async (_, e) => { e.Handled = true; await StartOrStop(); }; body.KeyboardAccelerators.Add(shortcut);
        connect.Click += async (_, _) => await Connect();
        disconnect.Click += async (_, _) =>
        {
            if (tracker.Busy) return;
            var dialog = new ContentDialog { XamlRoot = body.XamlRoot, Title = "Disconnect this PC?", Content = "Running timers continue in ReAI. This removes the local key; revoke access in your ReAI profile to remove server access.", PrimaryButtonText = "Disconnect", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Close };
            if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
            try { Credentials.Clear(); tracker.Disconnect(); } catch (Exception e) { ShowError(e); }
        };
        action.Click += async (_, _) => await StartOrStop();
        retry.Click += async (_, _) => await tracker.Retry();
        refresh.Click += async (_, _) => await tracker.Refresh(projects: true);
        timesheet.Click += (_, _) => { if (tracker.TimesheetUri is { } uri) { try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); } catch (Exception e) { ShowError(e); } } };
        search.TextChanged += (_, _) => PopulateProjects();
        projects.SelectionChanged += (_, _) =>
        {
            if (changing) return;
            var project = projects.SelectedIndex > 0 ? visibleProjects[projects.SelectedIndex - 1] : null;
            tracker.Selection = new(project?.Id, null, project == null ? "Without a project" : tracker.ProjectTitle(project), null);
            PopulateActivities(); UpdateClock();
        };
        activities.SelectionChanged += (_, _) =>
        {
            if (changing) return;
            var activity = activities.SelectedIndex > 0 ? visibleActivities[activities.SelectedIndex - 1] : null;
            tracker.Selection = tracker.Selection with { ActivityId = activity?.Id, ActivityName = activity?.Code }; UpdateClock();
        };
        top.Checked += (_, _) => SetTop(true); top.Unchecked += (_, _) => SetTop(false);
        ticker = DispatcherQueue.CreateTimer(); ticker.Interval = TimeSpan.FromSeconds(1);
        ticker.Tick += async (_, _) =>
        {
            UpdateClock();
            if (DateTimeOffset.Now < nextPoll || initializing || connecting != null) return;
            nextPoll = DateTimeOffset.Now.AddSeconds(30); await tracker.Refresh();
        };
        Activated += async (_, _) => { if (!initializing && connecting == null) await tracker.Refresh(); };
        Closed += (_, _) => { ticker.Stop(); connecting?.Cancel(); };
        AppWindow.Closing += (_, e) => { if (tracker.Busy || connecting != null) { e.Cancel = true; connecting?.Cancel(); connectionStatus.Text = "Finishing the current request. Close again once it completes."; } };
        body.Loaded += async (_, _) =>
        {
            if (!initializing) return;
            try { tracker.Load(); var token = Credentials.Read(); if (token != null) await tracker.Connect(token); }
            catch (Exception e) { ShowError(e); }
            finally { initializing = false; Render(); ticker.Start(); }
        };
        Render();
    }
    private static TextBlock Text(string text, double size) => new() { Text = text, FontSize = size, TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true };
    private void SetTop(bool enabled) { if (AppWindow.Presenter is OverlappedPresenter presenter) presenter.IsAlwaysOnTop = enabled; }
    private void ShowError(Exception exception) { localError = exception.Message; error.Message = exception.Message; error.IsOpen = true; }
    private async Task StartOrStop()
    {
        if (connecting != null || initializing || tracker.Busy || tracker.Pending != null) return;
        localError = null;
        if (tracker.Timer != null) await tracker.Stop(); else await tracker.Start();
    }
    private async Task Connect()
    {
        if (connecting != null) { connecting.Cancel(); return; }
        if (tracker.Busy || !tracker.StorageReady) return;
        localError = null; connecting = new(); Render();
        try
        {
            var token = await api.Connect((code, uri) => { connectionStatus.Text = "Compare " + code + " in your browser, choose a company and approve."; Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }, connecting.Token);
            await tracker.Connect(token);
            if (tracker.Account != null) { Credentials.Save(token); connectionStatus.Text = "Connected."; }
        }
        catch (OperationCanceledException) { connectionStatus.Text = "Connection cancelled or expired."; }
        catch (Exception e) { ShowError(e); }
        finally { connecting.Dispose(); connecting = null; Render(); }
    }
    private void PopulateProjects()
    {
        changing = true;
        visibleProjects = tracker.Projects.Where(p => p.Id == tracker.Selection.ProjectId || tracker.ProjectTitle(p).Contains(search.Text, StringComparison.CurrentCultureIgnoreCase)).ToList();
        projects.ItemsSource = new[] { "Without a project" }.Concat(visibleProjects.Select(tracker.ProjectTitle)).ToArray();
        projects.SelectedIndex = visibleProjects.FindIndex(p => p.Id == tracker.Selection.ProjectId) + 1;
        changing = false; PopulateActivities();
    }
    private void PopulateActivities()
    {
        changing = true;
        visibleActivities = tracker.AvailableActivities(tracker.Selection.ProjectId);
        activities.ItemsSource = new[] { "No activity" }.Concat(visibleActivities.Select(a => a.Code)).ToArray();
        activities.SelectedIndex = visibleActivities.FindIndex(a => a.Id == tracker.Selection.ActivityId) + 1;
        activities.Visibility = visibleActivities.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        changing = false;
    }
    private void UpdateClock()
    {
        if (tracker.Timer is { } timer)
        {
            int seconds = Timing.Seconds(timer.StartedAt, DateTimeOffset.UtcNow);
            clock.Text = Timing.Display(seconds); preview.Text = Timing.StopPreview(seconds);
            work.Text = (timer.ProjectName ?? "Without a project") + (tracker.Activities.Find(a => a.Id == timer.ActivityId) is { } activity ? " · " + activity.Code : "");
            phase.Text = tracker.Synchronized ? "TRACKING" : "LAST KNOWN TIMER";
            action.Content = seconds < 60 ? "Stop — no time saved yet" : "Stop & save";
        }
        else { clock.Text = "00:00:00"; phase.Text = tracker.Synchronized ? "READY" : "CHECKING CONNECTION"; work.Text = tracker.Selection.Label; preview.Text = tracker.ProjectNotice ?? "Choose work below, then start."; action.Content = "Start tracking"; }
        sync.Text = tracker.LastSync is { } time ? $"Last checked {time:HH:mm:ss} · checks every 30s, saves on Stop. Refresh an already-open ReAI timesheet to see changes." : "Timer status checks every 30 seconds. Saving happens on Stop.";
    }
    private void Render()
    {
        bool connected = tracker.Account != null, busy = initializing || tracker.Busy || connecting != null;
        company.Text = connected ? tracker.Company!.CompanyName + " · " + tracker.Account!.Email : "Choose a company when connecting";
        connect.Visibility = connected ? Visibility.Collapsed : Visibility.Visible; connect.Content = connecting == null ? "Connect to ReAI" : "Cancel connection"; connect.IsEnabled = tracker.StorageReady && !tracker.Busy && !initializing;
        disconnect.IsEnabled = connected && !busy; refresh.IsEnabled = connected && !busy; timesheet.IsEnabled = connected;
        selection.Visibility = connected && tracker.Timer == null ? Visibility.Visible : Visibility.Collapsed;
        search.IsEnabled = projects.IsEnabled = activities.IsEnabled = !busy && tracker.Pending == null;
        action.IsEnabled = !busy && tracker.Pending == null && (tracker.Timer != null || tracker.CanStart);
        pending.Visibility = tracker.Pending == null ? Visibility.Collapsed : Visibility.Visible; retry.IsEnabled = !busy && tracker.CanRetry;
        PopulateProjects(); recent.Children.Clear();
        if (connected && tracker.Timer == null && tracker.Recent.Count > 0)
        {
            recent.Children.Add(Text("Recent work", 14));
            foreach (var choice in tracker.Recent.Take(3))
            {
                var button = new Button { Content = "Start: " + choice.Label, HorizontalAlignment = HorizontalAlignment.Stretch, IsEnabled = !busy && tracker.CanStart };
                button.Click += async (_, _) => await tracker.Start(choice); recent.Children.Add(button);
            }
        }
        saved.Text = tracker.LastSaved is { } last ? $"Last stopped here · {last.StoppedAt.ToLocalTime():g}\n{last.Label}\n{Timing.Saved(last.Minutes)}" : tracker.Notice ?? "";
        saved.Visibility = string.IsNullOrEmpty(saved.Text) ? Visibility.Collapsed : Visibility.Visible;
        error.Message = tracker.Error ?? localError ?? ""; error.IsOpen = !string.IsNullOrEmpty(error.Message);
        UpdateClock();
    }
}
