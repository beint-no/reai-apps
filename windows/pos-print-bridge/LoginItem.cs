using Microsoft.Win32;

namespace ReAI.POSPrintBridge;

/// <summary>Starts the bridge in the tray when the user signs in to Windows (per-user Run key, no administrator access).</summary>
internal static class LoginItem
{
    public const string BackgroundArgument = "--background";
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run", Name = "ReAI POS Print Bridge";
    private static string Command => $"\"{Environment.ProcessPath}\" {BackgroundArgument}";

    public static bool Enabled
    {
        get { using var key = Registry.CurrentUser.OpenSubKey(RunKey); return key?.GetValue(Name) as string == Command; }
        set
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKey);
            if (value) key.SetValue(Name, Command); else key.DeleteValue(Name, false);
        }
    }
}
