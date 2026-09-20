using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Media;
using ReAI.Import.Core;
using Windows.ApplicationModel.DataTransfer;
using Windows.Graphics;
using Windows.Storage;
using Windows.UI;
using WinPicker = Microsoft.Windows.Storage.Pickers;

namespace ReAI.Import;

public sealed class MainWindow : Window
{
    private readonly ReAIClient api = new();
    private readonly ImportJournal journal;
    private readonly ImportSession session;
    private readonly Grid root = new() { Padding = new Thickness(32, 20, 32, 24), RowSpacing = 16 };
    private readonly TextBlock companyText = Text("Choose a company when connecting", 13);
    private readonly TextBlock status = Text("Your file stays on this computer. Nothing is created until you confirm.", 13);
    private readonly InfoBar notice = new() { IsClosable = true };
    private readonly Button connect = new() { Content = "Connect to ReAI" };
    private readonly Button disconnect = new() { Content = "Disconnect", Visibility = Visibility.Collapsed };
    private readonly Button browse = new() { Content = "Choose file" };
    private readonly Button review = new() { Content = "Review import" };
    private readonly Button start = new() { Content = "Import ready rows", Visibility = Visibility.Collapsed };
    private readonly Button pause = new() { Content = "Pause", Visibility = Visibility.Collapsed };
    private readonly Button export = new() { Content = "Export report", Visibility = Visibility.Collapsed };
    private readonly Button reset = new() { Content = "New import", Visibility = Visibility.Collapsed };
    private readonly Button exclude = new() { Content = "Exclude selected row", Visibility = Visibility.Collapsed };
    private readonly ComboBox kind = new() { Header = "Import", ItemsSource = Enum.GetNames<ImportKind>(), SelectedIndex = 0, Width = 150 };
    private readonly ComboBox sheetPicker = new() { Header = "Worksheet", Width = 180 };
    private readonly NumberBox header = new() { Header = "Header row", Minimum = 1, Maximum = 100, Value = 1, SmallChange = 1, SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Compact, Width = 110 };
    private readonly ComboBox decimals = new() { Header = "Decimal separator", ItemsSource = new[] { "Dot · 1234.50", "Comma · 1234,50" }, SelectedIndex = 0, Width = 170 };
    private readonly ComboBox contacts = new() { Header = "Default contact type", ItemsSource = new[] { "Company", "Private person" }, SelectedIndex = 0, Width = 170 };
    private readonly StackPanel settings = new() { Orientation = Orientation.Horizontal, Spacing = 16 };
    private readonly StackPanel mappings = new() { Spacing = 8 };
    private readonly ScrollViewer mappingScroll;
    private readonly ListView rows = new() { SelectionMode = ListViewSelectionMode.Single };
    private readonly StackPanel rowDetails = new() { Spacing = 10 };
    private readonly Grid reviewPanel = new() { ColumnSpacing = 24, Visibility = Visibility.Collapsed };
    private readonly Border dropZone;
    private readonly TextBlock filenameText = Text("Drop an Excel or CSV file here", 20);
    private readonly TextBlock counts = Text("", 14);
    private List<Sheet> sheets = [];
    private readonly List<ComboBox> mappingPickers = [];
    private ImportBatch? batch;
    private Account? account;
    private string? token;
    private string filename = "";
    private bool busy, importing, changing;
    private CancellationTokenSource? connecting;
    private ImportKind Kind => (ImportKind)Math.Max(0, kind.SelectedIndex);
    private Sheet? Sheet => sheetPicker.SelectedIndex >= 0 && sheetPicker.SelectedIndex < sheets.Count ? sheets[sheetPicker.SelectedIndex] : null;

    public MainWindow()
    {
        Title = "ReAI Import";
        SystemBackdrop = new MicaBackdrop();
        var area = Microsoft.UI.Windowing.DisplayArea.GetFromWindowId(AppWindow.Id, Microsoft.UI.Windowing.DisplayAreaFallback.Primary).WorkArea;
        AppWindow.Resize(new SizeInt32(Math.Min(1180, area.Width - 80), Math.Min(840, area.Height - 80)));
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "import.ico"));
        journal = new ImportJournal(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ReAI", "Import"));
        session = new ImportSession(api, journal);
        foreach (var height in new[] { GridLength.Auto, GridLength.Auto, GridLength.Auto, GridLength.Auto, new GridLength(1, GridUnitType.Star), GridLength.Auto, GridLength.Auto }) root.RowDefinitions.Add(new() { Height = height });
        var top = new Grid(); top.ColumnDefinitions.Add(new()); top.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var title = new StackPanel { Spacing = 4 }; title.Children.Add(Text("Import into ReAI", 30)); title.Children.Add(companyText); top.Children.Add(title);
        var connectionButtons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center }; connectionButtons.Children.Add(disconnect); connectionButtons.Children.Add(connect); Grid.SetColumn(connectionButtons, 1); top.Children.Add(connectionButtons); Add(top, 0);
        Add(notice, 1);
        var dropContents = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
        dropContents.Children.Add(filenameText); dropContents.Children.Add(Text(".xlsx, .csv or .tsv · up to 10 MB and 10,000 rows", 13)); dropContents.Children.Add(browse);
        dropZone = new Border { Child = dropContents, Padding = new Thickness(24), CornerRadius = new CornerRadius(12), BorderThickness = new Thickness(1), BorderBrush = new SolidColorBrush(Color.FromArgb(100, 100, 120, 130)), AllowDrop = true };
        Add(dropZone, 2);
        foreach (var control in new Control[] { kind, sheetPicker, header, decimals, contacts }) settings.Children.Add(control);
        Add(settings, 3);
        mappingScroll = new ScrollViewer { Content = mappings, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        Add(mappingScroll, 4);
        reviewPanel.ColumnDefinitions.Add(new() { Width = new GridLength(3, GridUnitType.Star) }); reviewPanel.ColumnDefinitions.Add(new() { Width = new GridLength(2, GridUnitType.Star) });
        rows.ItemTemplate = (DataTemplate)XamlReader.Load("""
            <DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
              <StackPanel Spacing="3" Margin="0,5"><TextBlock Text="{Binding Label}" FontWeight="SemiBold" TextTrimming="CharacterEllipsis"/><TextBlock Text="{Binding Status}" FontSize="12"/><TextBlock Text="{Binding Detail}" FontSize="12" TextWrapping="Wrap" MaxLines="2"/></StackPanel>
            </DataTemplate>
            """);
        rows.SelectionChanged += (_, _) => ShowRow();
        reviewPanel.Children.Add(rows); var inspector = new ScrollViewer { Content = rowDetails }; Grid.SetColumn(inspector, 1); reviewPanel.Children.Add(inspector); Add(reviewPanel, 4);
        var footer = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        foreach (var b in new[] { review, start, pause, exclude, export, reset }) footer.Children.Add(b);
        footer.Children.Add(counts); Add(footer, 5); Add(status, 6);
        Content = root;
        connect.Click += async (_, _) => { if (connecting != null) { connecting.Cancel(); return; } await Guard(Connect); };
        disconnect.Click += (_, _) => { Credentials.Clear(); token = null; account = null; Refresh(); };
        browse.Click += async (_, _) => await Guard(async () =>
        {
            var picker = new WinPicker.FileOpenPicker(AppWindow.Id);
            foreach (var extension in new[] { ".xlsx", ".csv", ".tsv", ".txt" }) picker.FileTypeFilter.Add(extension);
            var file = await picker.PickSingleFileAsync(); if (file != null) await Load(file.Path);
        });
        dropZone.DragOver += (_, e) => { if (!busy && batch == null && e.DataView.Contains(StandardDataFormats.StorageItems)) { e.AcceptedOperation = DataPackageOperation.Copy; e.DragUIOverride.Caption = "Read spreadsheet"; } };
        dropZone.Drop += async (_, e) =>
        {
            if (busy || batch != null) return;
            var deferral = e.GetDeferral();
            try { await Guard(async () => { var files = await e.DataView.GetStorageItemsAsync(); if (files.Count != 1 || files[0] is not StorageFile file) throw new InvalidOperationException("Drop one spreadsheet file at a time."); await Load(file.Path); }); }
            finally { deferral.Complete(); }
        };
        kind.SelectionChanged += (_, _) => Remap(); sheetPicker.SelectionChanged += (_, _) => Remap(); header.ValueChanged += (_, _) => Remap();
        review.Click += async (_, _) => await Guard(Review);
        start.Click += async (_, _) => await Guard(Import);
        pause.Click += (_, _) => { session.PauseRequested = true; pause.IsEnabled = false; status.Text = "Pausing after the current request…"; };
        reset.Click += async (_, _) => await Guard(NewImport);
        export.Click += async (_, _) => await Guard(Export);
        exclude.Click += (_, _) => { if (batch != null && rows.SelectedItem is ImportRow { State: RowState.Ready } row) { try { row.State = RowState.Skipped; row.Detail = "Excluded by you."; journal.Record(batch, row); RefreshRows(); } catch (Exception e) { Fail(e); } } };
        AppWindow.Closing += (_, e) => { if (busy) { e.Cancel = true; connecting?.Cancel(); session.PauseRequested = true; status.Text = "Finishing the current operation. Close the window once it completes."; } };
        root.Loaded += async (_, _) => await Guard(Initialize);
        Remap();
    }
    private static TextBlock Text(string value, double size = 14) => new() { Text = value, FontSize = size, TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true };
    private void Add(FrameworkElement element, int row) { Grid.SetRow(element, row); root.Children.Add(element); }
    private void Fail(Exception error) { notice.Title = "Could not complete the action"; notice.Message = error.Message; notice.Severity = InfoBarSeverity.Error; notice.IsOpen = true; }
    private async Task Guard(Func<Task> action)
    {
        if (busy) return;
        busy = true; notice.IsOpen = false; Refresh();
        try { await action(); }
        catch (OperationCanceledException) { status.Text = "Connection cancelled or expired. You can connect again."; }
        catch (Exception error) { Fail(error); }
        finally { busy = false; importing = false; Refresh(); }
    }
    private async Task Initialize()
    {
        batch = journal.Load();
        if (batch != null) { filename = batch.Filename; filenameText.Text = filename; RefreshRows(); }
        token = Credentials.Read();
        if (token != null) { try { account = await api.Account(token); } catch { token = null; throw; } }
    }
    private async Task Connect()
    {
        connecting = new(); connect.Content = "Cancel connection"; connect.IsEnabled = true;
        try
        {
            var nextToken = await api.Connect((code, uri) =>
            {
                status.Text = "Compare this code in your browser: " + code + ". Choose the company and approve.";
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            }, connecting.Token);
            var nextAccount = await api.Account(nextToken, connecting.Token);
            Credentials.Save(nextToken); token = nextToken; account = nextAccount; status.Text = "Connected. Review your file before importing.";
        }
        finally { connecting.Dispose(); connecting = null; connect.Content = "Connect to ReAI"; }
    }
    private async Task Load(string path)
    {
        sheets = await Task.Run(() => Spreadsheet.Read(path)); filename = Path.GetFileName(path); filenameText.Text = filename;
        changing = true; sheetPicker.ItemsSource = sheets.Select(s => s.Name).ToArray(); sheetPicker.SelectedIndex = 0; header.Value = 1; changing = false; Remap();
    }
    private void Remap()
    {
        if (changing || batch != null) return;
        contacts.Visibility = Kind == ImportKind.Products ? Visibility.Collapsed : Visibility.Visible;
        decimals.Visibility = Kind == ImportKind.Products ? Visibility.Visible : Visibility.Collapsed;
        mappings.Children.Clear(); mappingPickers.Clear();
        if (Sheet is not { } sheet || double.IsNaN(header.Value)) { Refresh(); return; }
        var row = (int)header.Value - 1;
        if (row < 0 || row >= sheet.Rows.Count) return;
        var headers = sheet.Rows[row]; var matched = Fields.Match(headers, Kind);
        var fields = new[] { new Field("", "Ignore column", []) }.Concat(Fields.For(Kind)).ToArray();
        mappings.Children.Add(Text("Match your columns", 20));
        mappings.Children.Add(Text("Review the automatic matches. Required fields are marked with *.", 13));
        for (int i = 0; i < headers.Length; i++)
        {
            var line = new Grid { ColumnSpacing = 24, Padding = new Thickness(0, 6, 0, 6) };
            line.ColumnDefinitions.Add(new()); line.ColumnDefinitions.Add(new());
            var source = new StackPanel { Spacing = 4 }; source.Children.Add(Text(string.IsNullOrWhiteSpace(headers[i]) ? $"Column {i + 1}" : headers[i], 14));
            source.Children.Add(Text(row + 1 < sheet.Rows.Count && i < sheet.Rows[row + 1].Length ? sheet.Rows[row + 1][i] : "No sample value", 12)); line.Children.Add(source);
            var picker = new ComboBox { HorizontalAlignment = HorizontalAlignment.Stretch, ItemsSource = fields.Select(f => f.Title + (f.Required ? " *" : "")).ToArray(), SelectedIndex = Array.FindIndex(fields, f => f.Id == matched[i]), Tag = fields };
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(picker, "ReAI field for " + headers[i]);
            Grid.SetColumn(picker, 1); line.Children.Add(picker); mappingPickers.Add(picker); mappings.Children.Add(line);
        }
        Refresh();
    }
    private async Task Review()
    {
        if (token == null || Sheet == null) throw new InvalidOperationException("Choose a file and connect to ReAI first.");
        if (double.IsNaN(header.Value) || header.Value != Math.Truncate(header.Value)) throw new InvalidOperationException("Choose a whole-number header row.");
        var current = await api.Account(token); account = current;
        var company = current.Tenants[0];
        var existing = await api.Existing(Kind, token, company.Id);
        var mapping = mappingPickers.Select(p => ((Field[])p.Tag)[p.SelectedIndex].Id).ToArray();
        var prepared = Validation.Prepare(Sheet, (int)header.Value - 1, mapping, Kind, decimals.SelectedIndex == 1, contacts.SelectedIndex == 1, existing.Keys);
        var next = new ImportBatch(Guid.NewGuid(), filename, Kind, company, current.Email, prepared);
        journal.Save(next); batch = next; RefreshRows();
        status.Text = "Review the rows. Invalid, duplicate and excluded rows will not be imported.";
    }
    private async Task Import()
    {
        if (batch == null || token == null) return;
        var ready = batch.Rows.Count(r => r.State == RowState.Ready);
        var dialog = new ContentDialog { XamlRoot = root.XamlRoot, Title = $"Import {ready} {batch.Kind.ToString().ToLowerInvariant()}?", Content = $"Company: {batch.Company.CompanyName}\nAccount: {batch.Email}\n\nThis creates new records. ReAI may reuse an existing company profile and fill missing address details. Review your mappings and row values first.", PrimaryButtonText = "Import", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Close };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        importing = true; Refresh();
        await session.Run(batch, token, RefreshRows);
        status.Text = session.PauseRequested ? "Import paused. Check the report before continuing." : "Import complete. Export the report for your records.";
    }
    private async Task NewImport()
    {
        if (batch != null)
        {
            var dialog = new ContentDialog { XamlRoot = root.XamlRoot, Title = "Start a new import?", Content = "This removes the saved progress and report on this computer. Export the report first if you need it. Records already created in ReAI remain there.", PrimaryButtonText = "New import", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Close };
            if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        }
        journal.Clear(); batch = null; Remap(); rows.ItemsSource = null; rowDetails.Children.Clear(); counts.Text = "";
    }
    private async Task Export()
    {
        if (batch == null) return;
        var picker = new WinPicker.FileSavePicker(AppWindow.Id) { SuggestedFileName = Path.GetFileNameWithoutExtension(batch.Filename) + "-report" };
        picker.FileTypeChoices.Add("CSV report", new List<string> { ".csv" });
        var file = await picker.PickSaveFileAsync();
        if (file != null) await File.WriteAllTextAsync(file.Path, ImportSession.Report(batch), new UTF8Encoding(true));
    }
    private void RefreshRows()
    {
        var selected = rows.SelectedItem as ImportRow;
        rows.ItemsSource = null; rows.ItemsSource = batch?.Rows;
        if (selected != null) rows.SelectedItem = selected;
        else if (batch?.Rows.Count > 0) rows.SelectedIndex = 0;
        counts.Text = batch == null ? "" : string.Join(" · ", batch.Rows.GroupBy(r => r.Status).Select(g => $"{g.Count()} {g.Key}"));
        ShowRow();
    }
    private void ShowRow()
    {
        rowDetails.Children.Clear();
        if (rows.SelectedItem is not ImportRow row) return;
        rowDetails.Children.Add(Text(row.Name, 22)); rowDetails.Children.Add(Text(row.Status + " · " + row.Detail, 13));
        Dictionary<string, JsonElement>? values = row.Payload == null ? null : JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(row.Payload);
        if (values?.Remove("variants", out var variants) == true) foreach (var property in variants[0].EnumerateObject()) values[property.Name] = property.Value;
        foreach (var field in Fields.For(batch!.Kind))
        {
            string? value = values?.GetValueOrDefault(field.Id).ValueKind is JsonValueKind.Undefined or null ? row.Values.GetValueOrDefault(field.Id) : values[field.Id].ToString();
            if (string.IsNullOrEmpty(value)) continue;
            var pair = new StackPanel { Spacing = 2 }; pair.Children.Add(Text(field.Title, 12)); pair.Children.Add(Text(value, 14)); rowDetails.Children.Add(pair);
        }
        exclude.IsEnabled = !busy && row.State == RowState.Ready;
    }
    private void Refresh()
    {
        companyText.Text = account == null ? "Choose a company when connecting" : account.Tenants[0].CompanyName + " · " + account.Email;
        connect.Visibility = account == null ? Visibility.Visible : Visibility.Collapsed; connect.IsEnabled = !busy || connecting != null;
        disconnect.Visibility = account == null ? Visibility.Collapsed : Visibility.Visible; disconnect.IsEnabled = !busy;
        browse.IsEnabled = !busy && batch == null; dropZone.AllowDrop = !busy && batch == null;
        settings.Visibility = batch == null ? Visibility.Visible : Visibility.Collapsed;
        foreach (var control in settings.Children.OfType<Control>()) control.IsEnabled = !busy && batch == null; mappingScroll.IsEnabled = !busy;
        mappingScroll.Visibility = batch == null ? Visibility.Visible : Visibility.Collapsed; reviewPanel.Visibility = batch == null ? Visibility.Collapsed : Visibility.Visible;
        review.Visibility = batch == null ? Visibility.Visible : Visibility.Collapsed; review.IsEnabled = !busy && Sheet != null && token != null;
        start.Visibility = batch == null ? Visibility.Collapsed : Visibility.Visible;
        start.IsEnabled = !busy && token != null && batch != null && account?.Email == batch.Email && account.Tenants[0].Id == batch.Company.Id && batch.Rows.Any(r => r.State == RowState.Ready);
        pause.Visibility = importing ? Visibility.Visible : Visibility.Collapsed; pause.IsEnabled = importing && !session.PauseRequested;
        foreach (var button in new[] { export, reset, exclude }) { button.Visibility = batch == null ? Visibility.Collapsed : Visibility.Visible; button.IsEnabled = !busy; }
        exclude.IsEnabled = !busy && rows.SelectedItem is ImportRow { State: RowState.Ready };
    }
}
