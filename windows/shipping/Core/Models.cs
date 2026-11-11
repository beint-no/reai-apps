using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ReAI.Shipping.Core;

public sealed record Company(int Id, string CompanyName);
public sealed record Account(Company[] Tenants);
public sealed record Order(int OrderId, string OrderNumber, string? CustomerName, string Date, int? PreparedShipmentId = null);
public sealed record OrderPage(List<Order> Items, int Page, int TotalPages, int TotalItems);
public sealed record HistoricalOrder(int Id, string Number, string? CustomerName, string Date);
public sealed record HistoricalOrderPage(List<HistoricalOrder> Items);
public sealed record Quote(decimal CustomerPriceAmount, string CurrencyCode, string ProductCode, string Fingerprint)
{
    [JsonIgnore] public string Display => $"{CustomerPriceAmount:N2} {CurrencyCode}";
}
public sealed record Service(string CarrierCode, string DeliveryMethod, string CarrierName, string Name, bool TestMode);
public sealed record AvailableLine(int OrderLineId, string Name);
public sealed record ShipmentSummary(int Id, int OrderId, string Status);
public sealed record ShipmentPage(List<ShipmentSummary> Items, int? NextBeforeId);
public sealed record Options(string? UnavailableReason, bool WeightEstimated, List<Service> Services, List<AvailableLine> AvailableLines, Draft? Defaults, ShipmentPage ExistingShipments);
public sealed record Rate(string CarrierCode, string DeliveryMethod, string? Name, string Status, Quote? Quote, string? BookingBlockedReason, string? Error)
{
    public string Service => CarrierCode + ":" + DeliveryMethod;
    public string Id => Quote == null ? Service : Service + ":" + Quote.ProductCode;
}
public sealed record Pickup(string ProviderId, string DisplayName);
public sealed record QuoteResult(Quote? Quote, bool PickupRequired, List<Pickup> PickupPlaces, string? SelectedPickupProviderId, string? BookingBlockedReason, string? Error);
public sealed record Charge(decimal? Amount, string? CurrencyCode, bool RecordingPending);
public sealed record Shipment(int Id, int OrderId, string Status, bool CheckoutManaged, string CarrierCode, Recipient Recipient, Parcel Parcel, string? Error,
    bool LabelAvailable, List<string> Actions, bool CustomsInvoiceAvailable, bool InventoryRecordingPending, Charge CustomerCharge)
{
    public bool Pending => Status is "capture_pending" or "booking";
}
public sealed record Warehouse(int Id, string Name);
public sealed record Zone(int Id, string Name);
public sealed record Location(int Id, int WarehouseId, string Name, string? Description, int? ZoneId, string? ScanCode);

// The proposal is edited in the app, sent to ReAI and journalled exactly as accepted.
public sealed class Recipient
{
    public string? Name { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? CountryCode { get; set; }
    public string? City { get; set; }
    public string? PostalCode { get; set; }
    public string? AddressPart1 { get; set; }
    public string? AddressPart2 { get; set; }
    public string Summary(string separator) => string.Join(separator, new[] { Name, AddressPart1, PostalCode, City }.Where(part => part != null));
}
public sealed class Parcel
{
    public int WeightGrams { get; set; }
    public decimal LengthCm { get; set; }
    public decimal WidthCm { get; set; }
    public decimal HeightCm { get; set; }
}
public sealed class Line
{
    public int OrderLineId { get; set; }
    public decimal Quantity { get; set; }
}
public sealed class Draft
{
    public Guid RequestId { get; set; }
    public string? CarrierCode { get; set; }
    public string? DeliveryMethod { get; set; }
    public string? ProductCode { get; set; }
    public Recipient Recipient { get; set; } = new();
    public Parcel Parcel { get; set; } = new();
    public List<Line> Lines { get; set; } = [];
    public string? PickupProviderId { get; set; }
    public Quote? AcceptedQuote { get; set; }
}

public sealed class Operation
{
    public Guid Id { get; set; }
    public int TenantId { get; set; }
    public int OrderId { get; set; }
    public Draft? Draft { get; set; }
    public int? ShipmentId { get; set; }
    public string State { get; set; } = "saved";
}
public sealed class PrintRecord
{
    public int TenantId { get; set; }
    public int ShipmentId { get; set; }
    public string State { get; set; } = "";
    public string? Printer { get; set; }
    public string? Result { get; set; }
}
public sealed class LocationPrint
{
    public int TenantId { get; set; }
    public int LocationId { get; set; }
    public string State { get; set; } = "";
    public string Printer { get; set; } = "";
    public string? Result { get; set; }
}
public sealed class LocalState
{
    public string Printer { get; set; } = "";
    public string? Service { get; set; }
    public int LabelWidth { get; set; }
    public List<Operation> Operations { get; set; } = [];
    public List<PrintRecord> Prints { get; set; } = [];
    public List<LocationPrint> LocationPrints { get; set; } = [];
}

public sealed record Printer(string Name, bool IsZebra);
public sealed record LabelSize(int Width, int Height)
{
    public static readonly LabelSize[] All = [new(60, 40), new(80, 50), new(100, 50)];
    public override string ToString() => $"{Width} × {Height} mm";
}
public sealed record LocationLabel(string Code, string Name, string Details, LabelSize Size);

/// <summary>Windows printing. Each method validates first and returns the submission, so a receipt is journalled before anything reaches the queue.</summary>
public interface IPrinting
{
    Printer[] Printers();
    Task<Func<Task<string>>> Label(byte[] pdf, string printer, string title);
    Func<Task<string>> Location(LocationLabel label, string printer);
}

public static class Texts
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
    private static readonly Dictionary<string, string> Norwegian = Load();
    public static string T(string english) => Norwegian.GetValueOrDefault(english, english);
    public static string Status(string status) => T(status switch
    {
        "prepared" => "Prepared", "capture_pending" => "Waiting for payment", "booking" => "Booking", "booked" => "Booked",
        "failed" => "Failed", "cancelled" => "Cancelled", "outcome_unknown" => "Outcome unknown", _ => status
    });
    private static Dictionary<string, string> Load()
    {
        if (CultureInfo.CurrentUICulture.TwoLetterISOLanguageName is not ("nb" or "nn" or "no")) return [];
        using var stream = typeof(Texts).Assembly.GetManifestResourceStream("ReAI.Shipping.Core.nb.json")!;
        return JsonSerializer.Deserialize<Dictionary<string, string>>(stream)!;
    }
}
