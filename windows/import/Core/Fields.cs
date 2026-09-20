using System.Globalization;
using System.Text;

namespace ReAI.Import.Core;

public static class Fields
{
    private static readonly Field[] All =
    [
        new("title", "Product name", ["name", "title", "product", "produktnavn", "varenavn", "navn", "beskrivelse kort"], true, FieldType.Text),
        new("sku", "SKU / product number", ["sku", "product number", "product code", "item number", "varenummer", "artikkelnummer", "produktnummer", "vare nr", "art nr"], true, FieldType.Text),
        new("sellingPrice", "Selling price (excluding VAT)", ["price", "selling price", "unit price", "pris", "salgspris", "enhetspris", "pris eks mva"], true, FieldType.Decimal),
        new("costPrice", "Cost price", ["cost", "cost price", "kostpris", "innkjopspris"], false, FieldType.Decimal),
        new("description", "Description", ["description", "beskrivelse", "produktbeskrivelse"], false, FieldType.Text),
        new("brand", "Brand", ["brand", "merke", "merkevare"], false, FieldType.Text),
        new("barcode", "Barcode", ["barcode", "ean", "gtin", "strekkode"], false, FieldType.Text),
        new("stockItem", "Stock item", ["stock item", "stockitem", "lagervare"], false, FieldType.Boolean),
        new("vatCode", "ReAI VAT code", ["vat code", "vatcode", "mva kode", "mvakode"], false, FieldType.Text),
        new("revenueAccountCode", "Revenue account", ["revenue account", "revenueaccountcode", "inntektskonto", "salgskonto"], false, FieldType.Text),
        new("name", "Name", ["name", "company name", "customer name", "supplier name", "navn", "firmanavn", "kundenavn", "leverandornavn"], true, FieldType.Text),
        new("number", "Contact number", ["number", "customer number", "supplier number", "kundenummer", "leverandornummer", "kunde nr", "leverandor nr"], false, FieldType.Text),
        new("organizationNumber", "Organization number", ["organization number", "organisation number", "organizationnumber", "company number", "org nr", "orgnr", "organisasjonsnummer"], false, FieldType.Text),
        new("privateContact", "Private person", ["private contact", "privatecontact", "private person", "privatperson", "privatkunde"], false, FieldType.Boolean),
        new("email", "Email", ["email", "e mail", "epost", "e post", "email address"], false, FieldType.Text),
        new("phone", "Phone (+country code)", ["phone", "telephone", "mobile", "telefon", "mobil", "telefonnummer"], false, FieldType.Text),
        new("countryCode", "Country code", ["country code", "countrycode", "landkode", "country", "land"], false, FieldType.Text),
        new("addressPart1", "Address line 1", ["address", "address 1", "address line 1", "addresspart1", "street", "adresse", "adresse 1", "gateadresse"], false, FieldType.Text),
        new("addressPart2", "Address line 2", ["address 2", "address line 2", "addresspart2", "adresse 2"], false, FieldType.Text),
        new("postalCode", "Postal code", ["postal code", "postalcode", "zip", "zip code", "postnummer", "postnr"], false, FieldType.Text),
        new("city", "City", ["city", "town", "poststed", "by"], false, FieldType.Text),
        new("province", "Province / region", ["province", "region", "state", "fylke"], false, FieldType.Text),
        new("bankAccountNumber", "Bank account number", ["bank account", "bankaccountnumber", "bank account number", "kontonummer", "bankkonto"], false, FieldType.Text),
        new("iban", "IBAN", ["iban"], false, FieldType.Text),
        new("swiftCode", "SWIFT / BIC", ["swift", "swiftcode", "bic", "swift bic"], false, FieldType.Text),
        new("invoiceEmail", "Invoice email", ["invoice email", "invoiceemail", "faktura epost", "fakturaepost"], false, FieldType.Text),
        new("daysUntilDue", "Payment terms (days)", ["daysuntildue", "payment terms days", "payment days", "betalingsfrist", "kredittdager"], false, FieldType.Integer),
        new("invoiceInEnglish", "Invoices in English", ["invoiceinenglish", "invoice in english", "engelsk faktura"], false, FieldType.Boolean),
    ];
    public static Field[] For(ImportKind kind) => kind switch
    {
        ImportKind.Products => All[..10],
        ImportKind.Customers => All[10..],
        _ => All[10..25]
    };
    public static string Normalize(string value) => new(value.ToLowerInvariant().Replace("ø", "o").Replace("æ", "ae")
        .Normalize(NormalizationForm.FormD).Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark && char.IsLetterOrDigit(c)).ToArray());
    public static string[] Match(string[] headers, ImportKind kind) => headers.Select(header =>
    {
        var key = Normalize(header);
        if (key.Length is 0 or > 200) return "";
        var fields = For(kind);
        var exact = fields.Where(f => f.Aliases.Append(f.Id).Append(f.Title).Any(a => Normalize(a) == key)).ToArray();
        if (exact.Length == 1) return exact[0].Id;
        if (exact.Length > 1 || key.Length < 6) return "";
        var near = fields.Where(f => f.Aliases.Any(a => Normalize(a).Length >= 6 && OneEdit(key, Normalize(a)))).ToArray();
        return near.Length == 1 ? near[0].Id : "";
    }).ToArray();
    private static bool OneEdit(string a, string b)
    {
        if (Math.Abs(a.Length - b.Length) > 1) return false;
        int i = 0, j = 0, edits = 0;
        while (i < a.Length && j < b.Length)
        {
            if (a[i] == b[j]) { i++; j++; continue; }
            if (++edits > 1) return false;
            if (a.Length >= b.Length) i++;
            if (b.Length >= a.Length) j++;
        }
        return edits + (a.Length - i) + (b.Length - j) == 1;
    }
}
