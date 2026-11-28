using Microsoft.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using ReAI.DocumentScanner.Core;
using Windows.ApplicationModel.DataTransfer;
using Windows.Graphics;

namespace ReAI.DocumentScanner;

/// <summary>
/// A small always-on-top panel opened from the notification area icon. Files dropped here upload to the quick drop
/// destination (Receipt reception unless changed). It also lists the latest uploads.
/// </summary>
internal sealed class QuickDropWindow : Window
{
    private readonly ScannerModel model;
    private readonly ComboBox destination = new() { Header = "Drop to", ItemsSource = Destinations.All.Select(item => item.Title()).ToList(), HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly StackPanel recent = new() { Spacing = 6 };
    private readonly TextBlock status = new() { Opacity = 0.65, TextWrapping = TextWrapping.Wrap, FontSize = 12 };
    private bool quitting;
    private string shown = "";

    public QuickDropWindow(ScannerModel model, Action openMain, Func<Task> capture)
    {
        this.model = model;
        Title = "Quick drop";
        SystemBackdrop = new MicaBackdrop();
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "document-scanner.ico"));
        if (AppWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.IsAlwaysOnTop = true; presenter.IsMaximizable = false; presenter.IsMinimizable = false; presenter.IsResizable = false;
        }
        destination.SelectionChanged += (_, _) => { if (destination.SelectedIndex >= 0 && Destinations.All[destination.SelectedIndex] != model.QuickDestination) model.QuickDestination = Destinations.All[destination.SelectedIndex]; };
        var target = new Border
        {
            AllowDrop = true, CornerRadius = new CornerRadius(10), Padding = new Thickness(16), MinHeight = 120, BorderThickness = new Thickness(1),
            Background = new SolidColorBrush(Colors.Teal) { Opacity = 0.08 }, BorderBrush = new SolidColorBrush(Colors.Teal) { Opacity = 0.35 },
            Child = new TextBlock { Text = "Drop files here", FontSize = 16, FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center }
        };
        target.DragOver += (_, e) =>
        {
            if (!e.DataView.Contains(StandardDataFormats.StorageItems)) return;
            e.AcceptedOperation = DataPackageOperation.Copy;
            e.DragUIOverride.Caption = "Upload to " + model.QuickDestination.Title();
        };
        target.Drop += async (_, e) => await model.QuickAdd(await MainWindow.Files(e.DataView));
        var captureButton = new Button { Content = "Capture receipt" };
        captureButton.Click += async (_, _) => { AppWindow.Hide(); await capture(); };
        var openButton = new Button { Content = "Open Document Scanner" };
        openButton.Click += (_, _) => { AppWindow.Hide(); openMain(); };
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { captureButton, openButton } };
        var root = new StackPanel
        {
            Spacing = 12, Padding = new Thickness(16),
            Children = { destination, target, buttons, new TextBlock { Text = "Recent uploads", FontWeight = FontWeights.SemiBold }, recent, status }
        };
        Content = new ScrollViewer { Content = root };
        AppWindow.Closing += (_, closing) => { if (quitting) return; closing.Cancel = true; AppWindow.Hide(); };
        Render();
    }

    public void ShowNearTray()
    {
        var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
        var scale = (Content?.XamlRoot?.RasterizationScale) ?? 1;
        int width = (int)(360 * scale), height = (int)(520 * scale);
        AppWindow.MoveAndResize(new RectInt32(area.X + area.Width - width - 12, area.Y + area.Height - height - 12, width, height));
        AppWindow.Show();
        Activate();
        Render();
    }

    public void Quit() { quitting = true; Close(); }

    public void Render()
    {
        destination.SelectedIndex = Array.IndexOf(Destinations.All, model.QuickDestination);
        destination.IsEnabled = model.Company != null;
        status.Text = model.Error ?? model.UploadStatus;
        var items = model.Transfers.Take(5).ToList();
        var key = string.Join("|", items.Select(transfer => $"{transfer.Id}:{transfer.Status}"));
        if (key == shown) return;
        shown = key;
        recent.Children.Clear();
        if (items.Count == 0) recent.Children.Add(new TextBlock { Text = model.Company == null ? "Connect to ReAI in the main window." : "No uploads yet.", Opacity = 0.65 });
        foreach (var transfer in items)
            recent.Children.Add(new StackPanel
            {
                Children =
                {
                    new TextBlock { Text = transfer.Filename, TextTrimming = TextTrimming.CharacterEllipsis },
                    new TextBlock { Text = $"{transfer.Status} · {transfer.Destination.Title()}", FontSize = 12, Opacity = 0.65 }
                }
            });
    }
}
