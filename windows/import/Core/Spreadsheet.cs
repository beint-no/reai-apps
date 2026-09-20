using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace ReAI.Import.Core;

public static class Spreadsheet
{
    public const int MaxRows = 10_000, MaxColumns = 100, MaxFileBytes = 10 * 1024 * 1024;
    public static List<Sheet> Read(string path)
    {
        if (new FileInfo(path).Length > MaxFileBytes) throw new InvalidDataException("Choose a file smaller than 10 MB.");
        using var input = File.OpenRead(path);
        var buffer = new byte[MaxFileBytes + 1];
        int length = input.ReadAtLeast(buffer, buffer.Length, throwOnEndOfStream: false);
        if (length > MaxFileBytes) throw new InvalidDataException("Choose a file smaller than 10 MB.");
        var data = buffer[..length];
        return Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".xlsx" => Excel(data),
            ".csv" or ".tsv" or ".txt" => [new(Path.GetFileName(path), Delimited(Decode(data), Path.GetExtension(path).Equals(".tsv", StringComparison.OrdinalIgnoreCase) ? '\t' : null))],
            _ => throw new InvalidDataException("Choose an Excel .xlsx, CSV or TSV file.")
        };
    }
    private static string Decode(byte[] data)
    {
        using var stream = new MemoryStream(data);
        using var reader = new StreamReader(stream, new UTF8Encoding(false, true), true);
        try { return reader.ReadToEnd(); }
        catch (DecoderFallbackException) { throw new InvalidDataException("Save this file as UTF-8 CSV or Excel .xlsx, then try again."); }
    }
    public static List<string[]> Delimited(string text, char? delimiter = null)
    {
        if (text.Contains('\0')) throw new InvalidDataException("This is not a supported text file. Save as UTF-8 CSV.");
        delimiter ??= new[] { ',', ';', '\t' }.MaxBy(c => CountDelimiter(text, c));
        var rows = new List<string[]>(); var row = new List<string>(); var cell = new StringBuilder();
        bool quoted = false, closed = false;
        void Cell() { row.Add(cell.ToString()); cell.Clear(); closed = false; if (row.Count > MaxColumns) throw new InvalidDataException("The file exceeds 100 columns."); }
        void Row() { Cell(); rows.Add(row.ToArray()); row.Clear(); if (rows.Count > MaxRows + 100) throw new InvalidDataException("The file exceeds 10,000 data rows."); }
        for (int i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (quoted)
            {
                if (c == '"') { if (i + 1 < text.Length && text[i + 1] == '"') { cell.Append('"'); i++; } else { quoted = false; closed = true; } }
                else cell.Append(c);
            }
            else if (c == delimiter) Cell();
            else if (c is '\r' or '\n') { Row(); if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++; }
            else if (closed) throw new InvalidDataException("Unexpected text after a quoted value. Check the file delimiter.");
            else if (c == '"') { if (cell.Length != 0) throw new InvalidDataException("A quote must start at the beginning of a field."); quoted = true; }
            else cell.Append(c);
            if (cell.Length > 32_767) throw new InvalidDataException("A cell exceeds 32,767 characters.");
        }
        if (quoted) throw new InvalidDataException("A quoted value is missing its closing quote.");
        if (cell.Length > 0 || row.Count > 0 || closed) Row();
        if (rows.Count == 0) throw new InvalidDataException("The file is empty.");
        return rows;
    }
    private static int CountDelimiter(string text, char delimiter)
    {
        bool quoted = false; int count = 0;
        foreach (var c in text) { if (c == '"') quoted = !quoted; if (!quoted && c is '\r' or '\n') break; if (!quoted && c == delimiter) count++; }
        return count;
    }
    private static List<Sheet> Excel(byte[] data)
    {
        using var stream = new MemoryStream(data);
        using var zip = new ZipArchive(stream, ZipArchiveMode.Read);
        if (zip.Entries.Count > 2000 || zip.Entries.Sum(e => e.Length) > 64 * 1024 * 1024) throw new InvalidDataException("The expanded workbook exceeds 64 MB.");
        if (zip.Entries.GroupBy(e => e.FullName).Any(g => g.Count() > 1)) throw new InvalidDataException("The workbook contains duplicate parts.");
        XDocument Xml(string path)
        {
            var entry = zip.GetEntry(path) ?? throw new InvalidDataException("The workbook is missing a required part.");
            using var input = entry.Open();
            using var reader = XmlReader.Create(input, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 64 * 1024 * 1024 });
            return XDocument.Load(reader);
        }
        var workbook = Xml("xl/workbook.xml");
        var relations = Xml("xl/_rels/workbook.xml.rels").Descendants().Where(e => e.Name.LocalName == "Relationship")
            .Where(e => (string?)e.Attribute("TargetMode") != "External").ToDictionary(e => (string)e.Attribute("Id")!, e => (string)e.Attribute("Target")!);
        var strings = zip.GetEntry("xl/sharedStrings.xml") is null ? [] : Xml("xl/sharedStrings.xml").Descendants().Where(e => e.Name.LocalName == "si").Select(Text).ToArray();
        var formats = new Dictionary<string, string>(); var styles = new List<string>();
        if (zip.GetEntry("xl/styles.xml") != null)
        {
            var styleXml = Xml("xl/styles.xml");
            foreach (var f in styleXml.Descendants().Where(e => e.Name.LocalName == "numFmt")) formats[(string)f.Attribute("numFmtId")!] = (string)f.Attribute("formatCode")!;
            styles = styleXml.Descendants().Where(e => e.Name.LocalName == "cellXfs").Elements().Select(e => formats.GetValueOrDefault((string?)e.Attribute("numFmtId") ?? "", "")).ToList();
        }
        var result = new List<Sheet>();
        foreach (var sheet in workbook.Descendants().Where(e => e.Name.LocalName == "sheet"))
        {
            if (result.Count == 30) throw new InvalidDataException("Choose a workbook with 30 worksheets or fewer.");
            var id = sheet.Attributes().FirstOrDefault(a => a.Name.LocalName == "id")?.Value;
            if (id == null || !relations.TryGetValue(id, out var target)) throw new InvalidDataException("Invalid worksheet relationship.");
            var uri = new Uri(new Uri("https://workbook.invalid/xl/workbook.xml"), target);
            if (uri.Host != "workbook.invalid") throw new InvalidDataException("External worksheets are unsupported.");
            var xml = Xml(uri.AbsolutePath.TrimStart('/'));
            if (xml.Descendants().Any(e => e.Name.LocalName is "f" or "mergeCell")) throw new InvalidDataException("Paste formulas as values and unmerge cells before importing.");
            var rows = new List<string[]>();
            foreach (var row in xml.Descendants().Where(e => e.Name.LocalName == "row"))
            {
                int number = int.Parse((string?)row.Attribute("r") ?? (rows.Count + 1).ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
                if (number <= rows.Count || number > MaxRows + 100) throw new InvalidDataException("Invalid worksheet row number or more than 10,000 data rows.");
                while (rows.Count < number - 1) rows.Add([]);
                var cells = new List<string>();
                foreach (var cell in row.Elements().Where(e => e.Name.LocalName == "c"))
                {
                    var reference = (string?)cell.Attribute("r") ?? throw new InvalidDataException("Missing cell reference.");
                    int column = 0;
                    foreach (var c in reference.TakeWhile(char.IsLetter)) { column = checked(column * 26 + c - 'A' + 1); if (column > MaxColumns) break; }
                    if (column <= cells.Count || column > MaxColumns) throw new InvalidDataException("Invalid cell order or more than 100 columns.");
                    while (cells.Count < column - 1) cells.Add("");
                    var type = (string?)cell.Attribute("t");
                    var value = cell.Elements().FirstOrDefault(e => e.Name.LocalName == "v")?.Value ?? "";
                    if (type == "s") { if (!int.TryParse(value, out var index) || index < 0 || index >= strings.Length) throw new InvalidDataException("Invalid shared string."); value = strings[index]; }
                    else if (type == "inlineStr") value = Text(cell);
                    else if (type == "e") throw new InvalidDataException("Fix spreadsheet error cells before importing.");
                    else if (type == "b") value = value == "1" ? "true" : "false";
                    else if (int.TryParse((string?)cell.Attribute("s"), out var style) && style >= 0 && style < styles.Count)
                    {
                        var format = styles[style];
                        if (format.Length is > 1 and <= 50 && format.All(c => c == '0') && value.All(char.IsAsciiDigit)) value = value.PadLeft(format.Length, '0');
                    }
                    if (value.Length > 32_767) throw new InvalidDataException("A cell exceeds 32,767 characters.");
                    cells.Add(value);
                }
                rows.Add(cells.ToArray());
            }
            result.Add(new((string?)sheet.Attribute("name") ?? "Sheet", rows));
        }
        if (result.Count == 0) throw new InvalidDataException("The workbook has no worksheets.");
        return result;
    }
    private static string Text(XElement element) => string.Concat(element.Descendants().Where(e => e.Name.LocalName == "t").Select(e => e.Value));
}
