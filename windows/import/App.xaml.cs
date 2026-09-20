using Microsoft.UI.Xaml;
using ReAI.Import.Core;

namespace ReAI.Import;

public partial class App : Application
{
    private readonly Mutex singleInstance = new(false, "Local\\ReAI.Import");
    private Window? window;
    public App() => InitializeComponent();
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        if (!singleInstance.WaitOne(0)) { Exit(); return; }
        window = new MainWindow();
        window.Activate();
    }
}
