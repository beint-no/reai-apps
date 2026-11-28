using System.Runtime.InteropServices;
using Windows.ApplicationModel.DataTransfer;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace ReAI.DocumentScanner;

internal static class Imaging
{
    /// <summary>Re-encodes an image (TIFF, HEIC, WebP, PNG or BMP) as JPEG with the Windows imaging codecs.</summary>
    public static async Task ToJpeg(string source, string target)
    {
        await using var input = File.OpenRead(source);
        var decoder = await BitmapDecoder.CreateAsync(input.AsRandomAccessStream());
        var pixels = await decoder.GetPixelDataAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore, new BitmapTransform(),
            ExifOrientationMode.RespectExifOrientation, ColorManagementMode.ColorManageToSRgb);
        await using var output = File.Create(target);
        var properties = new BitmapPropertySet { ["ImageQuality"] = new BitmapTypedValue(0.85f, Windows.Foundation.PropertyType.Single) };
        var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.JpegEncoderId, output.AsRandomAccessStream(), properties);
        encoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore, decoder.OrientedPixelWidth, decoder.OrientedPixelHeight, decoder.DpiX, decoder.DpiY, pixels.DetachPixelData());
        await encoder.FlushAsync();
    }

    /// <summary>Saves the bitmap on the clipboard as a PNG. Returns false when the clipboard holds no image.</summary>
    public static async Task<bool> SaveClipboardImage(string target)
    {
        DataPackageView content;
        for (int attempt = 0; ; attempt++)
            try { content = Clipboard.GetContent(); break; }
            // Another program may hold the clipboard open for a moment.
            catch (COMException) when (attempt < 5) { await Task.Delay(200); }
        if (!content.Contains(StandardDataFormats.Bitmap)) return false;
        var reference = await content.GetBitmapAsync();
        using IRandomAccessStreamWithContentType stream = await reference.OpenReadAsync();
        var decoder = await BitmapDecoder.CreateAsync(stream);
        using var bitmap = await decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied);
        await using var output = File.Create(target);
        var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, output.AsRandomAccessStream());
        encoder.SetSoftwareBitmap(bitmap);
        await encoder.FlushAsync();
        return true;
    }
}
