using Microsoft.UI.Xaml;
using ReAI.Shipping.Core;

namespace ReAI.Shipping;

public partial class App : Application
{
    private readonly Mutex singleInstance = new(false, "Local\\ReAI.Shipping");
    private Window? window;
    public App() => InitializeComponent();
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        if (Updater.Installed(Environment.GetCommandLineArgs()) || !singleInstance.WaitOne(0)) { Exit(); return; }
        window = new MainWindow();
        window.Activate();
    }
}
