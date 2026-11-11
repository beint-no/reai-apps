using System.Globalization;
using System.Text;
using ReAI.Shipping;
using ReAI.Shipping.Core;

var output = args[0];
var printing = new Printing();
foreach (var printer in printing.Printers()) Console.WriteLine($"printer: {printer.Name} zebra={printer.IsZebra}");
foreach (var size in LabelSize.All)
    File.WriteAllBytes(Path.Combine(output, $"preview-{size.Width}.png"), Printing.Preview(new("reai:location:0b0e7a52-7f0c-4b7e-9f52-1a2b3c4d5e6f", "A-01-02-03", "Hovedlager Oslo\nPlukksone", size)));
File.WriteAllBytes(Path.Combine(output, "preview-long.png"), Printing.Preview(new("reai:location:0b0e7a52-7f0c-4b7e-9f52-1a2b3c4d5e6f", "Reol 14 hylle 3 venstre side", "Hovedlager Oslo", LabelSize.All[0])));
await Expect("too long name", () => { Printing.Preview(new("reai:location:0b0e7a52-7f0c-4b7e-9f52-1a2b3c4d5e6f", string.Join(" ", Enumerable.Repeat("Reol fjorten hylle tre venstre side", 8)), "x", LabelSize.All[0])); return Task.CompletedTask; });
await Expect("not a pdf", async () => await printing.Label("%PDF-nope"u8.ToArray(), "Label PDF", "t"));
await Expect("unsupported size", async () => await printing.Label(Pdf(300, 300, 1), "Label PDF", "t"));
await Expect("mixed sizes", async () => await printing.Label(Pdf(100, 150, 2, mixed: true), "Label PDF", "t"));
await Expect("missing printer", async () => await printing.Label(Pdf(100, 150, 1), "No such printer", "t"));
await Expect("A4 on zebra", async () => await printing.Label(Pdf(210, 297, 1), "ZDesigner Test", "t"));
Console.WriteLine("label: " + await (await printing.Label(Pdf(100, 150, 2), "Label PDF", "ReAI 1 · Shipping label"))());
Console.WriteLine("a4: " + await (await printing.Label(Pdf(210, 297, 1), "A4 PDF", "ReAI 2 · Shipping label"))());
Console.WriteLine("landscape: " + await (await printing.Label(Pdf(297, 210, 1), "Landscape PDF", "ReAI 3 · Shipping label"))());
Console.WriteLine("location: " + await printing.Location(new("reai:location:0b0e7a52-7f0c-4b7e-9f52-1a2b3c4d5e6f", "A-01-02-03", "Hovedlager Oslo\nPlukksone", LabelSize.All[2]), "Location PDF")());

static async Task Expect(string name, Func<Task> action)
{
    try { await action(); Console.WriteLine($"FAIL {name}: no error"); Environment.ExitCode = 1; }
    catch (Exception e) { Console.WriteLine($"ok {name}: {e.GetType().Name}: {e.Message}"); }
}

// A small vector PDF: border, bars and text, so scaling and sharpness are visible in the output.
static byte[] Pdf(double width, double height, int pages, bool mixed = false)
{
    string Points(double mm) => (mm * 72 / 25.4).ToString("0.##", CultureInfo.InvariantCulture);
    var objects = new List<string> { "<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" };
    var kids = new List<string>();
    for (int page = 0; page < pages; page++)
    {
        double w = mixed && page == 1 ? width + 20 : width;
        var content = new StringBuilder($"1 w {Points(2)} {Points(2)} {Points(w - 4)} {Points(height - 4)} re S\n");
        for (int bar = 0; bar < 40; bar++) content.Append($"{Points(10 + bar * 1.5)} {Points(height / 2)} {Points(bar % 3 == 0 ? 1 : 0.5)} {Points(25)} re f\n");
        content.Append($"BT /F1 14 Tf {Points(10)} {Points(height - 20)} Td (ReAI test {width} x {height} mm, page {page + 1}) Tj ET\n");
        objects.Add($"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {Points(w)} {Points(height)}] /Resources << /Font << /F1 3 0 R >> >> /Contents {objects.Count + 2} 0 R >>");
        kids.Add($"{objects.Count} 0 R");
        objects.Add($"<< /Length {content.Length} >>\nstream\n{content}endstream");
    }
    objects[1] = $"<< /Type /Pages /Kids [{string.Join(' ', kids)}] /Count {pages} >>";
    var pdf = new StringBuilder("%PDF-1.4\n");
    var offsets = new List<int>();
    for (int index = 0; index < objects.Count; index++) { offsets.Add(pdf.Length); pdf.Append($"{index + 1} 0 obj\n{objects[index]}\nendobj\n"); }
    int xref = pdf.Length;
    pdf.Append($"xref\n0 {objects.Count + 1}\n0000000000 65535 f \n");
    foreach (var offset in offsets) pdf.Append($"{offset:0000000000} 00000 n \n");
    pdf.Append($"trailer\n<< /Size {objects.Count + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n");
    return Encoding.ASCII.GetBytes(pdf.ToString());
}
