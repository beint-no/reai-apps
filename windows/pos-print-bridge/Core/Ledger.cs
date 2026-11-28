using System.Net.Sockets;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ReAI.POSPrintBridge.Core;

[JsonConverter(typeof(JsonStringEnumConverter<ReceiptState>))]
public enum ReceiptState
{
    /// <summary>Waiting for the printer. Nothing has been sent yet.</summary>
    Pending,
    /// <summary>Saved before sending; found on launch only if the app stopped mid-print.</summary>
    Printing,
    Printed,
    /// <summary>Bytes may have reached the printer. Only printed again after explicit confirmation.</summary>
    Uncertain,
    /// <summary>The receipt cannot be laid out from ReAI's data. Never printed automatically.</summary>
    Blocked,
    /// <summary>Older than 24 hours when the printer became available. Print manually if still needed.</summary>
    Skipped
}

[JsonConverter(typeof(JsonStringEnumConverter<CopyState>))]
public enum CopyState { Printing, Printed, Uncertain }

/// <summary>One fiscal receipt the bridge has seen. Its state survives restarts so receipts are neither printed twice nor skipped.</summary>
public sealed class ReceiptRecord
{
    public long Id { get; init; }
    public int TenantId { get; init; }
    public int CashPointId { get; init; }
    public string ReceiptNumber { get; init; } = "";
    public string Type { get; init; } = "";
    public string OccurredAt { get; init; } = "";
    public decimal GrossAmount { get; init; }
    public bool Cash { get; init; }
    public ReceiptState State { get; set; }
    public string? Detail { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    /// <summary>At most one copy per receipt (kassasystemforskriften § 2-6).</summary>
    public CopyState? Copy { get; set; }
    [JsonIgnore] public DateTimeOffset Date => ReceiptRenderer.ParseInstant(OccurredAt) ?? DateTimeOffset.MinValue;
}

[JsonConverter(typeof(JsonStringEnumConverter<PrinterKind>))]
public enum PrinterKind { Network, Installed }

public sealed class PrinterSettings
{
    public PrinterKind Kind { get; set; } = PrinterKind.Network;
    public string Host { get; set; } = "";
    public int Port { get; set; } = 9100;
    public string Queue { get; set; } = "";
    /// <summary>80 mm rolls print 48 columns, 58 mm rolls 32 columns (Font A).</summary>
    public int PaperWidth { get; set; } = 80;
    [JsonIgnore] public int Columns => PaperWidth == 58 ? 32 : 48;
    [JsonIgnore] public bool Configured => Kind == PrinterKind.Network ? Uri.CheckHostName(Host.Trim('[', ']')) != UriHostNameType.Unknown && Port is >= 1 and <= 65535 : Queue.Length > 0;
    [JsonIgnore] public string Title => Kind == PrinterKind.Network ? $"{Host}:{Port}" : Queue;
}

public sealed class BridgeState
{
    public int Version { get; set; } = 1;
    public int? TenantId { get; set; }
    public bool AllCashPoints { get; set; }
    public List<int> CashPoints { get; set; } = [];
    /// <summary>Cash point ID to the latest receipt seen there, as a hint for choosing.</summary>
    public Dictionary<string, string> KnownCashPoints { get; set; } = [];
    /// <summary>Selection key to the server time it was chosen. Receipts before it are history and never printed.</summary>
    public Dictionary<string, DateTimeOffset> Baselines { get; set; } = [];
    /// <summary>Selection key to the next poll's inclusive start.</summary>
    public Dictionary<string, DateTimeOffset> Cursors { get; set; } = [];
    public List<ReceiptRecord> Receipts { get; set; } = [];
    public PrinterSettings Printer { get; set; } = new();
    public bool OpenDrawerForCash { get; set; } = true;
    public bool PrintQrCode { get; set; } = true;
    public bool Paused { get; set; }
}

/// <summary>Private JSON ledger in LocalApplicationData. Written atomically after every state change. No access key is stored here.</summary>
public sealed class Store(string directory)
{
    public string FilePath => Path.Combine(directory, "bridge.json");
    public BridgeState Load() => File.Exists(FilePath) ? JsonSerializer.Deserialize<BridgeState>(File.ReadAllBytes(FilePath), ReAIClient.Json) ?? throw new InvalidDataException() : new();
    public void Save(BridgeState state)
    {
        Directory.CreateDirectory(directory);
        var temporary = FilePath + ".tmp";
        using (var file = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            JsonSerializer.Serialize(file, state, ReAIClient.Json); file.Flush(true);
        }
        File.Move(temporary, FilePath, true);
    }
}

/// <summary>What is known about a print job after it was handed over.</summary>
public abstract record SendOutcome
{
    /// <summary>The printer or Windows spooler accepted every byte.</summary>
    public sealed record Sent : SendOutcome;
    /// <summary>Nothing reached the printer, so sending again cannot duplicate a receipt.</summary>
    public sealed record NotSent(string Reason) : SendOutcome;
    /// <summary>Some bytes may have reached the printer. Never retried automatically.</summary>
    public sealed record Uncertain(string Reason) : SendOutcome;
}

public interface IRawPrinting
{
    string[] Queues();
    Task<SendOutcome> SendToQueue(byte[] data, string queue);
}

public static class NetworkPrinter
{
    /// <summary>Raw TCP to port 9100 (JetDirect), as Epson TM and Star Ethernet printers accept ESC/POS.</summary>
    public static async Task<SendOutcome> Send(byte[] data, string host, int port)
    {
        using var client = new TcpClient();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        try { await client.ConnectAsync(host.Trim('[', ']'), port, timeout.Token); }
        catch (Exception e) when (e is SocketException or OperationCanceledException) { return new SendOutcome.NotSent($"The printer at {host}:{port} is not reachable ({e.Message})."); }
        try
        {
            var stream = client.GetStream();
            await stream.WriteAsync(data, timeout.Token);
            await stream.FlushAsync(timeout.Token);
            client.Client.Shutdown(SocketShutdown.Send);
            return new SendOutcome.Sent();
        }
        catch (Exception e) when (e is IOException or SocketException or OperationCanceledException)
        {
            return new SendOutcome.Uncertain($"The connection to {host} broke while sending ({e.Message}). Check the printer.");
        }
    }
}
