using System.Text;
using System.Text.Json;

namespace ReAI.Import.Core;

public sealed class ImportJournal(string directory)
{
    private string BatchPath => Path.Combine(directory, "last-import.json");
    private string ProgressPath => Path.Combine(directory, "last-import.progress");
    private Guid active;
    private sealed record Progress(Guid Batch, ImportRow Row);
    public void Save(ImportBatch batch)
    {
        Directory.CreateDirectory(directory);
        var temporary = BatchPath + ".tmp";
        using (var file = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            JsonSerializer.Serialize(file, batch, Json.Options); file.Flush(true);
        }
        File.Move(temporary, BatchPath, true);
        File.Delete(ProgressPath); active = batch.Id;
    }
    public void Record(ImportBatch batch, ImportRow row)
    {
        if (active != batch.Id) throw new InvalidOperationException("The local report changed. Reopen the app.");
        using var file = new FileStream(ProgressPath, FileMode.Append, FileAccess.Write, FileShare.Read);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(new Progress(batch.Id, row), Json.Options);
        file.Write(bytes); file.WriteByte(10); file.Flush(true);
    }
    public ImportBatch? Load()
    {
        if (!File.Exists(BatchPath)) return null;
        var batch = JsonSerializer.Deserialize<ImportBatch>(File.ReadAllBytes(BatchPath), Json.Options) ?? throw new InvalidDataException("Invalid import report.");
        var rows = batch.Rows.ToDictionary(r => r.Line);
        if (File.Exists(ProgressPath))
        {
            var lines = File.ReadAllText(ProgressPath).Split('\n');
            foreach (var line in lines.SkipLast(1).Where(l => l.Length > 0))
            {
                var progress = JsonSerializer.Deserialize<Progress>(line, Json.Options) ?? throw new InvalidDataException("Invalid progress record.");
                if (progress.Batch == batch.Id && rows.ContainsKey(progress.Row.Line)) rows[progress.Row.Line] = progress.Row;
            }
        }
        for (int i = 0; i < batch.Rows.Count; i++)
        {
            batch.Rows[i] = rows[batch.Rows[i].Line];
            if (batch.Rows[i].State == RowState.Sending) { batch.Rows[i].State = RowState.Uncertain; batch.Rows[i].Detail = "The app closed during a request. Check ReAI before importing this row again."; }
        }
        active = batch.Id;
        return batch;
    }
    public void Clear() { File.Delete(BatchPath); File.Delete(ProgressPath); active = Guid.Empty; }
}

public sealed class ImportSession(ReAIClient api, ImportJournal journal)
{
    public bool PauseRequested { get; set; }
    public async Task Run(ImportBatch batch, string token, Action changed)
    {
        PauseRequested = false;
        var account = await api.Account(token);
        if (account.Email != batch.Email || account.Tenants[0].Id != batch.Company.Id) throw new InvalidOperationException("Connect with the original account and company to continue this import.");
        var existing = await api.Existing(batch.Kind, token, batch.Company.Id);
        foreach (var row in batch.Rows.Where(r => r.State == RowState.Ready))
        {
            if (PauseRequested) break;
            var keys = Validation.Keys(row.Values, batch.Kind);
            if (keys.Overlaps(existing.Keys))
            {
                row.State = RowState.Skipped; row.Detail = "Matches a record now in ReAI.";
                journal.Record(batch, row); changed(); continue;
            }
            row.State = RowState.Sending; row.Detail = "Sending to ReAI…";
            journal.Record(batch, row); changed();
            try
            {
                if (row.Payload == null) throw new InvalidDataException("Missing prepared row data.");
                var result = await api.Request("api/" + batch.Kind.ToString().ToLowerInvariant(), token, batch.Company.Id, row.Payload);
                int id = result.GetProperty("id").GetInt32();
                if (id <= 0) throw new InvalidDataException("Invalid record ID.");
                row.RemoteId = id;
                row.State = existing.Ids.Contains(id) ? RowState.Skipped : RowState.Created;
                row.Detail = row.State == RowState.Created ? $"Created in ReAI · ID {id}" : $"ReAI returned existing record · ID {id}";
                existing.Keys.UnionWith(keys); existing.Ids.Add(id);
            }
            catch (Exception error) when (error is HttpRequestException or TaskCanceledException or JsonException or InvalidDataException or KeyNotFoundException or InvalidOperationException)
            {
                var status = (error as HttpRequestException)?.StatusCode;
                row.State = status is not null && (int)status is >= 400 and < 500 ? RowState.Rejected : RowState.Uncertain;
                row.Detail = row.State == RowState.Rejected ? error.Message + " This row will not be retried automatically." : "The outcome is unknown. Check ReAI before importing this row again.";
                PauseRequested = true;
            }
            journal.Record(batch, row); changed();
        }
    }
    public static string Report(ImportBatch batch)
    {
        static string Cell(string text)
        {
            if (text.Length > 0 && ("=+-@\t\r\n".Contains(text[0]) || text.TrimStart() is { Length: > 0 } trimmed && "=+-@".Contains(trimmed[0]))) text = "'" + text;
            return "\"" + text.Replace("\"", "\"\"") + "\"";
        }
        var result = new StringBuilder("Row,Name,Status,ReAI ID,Details\r\n");
        foreach (var row in batch.Rows) result.AppendLine(string.Join(",", new[] { row.Line.ToString(), row.Name, row.Status, row.RemoteId?.ToString() ?? "", row.Detail }.Select(Cell)));
        return result.ToString();
    }
}
