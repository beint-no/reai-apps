using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ReAI.Import.Core;

public static class Validation
{
    public static List<ImportRow> Prepare(Sheet sheet, int header, string[] mapping, ImportKind kind, bool comma, bool people, HashSet<string> existing)
    {
        var assigned = mapping.Where(m => m.Length > 0).ToArray();
        if (assigned.Distinct().Count() != assigned.Length) throw new InvalidOperationException("Map each ReAI field to only one source column.");
        var fields = Fields.For(kind);
        var missing = fields.Where(f => f.Required && !assigned.Contains(f.Id)).Select(f => f.Title).ToArray();
        if (missing.Length > 0) throw new InvalidOperationException("Map these required fields: " + string.Join(", ", missing));
        if (header < 0 || header >= sheet.Rows.Count - 1) throw new InvalidOperationException("Choose a header row with data below it.");
        if (sheet.Rows.Count - header - 1 > Spreadsheet.MaxRows) throw new InvalidOperationException("Import at most 10,000 data rows at a time.");
        var seen = new HashSet<string>(existing); var result = new List<ImportRow>();
        for (int index = header + 1; index < sheet.Rows.Count; index++)
        {
            var cells = sheet.Rows[index];
            if (cells.All(string.IsNullOrWhiteSpace)) continue;
            var values = mapping.Select((f, i) => (f, v: i < cells.Length ? cells[i].Trim() : "")).Where(p => p.f != "").ToDictionary(p => p.f, p => p.v);
            var errors = new List<string>(); var payload = new Dictionary<string, object>();
            if (cells.Skip(mapping.Length).Any(c => !string.IsNullOrWhiteSpace(c))) errors.Add("More values than header columns. Check the delimiter or header row.");
            foreach (var f in fields)
            {
                var value = values.GetValueOrDefault(f.Id, "");
                if (value == "") { if (f.Required) errors.Add(f.Title + " is required."); continue; }
                switch (f.Type)
                {
                    case FieldType.Text: payload[f.Id] = value; break;
                    case FieldType.Decimal:
                        if (Number(value, comma) is decimal number && number >= 0) payload[f.Id] = number;
                        else errors.Add(f.Title + $": use a non-negative number with a {(comma ? "comma" : "dot")} decimal separator.");
                        break;
                    case FieldType.Integer:
                        if (int.TryParse(value, out var integer) && integer is >= 0 and <= 3000) payload[f.Id] = integer;
                        else errors.Add(f.Title + ": use a whole number from 0 to 3000.");
                        break;
                    case FieldType.Boolean:
                        if (Boolean(value) is bool flag) payload[f.Id] = flag;
                        else errors.Add(f.Title + ": use yes/no, true/false, ja/nei or 1/0.");
                        break;
                }
            }
            string Get(string key) => values.GetValueOrDefault(key, "");
            var name = Get(kind == ImportKind.Products ? "title" : "name");
            if (kind == ImportKind.Products)
            {
                if (Get("brand").Length > 255) errors.Add("Brand exceeds 255 characters.");
                if (Get("revenueAccountCode") is { Length: > 0 } account && !Regex.IsMatch(account, "^3[0-9]{3}$")) errors.Add("Revenue account must be a four-digit 3xxx account.");
                if (Get("vatCode") is { Length: > 0 } vat && !Regex.IsMatch(vat, "^[0-9]+$")) errors.Add("Use a ReAI VAT code, not a percentage.");
                payload.TryAdd("stockItem", true);
                var variant = new Dictionary<string, object>();
                foreach (var key in new[] { "sku", "sellingPrice", "costPrice", "barcode" }) if (payload.Remove(key, out var value)) variant[key] = value;
                payload["variants"] = new[] { variant };
            }
            else
            {
                var country = Get("countryCode") is { Length: > 0 } c ? c.ToUpperInvariant() : "NO";
                values["countryCode"] = country; payload["countryCode"] = country;
                var person = payload.GetValueOrDefault("privateContact") as bool? ?? people;
                payload["privateContact"] = person; payload["skipRegistryLookup"] = true;
                if (name.Length > 75) errors.Add("Name exceeds 75 characters.");
                if (Get("number").Length > 50) errors.Add("Contact number exceeds 50 characters.");
                if (!Regex.IsMatch(country, "^[A-Z]{2}$")) errors.Add("Use a two-letter country code, such as NO.");
                var org = Get("organizationNumber").Replace(" ", "");
                if (!person && country == "NO" && !OrganizationNumber(org)) errors.Add("Norwegian companies need a valid organization number. For people, choose the private-person default.");
                if (org.Length > 0) payload["organizationNumber"] = org;
                if (org.Length > 36 || person && org.Length > 0) errors.Add("Check the organization number. Private people must not have one.");
                foreach (var key in new[] { "email", "invoiceEmail" }) if (Get(key) is { Length: > 0 } email && !Regex.IsMatch(email, @"^[^\s@]+@[^\s@]+\.[^\s@]+$")) errors.Add(key + ": enter a valid email address.");
                if (Get("phone") is { Length: > 0 } phone)
                {
                    phone = new(phone.Where(c => !" ()-".Contains(c)).ToArray());
                    if (!Regex.IsMatch(phone, @"^\+[1-9][0-9]{6,14}$")) errors.Add("Phone needs +country code, for example +4799999999.");
                    else payload["phone"] = phone;
                }
                if (new[] { "addressPart1", "addressPart2", "city", "postalCode", "province" }.Any(k => Get(k) != "") && (Get("addressPart1") == "" || Get("city") == "")) errors.Add("An address requires address line 1 and city.");
            }
            var keys = Keys(values, kind); bool duplicate = keys.Overlaps(seen);
            if (errors.Count == 0) seen.UnionWith(keys);
            result.Add(new ImportRow { Line = index + 1, Name = name, Values = values, Payload = errors.Count == 0 ? JsonSerializer.Serialize(payload) : null,
                State = errors.Count > 0 ? RowState.Invalid : duplicate ? RowState.Skipped : RowState.Ready,
                Detail = errors.Count > 0 ? string.Join(" ", errors) : duplicate ? "Matches an existing record or an earlier row." : "Will create a new record." });
        }
        if (result.Count == 0) throw new InvalidOperationException("There are no data rows to import.");
        return result;
    }
    public static HashSet<string> Keys(Dictionary<string, string> values, ImportKind kind) => (kind == ImportKind.Products ? new[] { "sku" } : ["number", "name", "email"])
        .Where(k => !string.IsNullOrWhiteSpace(values.GetValueOrDefault(k))).Select(k => k + ":" + values[k].Trim().ToLowerInvariant()).ToHashSet();
    public static bool? Boolean(string value) => value.ToLowerInvariant() switch { "yes" or "true" or "ja" or "1" => true, "no" or "false" or "nei" or "0" => false, _ => null };
    public static decimal? Number(string value, bool comma)
    {
        value = value.Replace('\u00a0', ' ').Replace('\u202f', ' ');
        var separator = comma ? "," : @"\."; var grouping = comma ? @"\." : ",";
        if (!Regex.IsMatch(value, @"^[+-]?(?:[0-9]+|[0-9]{1,3}(?:" + grouping + @"[0-9]{3})+|[0-9]{1,3}(?: [0-9]{3})+)(?:" + separator + @"[0-9]{1,8})?$")) return null;
        value = value.Replace(" ", "").Replace(comma ? "." : ",", "").Replace(',', '.');
        return decimal.TryParse(value, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var result) ? result : null;
    }
    public static bool OrganizationNumber(string value)
    {
        if (value.Length != 9 || !value.All(char.IsAsciiDigit) || value.All(c => c == '0')) return false;
        int sum = value.Take(8).Select((c, i) => (c - '0') * new[] { 3, 2, 7, 6, 5, 4, 3, 2 }[i]).Sum();
        int check = (11 - sum % 11) % 11;
        return check < 10 && check == value[8] - '0';
    }
}
