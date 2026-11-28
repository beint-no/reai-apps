using ReAI.DocumentScanner.Core;
using Windows.Devices.Enumeration;
using Windows.Devices.Scanners;
using Windows.Storage;

namespace ReAI.DocumentScanner;

/// <summary>Scans with Windows.Devices.Scanners (no direct WIA or TWAIN). Pages are saved as JPEG and combined into one PDF.</summary>
internal sealed class Scanning
{
    public sealed record Device(string Id, string Name);
    public enum Source { Flatbed, Feeder, Automatic }

    public static async Task<List<Device>> Devices() =>
        [.. (await DeviceInformation.FindAllAsync(ImageScanner.GetDeviceSelector())).Select(device => new Device(device.Id, device.Name))];

    public static async Task<List<Source>> Sources(string id)
    {
        var scanner = await ImageScanner.FromIdAsync(id);
        List<Source> sources = [];
        if (scanner.IsScanSourceSupported(ImageScannerScanSource.Flatbed)) sources.Add(Source.Flatbed);
        if (scanner.IsScanSourceSupported(ImageScannerScanSource.Feeder)) sources.Add(Source.Feeder);
        if (sources.Count == 0 && scanner.IsScanSourceSupported(ImageScannerScanSource.AutoConfigured)) sources.Add(Source.Automatic);
        return sources;
    }

    /// <summary>Scans one flatbed page, or every page in the feeder, into <paramref name="folder"/> and returns JPEG files in order.</summary>
    public static async Task<List<string>> Scan(string id, Source source, int dpi, string folder)
    {
        var scanner = await ImageScanner.FromIdAsync(id);
        var kind = source switch { Source.Flatbed => ImageScannerScanSource.Flatbed, Source.Feeder => ImageScannerScanSource.Feeder, _ => ImageScannerScanSource.AutoConfigured };
        IImageScannerFormatConfiguration format = source switch { Source.Flatbed => scanner.FlatbedConfiguration, Source.Feeder => scanner.FeederConfiguration, _ => scanner.AutoConfiguration };
        foreach (var candidate in new[] { ImageScannerFormat.Jpeg, ImageScannerFormat.Png, ImageScannerFormat.DeviceIndependentBitmap })
            if (format.IsFormatSupported(candidate)) { format.Format = candidate; break; }
        if (format is IImageScannerSourceConfiguration configuration)
        {
            configuration.DesiredResolution = new ImageScannerResolution { DpiX = dpi, DpiY = dpi };
            if (configuration.IsColorModeSupported(ImageScannerColorMode.Color)) configuration.ColorMode = ImageScannerColorMode.Color;
        }
        if (source == Source.Feeder) { scanner.FeederConfiguration.MaxNumberOfPages = 0; scanner.FeederConfiguration.Duplex = false; }
        Directory.CreateDirectory(folder);
        var result = await scanner.ScanFilesToFolderAsync(kind, await StorageFolder.GetFolderFromPathAsync(folder));
        List<string> pages = [];
        foreach (var file in result.ScannedFiles)
        {
            var path = file.Path;
            if (!Path.GetExtension(path).Equals(".jpg", StringComparison.OrdinalIgnoreCase) && !Path.GetExtension(path).Equals(".jpeg", StringComparison.OrdinalIgnoreCase))
            {
                var jpeg = Path.Combine(folder, Guid.NewGuid().ToString("N") + ".jpg");
                await Imaging.ToJpeg(path, jpeg);
                File.Delete(path);
                path = jpeg;
            }
            pages.Add(path);
        }
        return pages;
    }

    /// <summary>Combines scanned pages into one PDF at most 20 MB.</summary>
    public static byte[] Combine(IEnumerable<string> pages, int dpi)
    {
        var pdf = PdfWriter.FromJpegs(pages.Select(File.ReadAllBytes).ToList(), dpi);
        return pdf.Length <= Stager.MaximumSize ? pdf : throw new InvalidDataException("The combined PDF is larger than 20 MB. Scan fewer pages or use 150 dpi.");
    }
}
