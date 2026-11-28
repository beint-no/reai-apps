using Microsoft.UI.Xaml;
using ReAI.DocumentScanner.Core;

namespace ReAI.DocumentScanner;

public partial class App : Application
{
    private readonly Mutex singleInstance = new(false, "Local\\ReAI.DocumentScanner");
    private Window? window;
    public App() => InitializeComponent();
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        if (Updater.Installed(Environment.GetCommandLineArgs())) { Exit(); return; }
        if (!singleInstance.WaitOne(0))
        {
            // Already running in the notification area: bring that window forward instead.
            if (EventWaitHandle.TryOpenExisting(MainWindow.ShowEvent, out var show)) using (show) show.Set();
            Exit(); return;
        }
        window = new MainWindow();
        window.Activate();
    }
}
