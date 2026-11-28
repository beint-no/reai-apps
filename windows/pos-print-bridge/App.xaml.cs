using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;

namespace ReAI.POSPrintBridge;

public partial class App : Application
{
    private const string ShowSignal = "Local\\ReAI.POSPrintBridge.Show";
    private readonly Mutex singleInstance = new(false, "Local\\ReAI.POSPrintBridge");
    private MainWindow? window;
    public App() => InitializeComponent();

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        if (!singleInstance.WaitOne(0))
        {
            // Single instance: ask the running bridge to show its window, then quit.
            try { using var signal = EventWaitHandle.OpenExisting(ShowSignal); signal.Set(); } catch (WaitHandleCannotBeOpenedException) { }
            Exit();
            return;
        }
        var show = new EventWaitHandle(false, EventResetMode.AutoReset, ShowSignal);
        var background = Environment.GetCommandLineArgs().Contains(LoginItem.BackgroundArgument) && Credentials.Read() != null;
        window = new MainWindow(background);
        var dispatcher = DispatcherQueue.GetForCurrentThread();
        new Thread(() => { while (show.WaitOne()) dispatcher.TryEnqueue(() => window.ShowWindow()); }) { IsBackground = true }.Start();
    }
}
