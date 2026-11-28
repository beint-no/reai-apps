using System.Runtime.InteropServices;

namespace ReAI.DocumentScanner;

/// <summary>
/// A hidden Win32 window on the UI thread that owns the notification area icon, the Ctrl+Shift+B hot key and the clipboard
/// listener. Windows does not let notification area icons accept drops, so the icon opens the quick drop panel instead.
/// </summary>
internal sealed class Shell : IDisposable
{
    private const uint TrayMessage = 0x8000 + 1, WM_HOTKEY = 0x0312, WM_CLIPBOARDUPDATE = 0x031D, WM_CONTEXTMENU = 0x007B, WM_LBUTTONUP = 0x0202,
        NIN_SELECT = 0x0400, NIN_KEYSELECT = 0x0401, NIM_ADD = 0, NIM_MODIFY = 1, NIM_DELETE = 2, NIM_SETVERSION = 4,
        NIF_MESSAGE = 0x1, NIF_ICON = 0x2, NIF_TIP = 0x4, NIF_INFO = 0x10, NIF_SHOWTIP = 0x80, NIIF_INFO = 0x1, NOTIFYICON_VERSION_4 = 4,
        MOD_CONTROL = 0x2, MOD_SHIFT = 0x4, MOD_NOREPEAT = 0x4000, VK_B = 0x42, WS_POPUP = 0x80000000, MF_STRING = 0, MF_SEPARATOR = 0x800,
        MF_GRAYED = 0x1, TPM_RETURNCMD = 0x100, TPM_RIGHTBUTTON = 0x2, IMAGE_ICON = 1, LR_LOADFROMFILE = 0x10;
    private const int HotKeyId = 1;

    private delegate IntPtr WindowProcedure(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WindowClass
    {
        public uint cbSize, style; public IntPtr lpfnWndProc; public int cbClsExtra, cbWndExtra;
        public IntPtr hInstance, hIcon, hCursor, hbrBackground; public string? lpszMenuName; public string lpszClassName; public IntPtr hIconSm;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NotifyIconData
    {
        public uint cbSize; public IntPtr hWnd; public uint uID, uFlags, uCallbackMessage; public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szTip;
        public uint dwState, dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string szInfo;
        public uint uVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string szInfoTitle;
        public uint dwInfoFlags; public Guid guidItem; public IntPtr hBalloonIcon;
    }

    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern ushort RegisterClassExW(ref WindowClass windowClass);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowExW(uint exStyle, string className, string windowName, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll")] private static extern IntPtr DefWindowProcW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern uint RegisterWindowMessageW(string name);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr window, int id);
    [DllImport("user32.dll")] private static extern bool AddClipboardFormatListener(IntPtr window);
    [DllImport("user32.dll")] private static extern bool RemoveClipboardFormatListener(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr LoadImageW(IntPtr instance, string name, uint type, int width, int height, uint load);
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
    [DllImport("user32.dll")] private static extern IntPtr CreatePopupMenu();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool AppendMenuW(IntPtr menu, uint flags, UIntPtr id, string? text);
    [DllImport("user32.dll")] private static extern int TrackPopupMenuEx(IntPtr menu, uint flags, int x, int y, IntPtr window, IntPtr parameters);
    [DllImport("user32.dll")] private static extern bool DestroyMenu(IntPtr menu);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern bool PostMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandleW(string? name);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern bool Shell_NotifyIconW(uint message, ref NotifyIconData data);

    private readonly WindowProcedure procedure;
    private readonly IntPtr window, icon;
    private readonly uint taskbarCreated;
    private bool disposed;

    public event Action? IconClicked, HotKeyPressed, ClipboardChanged;
    public bool HotKeyRegistered { get; }
    public static uint ClipboardSequence => GetClipboardSequenceNumber();

    public Shell(string iconPath, string tip)
    {
        procedure = Procedure;
        var instance = GetModuleHandleW(null);
        var windowClass = new WindowClass
        {
            cbSize = (uint)Marshal.SizeOf<WindowClass>(), lpfnWndProc = Marshal.GetFunctionPointerForDelegate(procedure),
            hInstance = instance, lpszClassName = "ReAI.DocumentScanner.Shell"
        };
        RegisterClassExW(ref windowClass);
        window = CreateWindowExW(0, windowClass.lpszClassName, "ReAI Document Scanner", WS_POPUP, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, instance, IntPtr.Zero);
        if (window == IntPtr.Zero) throw new InvalidOperationException("Could not create the notification area window.");
        icon = LoadImageW(IntPtr.Zero, iconPath, IMAGE_ICON, 0, 0, LR_LOADFROMFILE);
        taskbarCreated = RegisterWindowMessageW("TaskbarCreated");
        Tip = tip;
        AddIcon();
        HotKeyRegistered = RegisterHotKey(window, HotKeyId, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, VK_B);
        AddClipboardFormatListener(window);
    }

    public string Tip { get; set; }

    private NotifyIconData Data(uint flags) => new()
    {
        cbSize = (uint)Marshal.SizeOf<NotifyIconData>(), hWnd = window, uID = 1, uFlags = flags, uCallbackMessage = TrayMessage,
        hIcon = icon, szTip = Tip.Length > 127 ? Tip[..127] : Tip, szInfo = "", szInfoTitle = "", uVersion = NOTIFYICON_VERSION_4
    };

    private void AddIcon()
    {
        var data = Data(NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP);
        Shell_NotifyIconW(NIM_ADD, ref data);
        Shell_NotifyIconW(NIM_SETVERSION, ref data);
    }

    /// <summary>Updates the hover text of the notification area icon.</summary>
    public void UpdateTip(string tip)
    {
        if (disposed || tip == Tip) return;
        Tip = tip;
        var data = Data(NIF_TIP | NIF_SHOWTIP);
        Shell_NotifyIconW(NIM_MODIFY, ref data);
    }

    /// <summary>Shows a Windows notification from the notification area icon.</summary>
    public void Notify(string title, string message)
    {
        if (disposed) return;
        var data = Data(NIF_INFO);
        data.szInfoTitle = title.Length > 63 ? title[..63] : title;
        data.szInfo = message.Length > 255 ? message[..255] : message;
        data.dwInfoFlags = NIIF_INFO;
        Shell_NotifyIconW(NIM_MODIFY, ref data);
    }

    /// <summary>Shows a context menu at the pointer and returns the chosen command, or 0.</summary>
    public int Menu((int Id, string? Title, bool Enabled)[] items)
    {
        var menu = CreatePopupMenu();
        try
        {
            foreach (var (id, title, enabled) in items)
                AppendMenuW(menu, title == null ? MF_SEPARATOR : MF_STRING | (enabled ? 0 : MF_GRAYED), (UIntPtr)id, title);
            GetCursorPos(out var point);
            SetForegroundWindow(window);
            var chosen = TrackPopupMenuEx(menu, TPM_RETURNCMD | TPM_RIGHTBUTTON, point.X, point.Y, window, IntPtr.Zero);
            PostMessageW(window, 0, IntPtr.Zero, IntPtr.Zero);
            return chosen;
        }
        finally { DestroyMenu(menu); }
    }

    public event Action? MenuRequested;

    private IntPtr Procedure(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            if (message == TrayMessage)
            {
                switch ((uint)(lParam.ToInt64() & 0xFFFF))
                {
                    case WM_LBUTTONUP or NIN_SELECT or NIN_KEYSELECT: IconClicked?.Invoke(); break;
                    case WM_CONTEXTMENU: MenuRequested?.Invoke(); break;
                }
                return IntPtr.Zero;
            }
            if (message == WM_HOTKEY && wParam.ToInt32() == HotKeyId) { HotKeyPressed?.Invoke(); return IntPtr.Zero; }
            if (message == WM_CLIPBOARDUPDATE) { ClipboardChanged?.Invoke(); return IntPtr.Zero; }
            // Explorer restarted: the notification area is new and needs the icon again.
            if (message == taskbarCreated && taskbarCreated != 0) { AddIcon(); return IntPtr.Zero; }
        }
        catch { }
        return DefWindowProcW(handle, message, wParam, lParam);
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        var data = Data(0);
        Shell_NotifyIconW(NIM_DELETE, ref data);
        UnregisterHotKey(window, HotKeyId);
        RemoveClipboardFormatListener(window);
        DestroyWindow(window);
        if (icon != IntPtr.Zero) DestroyIcon(icon);
    }
}
