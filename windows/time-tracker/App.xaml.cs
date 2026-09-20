using Microsoft.UI.Xaml;
using ReAI.TimeTracker.Core;

namespace ReAI.TimeTracker;

public partial class App : Application
{
    private readonly Mutex singleInstance = new(false, "Local\\ReAI.TimeTracker");
    private Window? window;
    public App() => InitializeComponent();
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        if (!singleInstance.WaitOne(0)) { Exit(); return; }
        window = new MainWindow();
        window.Activate();
    }
}
