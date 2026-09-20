using Microsoft.UI.Xaml;
using ReAI.Import.Core;

namespace ReAI.Import;

public partial class App : Application
{
    private readonly Mutex singleInstance = new(false, "Local\\ReAI.Import");
    private Window? window;
    public App()
    {
        UnhandledException += (_, error) => SaveDiagnostic(error.Exception);
        InitializeComponent();
    }
    private static void SaveDiagnostic(Exception error)
    {
        var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ReAI", "Import");
        try { Directory.CreateDirectory(directory); File.WriteAllText(Path.Combine(directory, "last-error.txt"), error.ToString()); }
        catch (IOException) { }
    }
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        if (!singleInstance.WaitOne(0)) { Exit(); return; }
        window = new MainWindow();
        window.Activate();
    }
}
