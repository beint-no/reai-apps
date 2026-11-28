namespace ReAI.POSPrintBridge.Core;

public sealed record Company(int Id, string CompanyName, string CurrencyCode);
public sealed record Account(Company[] Tenants);

/// <summary>One fiscal receipt exactly as GET /api/kassasystem/sales returns it. Amounts are positive snapshots; the type decides the printed sign.</summary>
public sealed record Sale(long Id, int CashPointId, long SequenceNumber, string ReceiptNumber, string Type, string OccurredAt, string? CurrencyCode,
    decimal NetAmount, decimal VatAmount, decimal GrossAmount, decimal DiscountAmount, List<SaleLine> Lines, List<SalePayment> Payments);
public sealed record SaleLine(int RowNumber, string ProductText, string VatCode, decimal Quantity, decimal NetAmount, decimal VatAmount, decimal GrossAmount, decimal DiscountAmount);
public sealed record SalePayment(string Method, decimal Amount, string? Reference);
public sealed record SalesPage(List<Sale> Items, bool HasNext);

/// <summary>Seller details from GET /api/company-settings.</summary>
public sealed record Merchant(string Name, string? OrganizationNumber, bool VatRegistered, string? CompanyTypeCode, string[] Address);

/// <summary>A response body together with the server's clock, so receipt windows never depend on this PC's time.</summary>
public sealed record Timed<T>(T Value, DateTimeOffset ServerDate);
