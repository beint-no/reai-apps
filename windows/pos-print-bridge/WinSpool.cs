using System.Runtime.InteropServices;
using ReAI.POSPrintBridge.Core;

namespace ReAI.POSPrintBridge;

/// <summary>Sends raw ESC/POS bytes to an installed Windows printer with the RAW datatype, bypassing the driver's rendering.</summary>
internal sealed class WinSpool : IRawPrinting
{
    public string[] Queues()
    {
        const uint flags = 0x2 | 0x4; // PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS
        EnumPrintersW(flags, null, 4, IntPtr.Zero, 0, out var needed, out _);
        if (needed == 0) return [];
        var buffer = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!EnumPrintersW(flags, null, 4, buffer, needed, out _, out var count)) return [];
            var size = Marshal.SizeOf<PrinterInfo4>();
            return [.. Enumerable.Range(0, (int)count).Select(index => Marshal.PtrToStructure<PrinterInfo4>(buffer + index * size).Name).OfType<string>().Order()];
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    public Task<SendOutcome> SendToQueue(byte[] data, string queue) => Task.Run<SendOutcome>(() =>
    {
        if (!OpenPrinterW(queue, out var printer, IntPtr.Zero)) return new SendOutcome.NotSent($"The printer {queue} is not installed on this PC.");
        try
        {
            if (StartDocPrinterW(printer, 1, new DocInfo1 { Name = "ReAI receipt", DataType = "RAW" }) == 0)
                return new SendOutcome.NotSent($"Windows did not accept the receipt for {queue}. Check the printer queue.");
            bool written = StartPagePrinter(printer) && WritePrinter(printer, data, data.Length, out var count) && count == data.Length && EndPagePrinter(printer);
            if (!written)
                return AbortPrinter(printer) ? new SendOutcome.NotSent($"Windows could not send the receipt to {queue}.")
                    : new SendOutcome.Uncertain($"Windows stopped while sending the receipt to {queue}. Check the printer queue.");
            return EndDocPrinter(printer) ? new SendOutcome.Sent() : new SendOutcome.Uncertain($"Windows did not confirm the receipt for {queue}. Check the printer queue.");
        }
        finally { ClosePrinter(printer); }
    });

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private sealed class DocInfo1 { public string? Name; public string? OutputFile; public string? DataType; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PrinterInfo4 { public string? Name; public string? Server; public uint Attributes; }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool EnumPrintersW(uint flags, string? name, uint level, IntPtr buffer, uint size, out uint needed, out uint returned);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinterW(string name, out IntPtr printer, IntPtr defaults);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int StartDocPrinterW(IntPtr printer, int level, [In] DocInfo1 info);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr printer);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr printer, byte[] data, int length, out int written);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr printer);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr printer);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool AbortPrinter(IntPtr printer);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr printer);
}
