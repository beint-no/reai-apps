using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Printing;
using System.Drawing.Text;
using Microsoft.Win32;
using QRCoder;
using ReAI.Shipping.Core;
using Windows.Data.Pdf;
using Windows.Storage.Streams;
using static ReAI.Shipping.Core.Texts;

namespace ReAI.Shipping;

/// <summary>Sends one copy straight to an installed Windows printer queue, without a print dialog.</summary>
internal sealed class Printing : IPrinting
{
    private const string Unavailable = "The selected printer is unavailable. Check Printers & scanners in Windows Settings.";

    public Printer[] Printers() => [.. PrinterSettings.InstalledPrinters.Cast<string>().Select(name =>
    {
        using var queue = Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Control\Print\Printers\{name}");
        var description = $"{name} {queue?.GetValue("Printer Driver")}";
        return new Printer(name, description.Contains("zebra", StringComparison.OrdinalIgnoreCase) || description.Contains("zdesigner", StringComparison.OrdinalIgnoreCase));
    })];

    /// <summary>Carrier labels keep the PDF's own page size. Full-page labels need an A4 / Letter printer and are never reduced onto label stock.</summary>
    public async Task<Func<Task<string>>> Label(byte[] pdf, string printer, string title)
    {
        PdfDocument document;
        try { document = await PdfDocument.LoadFromStreamAsync(new MemoryStream(pdf).AsRandomAccessStream()); }
        catch { throw new InvalidDataException(T("The shipping document PDF is invalid.")); }
        if (document.IsPasswordProtected || document.PageCount is < 1 or > 20) throw new InvalidDataException(T("The shipping document PDF is invalid."));
        var pages = Enumerable.Range(0, (int)document.PageCount).Select(index => document.GetPage((uint)index)).ToArray();
        var size = pages[0].Size;
        if (pages.Any(page => Math.Abs(page.Size.Width - size.Width) >= 1 || Math.Abs(page.Size.Height - size.Height) >= 1))
            throw new InvalidDataException(T("The PDF contains different page sizes. Print it manually from ReAI."));
        // PdfPage.Size is in 1/96 inch and already accounts for page rotation.
        var mm = new SizeF((float)(size.Width * 25.4 / 96), (float)(size.Height * 25.4 / 96));
        float shortSide = Math.Min(mm.Width, mm.Height), longSide = Math.Max(mm.Width, mm.Height);
        PaperKind? paper = Math.Abs(shortSide - 210) < 2 && Math.Abs(longSide - 297) < 2 ? PaperKind.A4
            : Math.Abs(shortSide - 215.9) < 2 && Math.Abs(longSide - 279.4) < 2 ? PaperKind.Letter
            : mm is { Width: >= 39.5f and <= 120.5f, Height: >= 39.5f and <= 220.5f } ? null
            : throw new InvalidDataException(T("This PDF has an unsupported page size. Print it manually from ReAI."));
        var queue = Printers().FirstOrDefault(candidate => candidate.Name == printer) ?? throw new InvalidOperationException(T(Unavailable));
        if (paper != null && queue.IsZebra) throw new InvalidOperationException(T("This full-page label needs an A4 / Letter printer. Choose one below or print it from ReAI."));
        return () => Spool(printer, title, mm, paper, pages.Length, (graphics, index) =>
        {
            // Fit the page inside the printable area and rasterize at the printer's own resolution so barcodes stay sharp.
            var area = graphics.VisibleClipBounds;
            float scale = Math.Min(area.Width / mm.Width, area.Height / mm.Height);
            var target = new RectangleF((area.Width - mm.Width * scale) / 2, (area.Height - mm.Height * scale) / 2, mm.Width * scale, mm.Height * scale);
            float dpi = Math.Min(graphics.DpiX, 600);
            using var png = new InMemoryRandomAccessStream();
            pages[index].RenderToStreamAsync(png, new() { DestinationWidth = (uint)Math.Round(target.Width / 25.4 * dpi), DestinationHeight = (uint)Math.Round(target.Height / 25.4 * dpi) }).GetAwaiter().GetResult();
            using var image = Image.FromStream(png.AsStream());
            graphics.InterpolationMode = InterpolationMode.NearestNeighbor; graphics.PixelOffsetMode = PixelOffsetMode.Half;
            graphics.DrawImage(image, target);
        });
    }

    /// <summary>Location labels print at actual size on the chosen roll; they are never scaled to another paper size.</summary>
    public Func<Task<string>> Location(LocationLabel label, string printer)
    {
        Preview(label);
        if (Printers().All(candidate => candidate.Name != printer)) throw new InvalidOperationException(T(Unavailable));
        return () => Spool(printer, "ReAI · " + label.Name, new(label.Size.Width, label.Size.Height), null, 1, (graphics, _) => Draw(graphics, label));
    }

    /// <summary>The same drawing code as the print, as a PNG. Throws when the text cannot fit the label.</summary>
    public static byte[] Preview(LocationLabel label)
    {
        using var bitmap = new Bitmap(label.Size.Width * 8, label.Size.Height * 8);
        bitmap.SetResolution(203.2f, 203.2f);
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.PageUnit = GraphicsUnit.Millimeter; graphics.TextRenderingHint = TextRenderingHint.AntiAlias; graphics.Clear(Color.White);
            Draw(graphics, label);
        }
        using var png = new MemoryStream();
        bitmap.Save(png, ImageFormat.Png);
        return png.ToArray();
    }

    private static void Draw(Graphics graphics, LocationLabel label)
    {
        float width = label.Size.Width, height = label.Size.Height, side = Math.Min(34, height - 6);
        using var code = QRCodeGenerator.GenerateQrCode(label.Code, QRCodeGenerator.ECCLevel.M);
        // The matrix includes the four-module quiet zone on every side.
        var modules = code.ModuleMatrix;
        float module = side / modules.Count, top = (height - side) / 2;
        graphics.SmoothingMode = SmoothingMode.None; graphics.PixelOffsetMode = PixelOffsetMode.Half;
        for (int row = 0; row < modules.Count; row++)
            for (int column = 0; column < modules.Count; column++)
                if (modules[row][column]) graphics.FillRectangle(Brushes.Black, 2 + column * module, top + row * module, module, module);
        float left = side + 4, room = width - left - 2;
        Fit(graphics, label.Name, new(left, height * 0.08f, room, height * 0.49f), 14, FontStyle.Bold);
        Fit(graphics, label.Details, new(left, height - 2 - height * 0.37f, room, height * 0.37f), 8, FontStyle.Regular);
    }

    private static void Fit(Graphics graphics, string text, RectangleF box, float largest, FontStyle style)
    {
        for (float points = largest; points >= 5; points -= 0.5f)
        {
            using var font = new Font("Segoe UI", points, style, GraphicsUnit.Point);
            // Shrink rather than break a word across lines or cut text off.
            if (text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Any(word => graphics.MeasureString(word, font).Width > box.Width)
                || graphics.MeasureString(text, font, new SizeF(box.Width, 1000)).Height > box.Height) continue;
            graphics.DrawString(text, font, Brushes.Black, box);
            return;
        }
        throw new InvalidOperationException(T("The location name is too long for this label. Choose a larger label size."));
    }

    private static Task<string> Spool(string printer, string title, SizeF mm, PaperKind? paper, int pages, Action<Graphics, int> draw) => Task.Run(() =>
    {
        using var document = new PrintDocument { DocumentName = title, PrintController = new StandardPrintController() };
        var settings = document.PrinterSettings;
        settings.PrinterName = printer;
        if (!settings.IsValid) throw new InvalidOperationException(T(Unavailable));
        settings.Copies = 1; settings.Duplex = Duplex.Simplex;
        document.DefaultPageSettings.PaperSize = paper is { } kind
            ? settings.PaperSizes.Cast<PaperSize>().FirstOrDefault(size => size.Kind == kind) ?? throw new InvalidOperationException(T("This full-page label needs an A4 / Letter printer. Choose one below or print it from ReAI."))
            : new PaperSize("ReAI", (int)Math.Round(mm.Width / 0.254), (int)Math.Round(mm.Height / 0.254));
        document.DefaultPageSettings.Landscape = paper != null && mm.Width > mm.Height;
        int index = 0;
        Exception? failure = null;
        document.PrintPage += (_, page) =>
        {
            try
            {
                var graphics = page.Graphics!;
                graphics.PageUnit = GraphicsUnit.Millimeter;
                // Drawing starts at the printable area; label printers have no unprintable margin.
                draw(graphics, index++);
                page.HasMorePages = index < pages;
            }
            catch (Exception e) { failure = e; page.Cancel = true; }
        };
        try { document.Print(); }
        catch (Exception e) when (failure == null) { throw new InvalidOperationException(T("Windows could not send the document to the printer. Check the printer queue before trying again."), e); }
        if (failure != null) throw failure;
        return $"{printer} · {DateTime.Now:g}";
    });
}
