using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ReAI.Import.Core;

public sealed class ReAIClient : IDisposable
{
    private readonly HttpClient http;
    public static readonly Uri Origin = new("https://app.reai.no/");
    public ReAIClient(HttpMessageHandler? handler = null)
    {
        http = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { BaseAddress = Origin, Timeout = TimeSpan.FromSeconds(40), MaxResponseContentBufferSize = 64 * 1024 * 1024 };
    }
    public void Dispose() => http.Dispose();
    public async Task<JsonElement> Request(string path, string token, int? company = null, string? payload = null, CancellationToken cancellation = default)
    {
        using var request = new HttpRequestMessage(payload == null ? HttpMethod.Get : HttpMethod.Post, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (company != null) request.Headers.Add("X-Tenant-Id", company.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));
        if (payload != null) request.Content = new StringContent(payload, Encoding.UTF8, "application/json");
        using var response = await http.SendAsync(request, cancellation);
        if (!response.IsSuccessStatusCode)
        {
            string message = response.StatusCode switch
            {
                HttpStatusCode.Unauthorized => "Connection expired or revoked. Connect to ReAI again.",
                HttpStatusCode.Forbidden => "Your account needs read and write permission for this type of record.",
                HttpStatusCode.TooManyRequests => "ReAI is limiting requests. Wait before continuing.",
                _ => $"ReAI returned HTTP {(int)response.StatusCode}."
            };
            throw new HttpRequestException(message, null, response.StatusCode);
        }
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellation));
        return document.RootElement.Clone();
    }
    public async Task<Account> Account(string token, CancellationToken cancellation = default)
    {
        var result = (await Request("api/me", token, cancellation: cancellation)).Deserialize<Account>(Json.Options) ?? throw new InvalidDataException("Invalid account response.");
        if (string.IsNullOrWhiteSpace(result.Email) || result.Tenants is not { Length: 1 } || result.Tenants[0].Id <= 0) throw new InvalidDataException("Connect with a key approved for exactly one company.");
        return result;
    }
    public async Task<ExistingSnapshot> Existing(ImportKind kind, string token, int company, CancellationToken cancellation = default)
    {
        var keys = new HashSet<string>(); var ids = new HashSet<int>();
        foreach (var archived in new[] { "false", "true" })
        {
            var records = await Request($"api/{kind.ToString().ToLowerInvariant()}?archived={archived}", token, company, cancellation: cancellation);
            foreach (var record in records.EnumerateArray())
            {
                ids.Add(record.GetProperty("id").GetInt32());
                foreach (var key in new[] { "number", "name", "email" }) if (record.TryGetProperty(key, out var field) && field.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(field.GetString())) keys.Add(key + ":" + field.GetString()!.Trim().ToLowerInvariant());
                if (record.TryGetProperty("variants", out var variants) && variants.ValueKind == JsonValueKind.Array)
                    foreach (var variant in variants.EnumerateArray()) if (variant.TryGetProperty("sku", out var sku) && sku.ValueKind == JsonValueKind.String) keys.Add("sku:" + sku.GetString()!.Trim().ToLowerInvariant());
            }
        }
        return new(keys, ids);
    }
    public async Task<string> Connect(Action<string, Uri> showCode, CancellationToken cancellation)
    {
        async Task<HttpResponseMessage> Post(string action, Dictionary<string, string> form) => await http.PostAsync("oauth/device/" + action, new FormUrlEncodedContent(form), cancellation);
        const string client = "import-windows";
        using var response = await Post("authorize", new() { ["client_id"] = client, ["client_name"] = "ReAI Import for Windows" });
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellation));
        var grant = document.RootElement;
        var code = grant.GetProperty("user_code").GetString()!;
        int expiry = grant.GetProperty("expires_in").GetInt32(), delay = grant.GetProperty("interval").GetInt32();
        if (!Regex.IsMatch(code, "^[A-Z2-9]{5}-[A-Z2-9]{5}$") || expiry is < 1 or > 600 || delay is < 1 or > 60) throw new InvalidDataException("Invalid approval request.");
        var expected = new Uri(Origin, "connect-app?user_code=" + Uri.EscapeDataString(code));
        if (grant.GetProperty("verification_uri_complete").GetString() != expected.AbsoluteUri) throw new InvalidDataException("Unexpected approval address.");
        var elapsed = Stopwatch.StartNew();
        showCode(code, expected);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(TimeSpan.FromSeconds(expiry));
        while (elapsed.Elapsed.TotalSeconds < expiry)
        {
            await Task.Delay(TimeSpan.FromSeconds(delay), deadline.Token);
            using var content = new FormUrlEncodedContent(new Dictionary<string, string> { ["client_id"] = client, ["device_code"] = grant.GetProperty("device_code").GetString()!, ["grant_type"] = "urn:ietf:params:oauth:grant-type:device_code" });
            HttpResponseMessage poll;
            try { poll = await http.PostAsync("oauth/device/token", content, deadline.Token); }
            catch (OperationCanceledException) when (!deadline.IsCancellationRequested) { delay = Math.Min(60, Math.Max(10, delay * 2)); continue; }
            catch (HttpRequestException) { delay = Math.Min(60, Math.Max(10, delay * 2)); continue; }
            using (poll)
            {
                if (poll.StatusCode == HttpStatusCode.TooManyRequests) { delay = Math.Max(delay, (int)(poll.Headers.RetryAfter?.Delta?.TotalSeconds ?? 60)); continue; }
                if (poll.StatusCode is not (HttpStatusCode.OK or HttpStatusCode.BadRequest)) throw new HttpRequestException("ReAI could not finish connecting.");
                using var result = JsonDocument.Parse(await poll.Content.ReadAsStringAsync(deadline.Token));
                var root = result.RootElement;
                if (poll.IsSuccessStatusCode && root.TryGetProperty("token_type", out var type) && type.GetString() == "Bearer" && root.TryGetProperty("access_token", out var access) && !string.IsNullOrWhiteSpace(access.GetString())) return access.GetString()!;
                switch (root.TryGetProperty("error", out var error) ? error.GetString() : "")
                {
                    case "authorization_pending": break;
                    case "slow_down": delay += 5; break;
                    case "access_denied": throw new InvalidOperationException("Connection declined in ReAI.");
                    case "expired_token": throw new InvalidOperationException("The approval code expired. Connect again.");
                    default: throw new InvalidOperationException("ReAI could not authorize this app.");
                }
            }
        }
        throw new InvalidOperationException("The approval code expired. Connect again.");
    }
}
