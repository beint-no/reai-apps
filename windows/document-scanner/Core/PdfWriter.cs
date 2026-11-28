using System.Globalization;
using System.Text;

namespace ReAI.DocumentScanner.Core;

/// <summary>Writes scanned JPEG pages into one PDF, one image per page at its scanned size. No re-encoding.</summary>
public static class PdfWriter
{
    public sealed record JpegInfo(int Width, int Height, int Components, double DpiX, double DpiY);

    public static JpegInfo Inspect(ReadOnlySpan<byte> jpeg)
    {
        if (jpeg.Length < 4 || jpeg[0] != 0xFF || jpeg[1] != 0xD8) throw new InvalidDataException("The scanned page is not a JPEG image.");
        double dpiX = 0, dpiY = 0;
        for (int i = 2; i + 4 <= jpeg.Length;)
        {
            if (jpeg[i] != 0xFF) { i++; continue; }
            byte marker = jpeg[i + 1];
            if (marker is 0xFF) { i++; continue; }
            if (marker is 0xD8 or 0x01 or (>= 0xD0 and <= 0xD7)) { i += 2; continue; }
            int length = jpeg[i + 2] << 8 | jpeg[i + 3];
            if (length < 2 || i + 2 + length > jpeg.Length) break;
            var segment = jpeg.Slice(i + 4, length - 2);
            if (marker == 0xE0 && segment.Length >= 12 && segment[..5].SequenceEqual("JFIF\0"u8))
            {
                int units = segment[7], x = segment[8] << 8 | segment[9], y = segment[10] << 8 | segment[11];
                double factor = units switch { 1 => 1, 2 => 2.54, _ => 0 };
                dpiX = x * factor; dpiY = y * factor;
            }
            if (marker is >= 0xC0 and <= 0xCF and not 0xC4 and not 0xC8 and not 0xCC && segment.Length >= 6)
                return new(segment[3] << 8 | segment[4], segment[1] << 8 | segment[2], segment[5], dpiX, dpiY);
            i += 2 + length;
        }
        throw new InvalidDataException("The scanned page is not a readable JPEG image.");
    }

    public static byte[] FromJpegs(IReadOnlyList<byte[]> pages, double fallbackDpi = 300)
    {
        if (pages.Count == 0) throw new InvalidDataException("There are no pages to save.");
        using var output = new MemoryStream();
        var offsets = new List<long>();
        void Write(string text) { var bytes = Encoding.Latin1.GetBytes(text); output.Write(bytes); }
        void Begin(int number) { while (offsets.Count < number) offsets.Add(0); offsets[number - 1] = output.Position; Write($"{number} 0 obj\n"); }
        static string F(double value) => value.ToString("0.###", CultureInfo.InvariantCulture);

        Write("%PDF-1.4\n%âãÏÓ\n");
        int count = pages.Count;
        // Objects: 1 catalog, 2 page tree, then page, image and content stream per page.
        var kids = string.Join(" ", Enumerable.Range(0, count).Select(index => $"{3 + index * 3} 0 R"));
        Begin(1); Write("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        Begin(2); Write($"<< /Type /Pages /Kids [{kids}] /Count {count} >>\nendobj\n");
        for (int index = 0; index < count; index++)
        {
            var jpeg = pages[index];
            var info = Inspect(jpeg);
            double dpiX = info.DpiX >= 50 ? info.DpiX : fallbackDpi, dpiY = info.DpiY >= 50 ? info.DpiY : fallbackDpi;
            double width = info.Width * 72 / dpiX, height = info.Height * 72 / dpiY;
            int page = 3 + index * 3, image = page + 1, content = page + 2;
            var space = info.Components switch { 1 => "/DeviceGray", 4 => "/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]", _ => "/DeviceRGB" };
            Begin(page); Write($"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {F(width)} {F(height)}] /Resources << /XObject << /Im0 {image} 0 R >> >> /Contents {content} 0 R >>\nendobj\n");
            Begin(image); Write($"<< /Type /XObject /Subtype /Image /Width {info.Width} /Height {info.Height} /ColorSpace {space} /BitsPerComponent 8 /Filter /DCTDecode /Length {jpeg.Length} >>\nstream\n");
            output.Write(jpeg); Write("\nendstream\nendobj\n");
            var draw = $"q {F(width)} 0 0 {F(height)} 0 0 cm /Im0 Do Q";
            Begin(content); Write($"<< /Length {draw.Length} >>\nstream\n{draw}\nendstream\nendobj\n");
        }
        long xref = output.Position;
        Write($"xref\n0 {offsets.Count + 1}\n0000000000 65535 f \n");
        foreach (var offset in offsets) Write($"{offset:D10} 00000 n \n");
        Write($"trailer\n<< /Size {offsets.Count + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n");
        return output.ToArray();
    }
}
