using System.Text.Json.Serialization;

namespace ReAI.DocumentScanner.Core;

public sealed record Company(int Id, string CompanyName, string Slug);
public sealed record Account(string Email, List<Company> Tenants);

[JsonConverter(typeof(JsonStringEnumConverter<Destination>))]
public enum Destination { Documents, Invoices, Income, Receipts }

public static class Destinations
{
    public static readonly Destination[] All = [Destination.Documents, Destination.Invoices, Destination.Income, Destination.Receipts];
    public static string Title(this Destination destination) => destination switch
    {
        Destination.Documents => "Documents",
        Destination.Invoices => "Supplier invoices",
        Destination.Income => "Income reception",
        _ => "Receipt reception"
    };
    public static string Endpoint(this Destination destination) => destination switch
    {
        Destination.Documents => "api/documents",
        Destination.Invoices => "api/invoice-reception-documents",
        Destination.Income => "api/income-reception-documents",
        _ => "api/receipt-reception-documents"
    };
    public static string Explanation(this Destination destination) => destination switch
    {
        Destination.Documents => "Save files to your company’s document center.",
        Destination.Invoices => "ReAI will analyze supplier invoices for review.",
        Destination.Income => "ReAI will analyze income documents for review in Income reception.",
        _ => "ReAI will analyze purchase receipts for review in Receipt reception."
    };
}

/// <summary>File types the ReAI upload endpoints accept, and image types the app converts to JPEG first.</summary>
public static class FileTypes
{
    public static readonly HashSet<string> Accepted = new(StringComparer.OrdinalIgnoreCase) { ".pdf", ".png", ".jpg", ".jpeg", ".avif", ".bmp", ".gif" };
    public static readonly HashSet<string> Converted = new(StringComparer.OrdinalIgnoreCase) { ".heic", ".heif", ".tif", ".tiff", ".webp" };
    public static bool Supported(string path) => Accepted.Contains(Path.GetExtension(path)) || Converted.Contains(Path.GetExtension(path));
    public const string UnsupportedMessage = "ReAI accepts PDF and images (PNG, JPEG, HEIC, TIFF, AVIF, BMP, GIF).";
    public static string Mime(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".pdf" => "application/pdf",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".avif" => "image/avif",
        ".bmp" => "image/bmp",
        ".gif" => "image/gif",
        _ => "application/octet-stream"
    };
}

public static class Status
{
    public const string Queued = "Queued", Uploading = "Uploading", Uploaded = "Uploaded", Duplicate = "Duplicate skipped";
    /// <summary>The outcome is unknown: ReAI may have received the file.</summary>
    public const string CheckReAI = "Check ReAI";
    /// <summary>ReAI answered that it did not accept the file.</summary>
    public const string Rejected = "Not uploaded";
}

public sealed class Transfer
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required Company Company { get; init; }
    public required Destination Destination { get; init; }
    public required string Filename { get; init; }
    public required string Fingerprint { get; init; }
    public required string File { get; init; }
    public DateTimeOffset Created { get; init; } = DateTimeOffset.Now;
    public string Status { get; set; } = Core.Status.Queued;
    public string Detail { get; set; } = "";
    public int? RemoteId { get; set; }
}

public sealed record FileStamp(long Size, DateTime Modified);

public sealed class WatchedFolder
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required Company Company { get; init; }
    public required Destination Destination { get; init; }
    public required string AccountEmail { get; init; }
    public required string Path { get; init; }
    public bool Enabled { get; set; } = true;
    public Dictionary<string, FileStamp> KnownFiles { get; set; } = [];
}

/// <summary>Everything the app remembers between runs. No access key is stored here.</summary>
public sealed class LocalState
{
    public List<Transfer> Transfers { get; set; } = [];
    public List<WatchedFolder> Folders { get; set; } = [];
    public Destination Destination { get; set; } = Destination.Documents;
    public Destination QuickDestination { get; set; } = Destination.Receipts;
}
