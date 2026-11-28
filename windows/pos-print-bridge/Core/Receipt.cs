using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace ReAI.POSPrintBridge.Core;

public enum Align : byte { Left = 0, Center = 1, Right = 2 }

public enum TextSize : byte
{
    Normal = 0x00,
    Tall = 0x01,
    /// <summary>Double width and height: 100 % larger than amount text, as kassasystemforskriften § 2-8-6 requires for «KOPI».</summary>
    Large = 0x11
}

public abstract record ReceiptElement
{
    public sealed record Text(string Value, Align Align = Align.Left, bool Bold = false, TextSize Size = TextSize.Normal) : ReceiptElement;
    public sealed record Pair(string Left, string Right, bool Bold = false) : ReceiptElement;
    /// <summary>Table row; the first column is left-aligned, the others right-aligned.</summary>
    public sealed record Row(string[] Values, bool Bold = false) : ReceiptElement;
    public sealed record Rule : ReceiptElement;
    public sealed record Feed : ReceiptElement;
    public sealed record Qr(string Payload) : ReceiptElement;
}

public sealed record ReceiptContext(int TenantId, Merchant Merchant, string CompanyCurrency, IReadOnlyDictionary<string, decimal> VatRates, int Columns, bool Copy, bool PrintQrCode);

/// <summary>The receipt cannot be laid out from ReAI's data. Such receipts are never printed automatically.</summary>
public sealed class ReceiptException(string message) : Exception(message);

/// <summary>Lays out one receipt in the content and order of ReAI's fiscal receipt PDF. Nothing is recalculated.</summary>
public static partial class ReceiptRenderer
{
    public static readonly TimeZoneInfo Oslo = TimeZoneInfo.FindSystemTimeZoneById("Europe/Oslo");

    /// <summary>Statutory headings stay Norwegian (kassasystemforskriften § 2-8-4 and § 2-8-5). Other labels mirror ReAI's receipt PDF.</summary>
    public static string? Title(string type) => type switch
    {
        "sale" => "Salgskvittering", "return_receipt" => "Returkvittering", "correction" => "Korreksjonskvittering",
        "correction_reversal" => "Reversering av korreksjon", "invoice_payment" => "Fakturabetaling",
        "invoice_payment_reversal" => "Reversering av fakturabetaling", _ => null
    };

    public static decimal Sign(string type) => type is "return_receipt" or "correction" or "invoice_payment_reversal" ? -1 : 1;

    public static string PaymentMethod(string method) => method switch
    {
        "payment_link" => "Online payment", "card" => "Card", "vipps" => "Vipps", "cash" => "Cash", "gift_card" => "Gift card",
        "invoice_transfer" => "Invoice transfer", "manual_correction" => "Manual correction", _ => method
    };

    public static bool HasCash(Sale sale) => sale.Payments.Any(payment => payment.Method == "cash");

    public static List<ReceiptElement> Render(Sale sale, ReceiptContext context)
    {
        var title = Title(sale.Type) ?? throw new ReceiptException($"Receipt type {sale.Type} is not supported.");
        var date = ParseInstant(sale.OccurredAt) ?? throw new ReceiptException($"Receipt {sale.ReceiptNumber} has an unreadable date.");
        var merchant = context.Merchant;
        if (string.IsNullOrWhiteSpace(merchant.Name)) throw new ReceiptException("ReAI has no company name for this company.");
        var organization = merchant.OrganizationNumber?.Trim();
        if (string.IsNullOrEmpty(organization)) throw new ReceiptException("ReAI has no organization number for this company.");
        bool invoicePayment = sale.Type is "invoice_payment" or "invoice_payment_reversal";
        var rates = new Dictionary<string, string>();
        if (!invoicePayment)
            foreach (var code in sale.Lines.Select(line => line.VatCode).Distinct())
                rates[code] = context.VatRates.TryGetValue(code, out var rate) ? Plain(rate) + "%"
                    : throw new ReceiptException($"VAT code {code} on receipt {sale.ReceiptNumber} has no rate in ReAI's VAT code list.");
        var currency = sale.CurrencyCode ?? context.CompanyCurrency;
        var sign = Sign(sale.Type);
        string Signed(decimal amount) => Money(amount * sign);

        List<ReceiptElement> output = [];
        if (context.Copy) output.Add(new ReceiptElement.Text("KOPI", Align.Center, true, TextSize.Large));
        output.Add(new ReceiptElement.Text(title, Align.Center, true, TextSize.Tall));
        output.Add(new ReceiptElement.Feed());

        output.Add(new ReceiptElement.Text(merchant.Name, Align.Center, true));
        foreach (var line in merchant.Address.Where(line => line.Length > 0)) output.Add(new ReceiptElement.Text(line, Align.Center));
        output.Add(new ReceiptElement.Text($"Org. no. {organization}" + (merchant.VatRegistered ? " MVA" : ""), Align.Center));
        if (merchant.CompanyTypeCode?.ToUpperInvariant() is "AS" or "ASA" or "NUF") output.Add(new ReceiptElement.Text("Foretaksregisteret", Align.Center));
        output.Add(new ReceiptElement.Feed());

        output.Add(new ReceiptElement.Pair("Receipt", sale.ReceiptNumber));
        output.Add(new ReceiptElement.Pair("Date/time", TimeZoneInfo.ConvertTime(date, Oslo).ToString("dd.MM.yyyy HH:mm:ss", CultureInfo.InvariantCulture)));
        output.Add(new ReceiptElement.Feed());

        if (sale.Lines.Count == 0) output.Add(new ReceiptElement.Text("Control receipt without items or payment.", Align.Center));
        else
        {
            output.Add(new ReceiptElement.Pair("Item", "Amount", true));
            output.Add(new ReceiptElement.Rule());
            foreach (var line in sale.Lines)
            {
                output.Add(new ReceiptElement.Text(line.ProductText));
                output.Add(new ReceiptElement.Pair($"  Qty {Plain(line.Quantity)}, VAT {(invoicePayment ? "-" : rates[line.VatCode])}", Signed(line.GrossAmount + line.DiscountAmount)));
                if (line.DiscountAmount > 0) output.Add(new ReceiptElement.Pair("  Discount", Signed(-line.DiscountAmount)));
            }
            output.Add(new ReceiptElement.Rule());
        }
        if (sale.DiscountAmount > 0) output.Add(new ReceiptElement.Pair("Total discount", Signed(-sale.DiscountAmount), true));
        if (!invoicePayment)
        {
            output.Add(new ReceiptElement.Pair("Subtotal excl. VAT", Signed(sale.NetAmount), true));
            output.Add(new ReceiptElement.Pair("VAT", Signed(sale.VatAmount), true));
        }
        output.Add(new ReceiptElement.Pair($"TOTAL {currency}", Signed(sale.GrossAmount), true));
        output.Add(new ReceiptElement.Feed());

        if (sale.Payments.Count > 0)
        {
            bool returned = sale.Type == "return_receipt";
            foreach (var payment in sale.Payments)
            {
                output.Add(new ReceiptElement.Pair("Payment method", PaymentMethod(payment.Method)));
                output.Add(new ReceiptElement.Pair(returned ? "Refunded" : "Paid", $"{currency} " + (returned ? Money(payment.Amount) : Signed(payment.Amount))));
                if (!string.IsNullOrEmpty(payment.Reference)) output.Add(new ReceiptElement.Pair("Transaction ID", payment.Reference));
            }
            output.Add(new ReceiptElement.Feed());
        }

        if (sale.Lines.Count > 0 && !invoicePayment)
        {
            output.Add(new ReceiptElement.Row(["VAT", "Net amount", "VAT amount"], true));
            foreach (var group in sale.Lines.GroupBy(line => line.VatCode))
                output.Add(new ReceiptElement.Row([rates[group.Key], Signed(group.Sum(line => line.NetAmount)), Signed(group.Sum(line => line.VatAmount))]));
            output.Add(new ReceiptElement.Feed());
        }

        output.Add(new ReceiptElement.Pair("Cash point ID", sale.CashPointId.ToString(CultureInfo.InvariantCulture)));
        if (sale.GrossAmount == 0)
        {
            output.Add(new ReceiptElement.Feed());
            output.Add(new ReceiptElement.Text("Zero-amount receipt recorded in the electronic journal.", Align.Center));
        }
        if (context.PrintQrCode)
        {
            var osloDate = TimeZoneInfo.ConvertTime(date, Oslo).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            output.Add(new ReceiptElement.Feed());
            output.Add(new ReceiptElement.Qr($"reai:receipt:{context.TenantId}:{sale.CashPointId}:{osloDate}:{sale.ReceiptNumber}"));
            output.Add(new ReceiptElement.Text("Scan in ReAI Orders to find this receipt", Align.Center));
        }
        return output;
    }

    /// <summary>A printer check that is clearly not a receipt.</summary>
    public static List<ReceiptElement> TestPage(int columns, string printer) =>
    [
        new ReceiptElement.Text("PRINTER TEST", Align.Center, true, TextSize.Large), new ReceiptElement.Text("Not a receipt", Align.Center), new ReceiptElement.Feed(),
        new ReceiptElement.Text("ReAI POS Print Bridge", Align.Center, true), new ReceiptElement.Text(printer, Align.Center), new ReceiptElement.Feed(),
        new ReceiptElement.Text("Norwegian letters: Æ Ø Å æ ø å"), new ReceiptElement.Pair("Paper width", columns >= 48 ? "80 mm" : "58 mm"), new ReceiptElement.Rule(),
        new ReceiptElement.Text(string.Concat(Enumerable.Range(0, columns).Select(index => (char)('0' + index % 10)))), new ReceiptElement.Pair("Left", "Right", true)
    ];

    /// <summary>Two decimals, half away from zero, with comma grouping, as ReAI's receipt PDF.</summary>
    public static string Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero).ToString("#,##0.00", CultureInfo.InvariantCulture);

    /// <summary>Decimal without trailing zeros, for example 2, 1.5 or 11.11.</summary>
    public static string Plain(decimal value) => (value / 1.0000000000000000000000000000m).ToString(CultureInfo.InvariantCulture);

    public static DateTimeOffset? ParseInstant(string text) =>
        DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var value) && Instant().IsMatch(text) ? value : null;

    public static string Columns(string[] values, int width)
    {
        int first = Math.Max(6, width / 4), rest = (width - first) / (values.Length - 1);
        var line = new StringBuilder(values[0].PadRight(first));
        foreach (var value in values.Skip(1)) line.Append(' ', Math.Max(1, rest - value.Length)).Append(value);
        return line.Length > width ? line.ToString(0, width) : line.ToString();
    }

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")]
    private static partial Regex Instant();
}

/// <summary>
/// Encodes receipt elements as ESC/POS for Epson TM and Star printers in ESC/POS mode.
/// Text uses code page PC865 (Nordic, ESC t 5), which has Æ Ø Å æ ø å on every Epson TM model.
/// </summary>
public static class EscPos
{
    public static readonly byte[] Initialize = [0x1B, 0x40, 0x1B, 0x74, 0x05, 0x1B, 0x52, 0x00];
    /// <summary>ESC p 0: pulse drawer pin 2 for 50 ms, then wait 500 ms.</summary>
    public static readonly byte[] DrawerKick = [0x1B, 0x70, 0x00, 0x19, 0xFA];
    /// <summary>GS V B 3: feed to the cutter and partial cut.</summary>
    public static readonly byte[] Cut = [0x1D, 0x56, 0x42, 0x03];

    /// <summary>Characters 0x80-0xFF of code page 865.</summary>
    private const string Cp865 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø₧ƒáíóúñÑªº¿⌐¬½¼¡«¤░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
    private static readonly Dictionary<char, byte> Table = Cp865.Select((character, index) => (character, index)).ToDictionary(pair => pair.character, pair => (byte)(0x80 + pair.index));
    private static readonly Dictionary<char, string> Replacements = new()
    {
        ['€'] = "EUR", ['–'] = "-", ['—'] = "-", ['‘'] = "'", ['’'] = "'", ['“'] = "\"", ['”'] = "\"", ['…'] = "...", ['×'] = "x", [' '] = " ", ['\t'] = " "
    };

    public static byte[] Encode(IEnumerable<ReceiptElement> elements, int columns, bool openDrawer)
    {
        List<byte> output = [.. Initialize];
        foreach (var element in elements)
            switch (element)
            {
                case ReceiptElement.Text text:
                    int width = columns / (text.Size == TextSize.Large ? 2 : 1);
                    output.AddRange([0x1B, 0x61, (byte)text.Align, 0x1B, 0x45, (byte)(text.Bold ? 1 : 0), 0x1D, 0x21, (byte)text.Size]);
                    foreach (var line in Wrap(Sanitize(text.Value), width)) { output.AddRange(EncodeText(line)); output.Add(0x0A); }
                    output.AddRange([0x1D, 0x21, 0x00, 0x1B, 0x45, 0x00, 0x1B, 0x61, 0x00]);
                    break;
                case ReceiptElement.Pair pair:
                    output.AddRange([0x1B, 0x45, (byte)(pair.Bold ? 1 : 0)]);
                    foreach (var line in PairLines(Sanitize(pair.Left), Sanitize(pair.Right), columns)) { output.AddRange(EncodeText(line)); output.Add(0x0A); }
                    output.AddRange([0x1B, 0x45, 0x00]);
                    break;
                case ReceiptElement.Row row:
                    output.AddRange([0x1B, 0x45, (byte)(row.Bold ? 1 : 0)]);
                    output.AddRange(EncodeText(ReceiptRenderer.Columns([.. row.Values.Select(Sanitize)], columns)));
                    output.AddRange([0x0A, 0x1B, 0x45, 0x00]);
                    break;
                case ReceiptElement.Rule:
                    output.AddRange(EncodeText(new string('-', columns))); output.Add(0x0A);
                    break;
                case ReceiptElement.Feed:
                    output.Add(0x0A);
                    break;
                case ReceiptElement.Qr qr:
                    output.AddRange(QrCode(Encoding.UTF8.GetBytes(qr.Payload), (byte)(columns >= 48 ? 6 : 4)));
                    break;
            }
        output.AddRange([0x0A, 0x0A, .. Cut]);
        if (openDrawer) output.AddRange(DrawerKick);
        return [.. output];
    }

    public static byte[] DrawerOnly() => [.. Initialize, .. DrawerKick];

    /// <summary>GS ( k: QR model 2, error correction M, centred.</summary>
    public static byte[] QrCode(byte[] data, byte moduleSize)
    {
        int length = data.Length + 3;
        return [0x1B, 0x61, 0x01,
            0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,
            0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, moduleSize,
            0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31,
            0x1D, 0x28, 0x6B, (byte)(length & 0xFF), (byte)(length >> 8), 0x31, 0x50, 0x30, .. data,
            0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30, 0x0A, 0x1B, 0x61, 0x00];
    }

    /// <summary>Replaces characters the printer cannot show, so every remaining character takes one column.</summary>
    public static string Sanitize(string text)
    {
        var result = new StringBuilder();
        foreach (var rune in text.Normalize(NormalizationForm.FormC).EnumerateRunes())
        {
            if (rune.Value is >= 0x20 and < 0x7F) result.Append((char)rune.Value);
            else if (rune.Value is 0x0A or 0x0D) result.Append(' ');
            else if (rune.IsBmp && Table.ContainsKey((char)rune.Value)) result.Append((char)rune.Value);
            else if (rune.IsBmp && Replacements.TryGetValue((char)rune.Value, out var replacement)) result.Append(replacement);
            else
            {
                var folded = new string([.. rune.ToString().Normalize(NormalizationForm.FormD).Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)]);
                result.Append(folded.Length > 0 && folded.All(c => c is >= ' ' and < '\x7F' || Table.ContainsKey(c)) ? folded : "?");
            }
        }
        return result.ToString();
    }

    public static byte[] EncodeText(string text) => [.. text.Select(c => c < 0x7F ? (byte)c : Table.TryGetValue(c, out var value) ? value : (byte)'?')];

    public static List<string> Wrap(string text, int width)
    {
        List<string> lines = [];
        var current = "";
        foreach (var token in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var word = token;
            while (word.Length > width)
            {
                if (current.Length > 0) { lines.Add(current); current = ""; }
                lines.Add(word[..width]); word = word[width..];
            }
            if (current.Length == 0) current = word;
            else if (current.Length + 1 + word.Length <= width) current += " " + word;
            else { lines.Add(current); current = word; }
        }
        if (current.Length > 0 || lines.Count == 0) lines.Add(current);
        return lines;
    }

    /// <summary>Label left, value right. Long values continue right-aligned on the next lines.</summary>
    public static List<string> PairLines(string left, string right, int width)
    {
        if (left.Length + 1 + right.Length <= width) return [left + new string(' ', width - left.Length - right.Length) + right];
        var labels = Wrap(left, width);
        var values = Wrap(right, width);
        List<string> result = [.. labels];
        if (labels[^1].Length + 1 + values[0].Length <= width)
        {
            result[^1] = labels[^1] + new string(' ', width - labels[^1].Length - values[0].Length) + values[0];
            values.RemoveAt(0);
        }
        result.AddRange(values.Select(value => new string(' ', width - value.Length) + value));
        return result;
    }

    /// <summary>Plain-text rendering of the same layout, for previews and diagnostics.</summary>
    public static string Preview(IEnumerable<ReceiptElement> elements, int columns)
    {
        List<string> lines = [];
        foreach (var element in elements)
            switch (element)
            {
                case ReceiptElement.Text text:
                    foreach (var line in Wrap(Sanitize(text.Value), columns / (text.Size == TextSize.Large ? 2 : 1)))
                    {
                        var shown = text.Size == TextSize.Large ? string.Join(' ', line.ToCharArray()) : line;
                        int padding = Math.Max(0, columns - shown.Length);
                        lines.Add(text.Align switch { Align.Center => new string(' ', padding / 2) + shown, Align.Right => new string(' ', padding) + shown, _ => shown });
                    }
                    break;
                case ReceiptElement.Pair pair: lines.AddRange(PairLines(Sanitize(pair.Left), Sanitize(pair.Right), columns)); break;
                case ReceiptElement.Row row: lines.Add(ReceiptRenderer.Columns([.. row.Values.Select(Sanitize)], columns)); break;
                case ReceiptElement.Rule: lines.Add(new string('-', columns)); break;
                case ReceiptElement.Feed: lines.Add(""); break;
                case ReceiptElement.Qr: lines.Add(new string(' ', Math.Max(0, (columns - 9) / 2)) + "[QR code]"); break;
            }
        return string.Join('\n', lines);
    }
}
