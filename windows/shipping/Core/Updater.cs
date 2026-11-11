using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace ReAI.Shipping.Core;

public sealed record UpdateAsset(string Url, string Sha256);
public sealed record UpdateFeed(string Version, Dictionary<string, UpdateAsset> Assets);

/// <summary>
/// Updates the portable app in place. A newer release is downloaded from GitHub, checked against the checksum in the Pages feed and
/// unpacked under the user's app data. That staged copy then replaces the app folder once the running app has exited.
/// </summary>
public sealed class Updater(string staging, Version current, string executable, HttpMessageHandler? handler = null)
{
    public static readonly Uri Feed = new("https://beint-no.github.io/reai-apps/updates/shipping-windows.json");
    private const string Downloads = "https://github.com/beint-no/reai-apps/releases/download/shipping-windows/";
    private const string Install = "--install-update";
    private readonly HttpClient http = new(handler ?? new HttpClientHandler()) { Timeout = TimeSpan.FromMinutes(10) };

    /// <summary>The executable of the newest completely staged version, if it is newer than the running one.</summary>
    public string? Staged => !Directory.Exists(staging) ? null : Directory.GetDirectories(staging)
        .Select(folder => (Version: Version.TryParse(Path.GetFileName(folder), out var version) ? version : null, Executable: Path.Combine(folder, executable)))
        .Where(copy => copy.Version > current && File.Exists(copy.Executable)).OrderByDescending(copy => copy.Version).Select(copy => copy.Executable).FirstOrDefault();

    /// <summary>Removes versions that are already installed and unfinished downloads.</summary>
    public void Clean()
    {
        if (!Directory.Exists(staging)) return;
        foreach (var entry in Directory.GetFileSystemEntries(staging))
            try
            {
                if (File.Exists(entry)) File.Delete(entry);
                else if (!Version.TryParse(Path.GetFileName(entry), out var version) || version <= current) Directory.Delete(entry, true);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    /// <summary>Stages the published version when it is newer. Returns whether an update is ready to install.</summary>
    public async Task<bool> Download(CancellationToken cancellation = default)
    {
        var invalid = new InvalidDataException("The update information is invalid.");
        var feed = await http.GetFromJsonAsync<UpdateFeed>(Feed, ReAIClient.Json, cancellation) ?? throw invalid;
        if (!Version.TryParse(feed.Version, out var version)) throw invalid;
        var target = Path.Combine(staging, version.ToString());
        if (version <= current || Directory.Exists(target)) return Staged != null;
        if (!feed.Assets.TryGetValue(RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? "arm64" : "x64", out var asset) || !asset.Url.StartsWith(Downloads, StringComparison.Ordinal)) throw invalid;
        Directory.CreateDirectory(staging);
        string archive = target + ".zip", partial = target + ".partial";
        try
        {
            using (var response = await http.GetAsync(asset.Url, HttpCompletionOption.ResponseHeadersRead, cancellation))
            {
                response.EnsureSuccessStatusCode();
                await using var file = File.Create(archive);
                await response.Content.CopyToAsync(file, cancellation);
            }
            await using (var file = File.OpenRead(archive))
                if (!Convert.ToHexString(await SHA256.HashDataAsync(file, cancellation)).Equals(asset.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("The downloaded update does not match its checksum.");
            if (Directory.Exists(partial)) Directory.Delete(partial, true);
            await ZipFile.ExtractToDirectoryAsync(archive, partial, cancellation);
            if (!File.Exists(Path.Combine(partial, executable))) throw invalid;
            // The version folder appears only when it is complete.
            Directory.Move(partial, target);
        }
        finally { File.Delete(archive); }
        return true;
    }

    /// <summary>Starts the staged copy, which replaces this app's folder after this process exits. The caller must then exit.</summary>
    public static void Apply(string staged, bool relaunch)
    {
        // Fail here, while the app is still running, when the folder cannot be written.
        using (File.Create(Path.Combine(AppContext.BaseDirectory, ".update"), 1, FileOptions.DeleteOnClose)) { }
        Process.Start(new ProcessStartInfo(staged) { ArgumentList = { Install, AppContext.BaseDirectory, Environment.ProcessId.ToString(), relaunch.ToString() } })?.Dispose();
    }

    /// <summary>Runs in the staged copy: waits for the old app to exit and copies this version over it. Returns false for a normal start.</summary>
    public static bool Installed(string[] arguments)
    {
        if (arguments is not [_, Install, var folder, var process, var relaunch]) return false;
        try
        {
            try { using var old = Process.GetProcessById(int.Parse(process)); old.WaitForExit(TimeSpan.FromSeconds(60)); }
            catch (ArgumentException) { }
            var source = AppContext.BaseDirectory;
            // Only add and replace this app's files; anything else in the folder is left alone.
            foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
            {
                var destination = Path.Combine(folder, Path.GetRelativePath(source, file));
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                for (int attempt = 0; ; attempt++)
                    try { File.Copy(file, destination, true); break; }
                    catch (IOException) when (attempt < 20) { Thread.Sleep(500); }
            }
        }
        finally { if (bool.Parse(relaunch)) Process.Start(Path.Combine(folder, Path.GetFileName(Environment.ProcessPath!)))?.Dispose(); }
        return true;
    }
}
