using System.Runtime.InteropServices;

namespace ReAI.POSPrintBridge;

/// <summary>Notification-area icon with a small menu, through the Win32 shell API. Messages arrive on the window's own thread.</summary>
internal sealed class Tray : IDisposable
{
    private const uint CallbackMessage = 0x8000 + 1; // WM_APP + 1
    private const uint WM_LBUTTONUP = 0x0202, WM_RBUTTONUP = 0x0205, WM_CONTEXTMENU = 0x007B;
    private const uint NIM_ADD = 0, NIM_MODIFY = 1, NIM_DELETE = 2, NIF_MESSAGE = 0x1, NIF_ICON = 0x2, NIF_TIP = 0x4;
    private readonly IntPtr window, icon;
    private readonly uint taskbarCreated = RegisterWindowMessageW("TaskbarCreated");
    private readonly SubclassProc procedure;
    private readonly (string Text, Action Run, Func<bool> Enabled)[] items;
    private string tip = "ReAI POS Print Bridge";

    public Tray(IntPtr window, string iconPath, (string Text, Action Run, Func<bool> Enabled)[] items)
    {
        this.window = window;
        this.items = items;
        icon = LoadImageW(IntPtr.Zero, iconPath, 1, 0, 0, 0x10 | 0x40); // IMAGE_ICON, LR_LOADFROMFILE | LR_DEFAULTSIZE
        procedure = Procedure;
        SetWindowSubclass(window, procedure, 1, IntPtr.Zero);
        Notify(NIM_ADD);
    }

    public void SetTip(string text)
    {
        text = text.Length > 120 ? text[..120] : text;
        if (text == tip) return;
        tip = text;
        Notify(NIM_MODIFY);
    }

    private void Notify(uint message)
    {
        var data = new NotifyIconData
        {
            Size = (uint)Marshal.SizeOf<NotifyIconData>(), Window = window, Id = 1, Flags = NIF_MESSAGE | NIF_ICON | NIF_TIP,
            CallbackMessage = CallbackMessage, Icon = icon, Tip = tip, Info = "", InfoTitle = ""
        };
        Shell_NotifyIconW(message, ref data);
    }

    private IntPtr Procedure(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, UIntPtr id, IntPtr data)
    {
        if (message == taskbarCreated) Notify(NIM_ADD);
        else if (message == CallbackMessage)
        {
            var mouse = (uint)(lParam.ToInt64() & 0xFFFF);
            if (mouse == WM_LBUTTONUP) items[0].Run();
            else if (mouse is WM_RBUTTONUP or WM_CONTEXTMENU) ShowMenu();
            return IntPtr.Zero;
        }
        return DefSubclassProc(hwnd, message, wParam, lParam);
    }

    private void ShowMenu()
    {
        var menu = CreatePopupMenu();
        try
        {
            for (int index = 0; index < items.Length; index++)
                if (items[index].Text == "-") AppendMenuW(menu, 0x800, UIntPtr.Zero, null); // MF_SEPARATOR
                else AppendMenuW(menu, items[index].Enabled() ? 0u : 0x1u, (UIntPtr)(index + 1), items[index].Text); // MF_GRAYED
            GetCursorPos(out var point);
            SetForegroundWindow(window);
            var chosen = TrackPopupMenuEx(menu, 0x0100 | 0x0002, point.X, point.Y, window, IntPtr.Zero); // TPM_RETURNCMD | TPM_RIGHTBUTTON
            if (chosen > 0) items[chosen - 1].Run();
        }
        finally { DestroyMenu(menu); }
    }

    public void Dispose()
    {
        Notify(NIM_DELETE);
        RemoveWindowSubclass(window, procedure, 1);
        if (icon != IntPtr.Zero) DestroyIcon(icon);
    }

    private delegate IntPtr SubclassProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, UIntPtr id, IntPtr data);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NotifyIconData
    {
        public uint Size;
        public IntPtr Window;
        public uint Id, Flags, CallbackMessage;
        public IntPtr Icon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Tip;
        public uint State, StateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Info;
        public uint Version;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string InfoTitle;
        public uint InfoFlags;
        public Guid Item;
        public IntPtr BalloonIcon;
    }

    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern bool Shell_NotifyIconW(uint message, ref NotifyIconData data);
    [DllImport("comctl32.dll")] private static extern bool SetWindowSubclass(IntPtr hwnd, SubclassProc procedure, nuint id, IntPtr data);
    [DllImport("comctl32.dll")] private static extern bool RemoveWindowSubclass(IntPtr hwnd, SubclassProc procedure, nuint id);
    [DllImport("comctl32.dll")] private static extern IntPtr DefSubclassProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern uint RegisterWindowMessageW(string name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr LoadImageW(IntPtr instance, string name, uint type, int width, int height, uint load);
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
    [DllImport("user32.dll")] private static extern IntPtr CreatePopupMenu();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool AppendMenuW(IntPtr menu, uint flags, UIntPtr id, string? text);
    [DllImport("user32.dll")] private static extern bool DestroyMenu(IntPtr menu);
    [DllImport("user32.dll")] private static extern int TrackPopupMenuEx(IntPtr menu, uint flags, int x, int y, IntPtr window, IntPtr parameters);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
}
