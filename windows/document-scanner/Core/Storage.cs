using System.Security.Cryptography;
using System.Text.Json;

namespace ReAI.DocumentScanner.Core;

/// <summary>The private state file. An upload that was in progress when the app stopped becomes "Check ReAI".</summary>
public sealed class Store(string directory)
{
    private string FilePath => Path.Combine(directory, "state.json");
    public LocalState Load()
    {
        if (!File.Exists(FilePath)) return new();
        var state = JsonSerializer.Deserialize<LocalState>(File.ReadAllBytes(FilePath), ReAIClient.Json) ?? throw new InvalidDataException();
        foreach (var transfer in state.Transfers.Where(transfer => transfer.Status == Status.Uploading))
        {
            transfer.Status = Status.CheckReAI;
            transfer.Detail = "The app closed during upload. Check ReAI before retrying to avoid a duplicate.";
        }
        return state;
    }
    public void Save(LocalState state)
    {
        Directory.CreateDirectory(directory);
        var temporary = FilePath + ".tmp";
        using (var file = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            JsonSerializer.Serialize(file, state, ReAIClient.Json); file.Flush(true);
        }
        File.Move(temporary, FilePath, true);
    }
}

/// <summary>The file is still open in another program, for example while it is being copied or scanned.</summary>
public sealed class FileBusyException(string message) : IOException(message);

public sealed record StagingResult(Transfer? Staged = null, string? Duplicate = null);

/// <summary>
/// Copies files into the app's local copies, hashing the original bytes for duplicate detection. HEIC, TIFF and WebP images are
/// converted to JPEG by <paramref name="toJpeg"/> when available. The original file is never changed.
/// </summary>
public sealed class Stager(string root, Func<string, string, Task>? toJpeg = null)
{
    public const long MaximumSize = 20 * 1024 * 1024;
    private readonly Dictionary<string, (long Size, DateTime Modified, string Fingerprint)> seen = [];
    public string Root => root;

    public async Task<StagingResult> Stage(string source, Company company, Destination destination, IReadOnlySet<string> known)
    {
        var info = new FileInfo(source);
        if (!info.Exists || info.LinkTarget != null || info.Attributes.HasFlag(FileAttributes.Directory)) return new();
        if (!FileTypes.Supported(source)) throw new InvalidDataException($"{info.Name}: {FileTypes.UnsupportedMessage}");
        long size = info.Length; var modified = info.LastWriteTimeUtc;
        if (size is <= 0 or > MaximumSize) throw new InvalidDataException($"{info.Name}: files must be between 1 byte and 20 MB.");
        var key = $"{company.Id}:{destination}:{info.FullName}";
        if (seen.TryGetValue(key, out var cached) && cached.Size == size && cached.Modified == modified && known.Contains(cached.Fingerprint)) return new(Duplicate: cached.Fingerprint);

        var directory = Path.Combine(root, company.Id.ToString(System.Globalization.CultureInfo.InvariantCulture), destination.ToString(), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var retained = false;
        var target = Path.Combine(directory, info.Name);
        try
        {
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            long copied = 0;
            try
            {
                await using var input = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read, 262_144, FileOptions.Asynchronous | FileOptions.SequentialScan);
                await using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None, 262_144, FileOptions.Asynchronous);
                var buffer = new byte[262_144];
                for (int read; (read = await input.ReadAsync(buffer)) > 0;)
                {
                    copied += read;
                    if (copied > MaximumSize) throw new InvalidDataException("The file grew beyond 20 MB while copying.");
                    hash.AppendData(buffer, 0, read);
                    await output.WriteAsync(buffer.AsMemory(0, read));
                }
            }
            catch (IOException e) when ((e.HResult & 0xFFFF) is 32 or 33)
            {
                throw new FileBusyException($"{info.Name} is still open in another program. Scan again when it is closed.");
            }
            info.Refresh();
            if (copied != size || info.Length != size || info.LastWriteTimeUtc != modified)
                throw new FileBusyException($"{info.Name} is still being written. Scan again when the copy finishes.");
            var fingerprint = $"{company.Id}:{destination}:{Convert.ToHexStringLower(hash.GetHashAndReset())}";
            seen[key] = (size, modified, fingerprint);
            if (known.Contains(fingerprint)) return new(Duplicate: fingerprint);
            var filename = info.Name;
            if (FileTypes.Converted.Contains(info.Extension))
            {
                if (toJpeg == null) throw new InvalidDataException($"{info.Name}: {FileTypes.UnsupportedMessage}");
                var jpeg = Path.ChangeExtension(target, ".jpg");
                try { await toJpeg(target, jpeg); }
                catch (Exception e) { throw new InvalidDataException($"{info.Name} could not be converted to JPEG. {e.Message}"); }
                File.Delete(target);
                target = jpeg; filename = Path.GetFileName(jpeg);
                if (new FileInfo(target).Length is <= 0 or > MaximumSize) throw new InvalidDataException($"{filename} is larger than 20 MB after conversion.");
            }
            retained = true;
            return new(new Transfer { Company = company, Destination = destination, Filename = filename, Fingerprint = fingerprint, File = target });
        }
        finally { if (!retained) try { Directory.Delete(directory, true); } catch (IOException) { } }
    }

    /// <summary>Supported files directly inside the folder. Hidden, system and other file types are left alone.</summary>
    public static Dictionary<string, FileStamp> Snapshot(string folder)
    {
        var result = new Dictionary<string, FileStamp>();
        foreach (var file in new DirectoryInfo(folder).EnumerateFiles("*", new EnumerationOptions { RecurseSubdirectories = false, AttributesToSkip = FileAttributes.Hidden | FileAttributes.System | FileAttributes.ReparsePoint }))
            if (FileTypes.Supported(file.Name)) result[file.Name] = new(file.Length, file.LastWriteTimeUtc);
        return result;
    }
}
