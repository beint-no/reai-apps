using System.Text.Json;

namespace ReAI.TimeTracker.Core;

public sealed class TrackerStore(string directory)
{
    private string FilePath => Path.Combine(directory, "tracker.json");
    public LocalState Load() => File.Exists(FilePath) ? JsonSerializer.Deserialize<LocalState>(File.ReadAllText(FilePath), Json.Options) ?? throw new InvalidDataException("The saved tracker state could not be read.") : LocalState.Empty;
    public void Save(LocalState state)
    {
        Directory.CreateDirectory(directory);
        var temporary = FilePath + ".tmp";
        using (var file = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            JsonSerializer.Serialize(file, state, Json.Options); file.Flush(true);
        }
        File.Move(temporary, FilePath, true);
    }
}
