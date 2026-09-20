using System.Text.Json;
using System.Text.Json.Serialization;

namespace ReAI.Import.Core;

public enum ImportKind { Products, Customers, Suppliers }
public enum RowState { Ready, Invalid, Skipped, Sending, Created, Uncertain, Rejected }
public enum FieldType { Text, Decimal, Integer, Boolean }
public record Field(string Id, string Title, string[] Aliases, bool Required = false, FieldType Type = FieldType.Text);
public record Sheet(string Name, List<string[]> Rows);
public record Company(int Id, string CompanyName);
public record Account(string Email, Company[] Tenants);
public sealed class ImportRow
{
    public int Line { get; set; }
    public string Name { get; set; } = "";
    public Dictionary<string, string> Values { get; set; } = [];
    public string? Payload { get; set; }
    public RowState State { get; set; }
    public string Detail { get; set; } = "";
    public int? RemoteId { get; set; }
    [JsonIgnore] public string Status => State switch { RowState.Invalid => "Needs correction", RowState.Uncertain => "Check ReAI", _ => State.ToString() };
    [JsonIgnore] public string Label => $"Row {Line} · {Name}";
}
public sealed record ImportBatch(Guid Id, string Filename, ImportKind Kind, Company Company, string Email, List<ImportRow> Rows);
public sealed record ExistingSnapshot(HashSet<string> Keys, HashSet<int> Ids);
public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
}
