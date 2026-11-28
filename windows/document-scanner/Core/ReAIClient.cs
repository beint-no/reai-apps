using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ReAI.DocumentScanner.Core;

/// <summary>ReAI answered that it did not create the document, so trying again cannot duplicate it.</summary>
public sealed class UploadRejectedException(string message) : Exception(message);

public sealed class ReAIClient(HttpMessageHandler? handler = null) : IDisposable
{
    public static readonly Uri Origin = new("https://app.reai.no/");
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HttpClient http = new(handler ?? new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false })
    { BaseAddress = Origin, Timeout = TimeSpan.FromMinutes(5), MaxResponseContentBufferSize = 4 * 1024 * 1024 };
    public void Dispose() => http.Dispose();

    private static HttpRequestMessage Request(HttpMethod method, string path, string token, int? company)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new("Bearer", token);
        request.Headers.Accept.ParseAdd("application/json");
        request.Headers.AcceptLanguage.ParseAdd("en");
        if (company is int id) request.Headers.Add("X-Tenant-Id", id.ToString(CultureInfo.InvariantCulture));
        return request;
    }

    private static async Task Check(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode) return;
        string? detail = null;
        try { detail = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString(); } catch { }
        var message = response.StatusCode switch
        {
            HttpStatusCode.Unauthorized => "Your connection has expired. Disconnect and connect to ReAI again.",
            HttpStatusCode.Forbidden => detail ?? "You do not have permission for this company or destination.",
            HttpStatusCode.RequestEntityTooLarge => "This file exceeds the server upload limit.",
            HttpStatusCode.MethodNotAllowed => "This upload destination is unavailable. Choose another destination or contact ReAI support.",
            _ => detail ?? $"ReAI returned HTTP {(int)response.StatusCode}."
        };
        // Client errors are definite answers. Timeouts, rate limits and server errors leave the outcome unknown.
        if ((int)response.StatusCode is >= 400 and < 500 && response.StatusCode is not (HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests))
            throw new UploadRejectedException(message);
        throw new HttpRequestException(message, null, response.StatusCode);
    }

    public async Task<(string Email, Company Company)> Account(string token)
    {
        using var request = Request(HttpMethod.Get, "api/me", token, null);
        using var response = await http.SendAsync(request);
        try { await Check(response); }
        catch (UploadRejectedException e) { throw new HttpRequestException(e.Message, null, response.StatusCode); }
        var account = await response.Content.ReadFromJsonAsync<Account>(Json) ?? throw new InvalidDataException("ReAI returned an invalid response.");
        return account.Tenants is [{ Id: > 0 } company] ? (account.Email, company) : throw new InvalidDataException("Connect again and choose one company in ReAI.");
    }

    /// <summary>Sends one file as multipart <c>files</c>. The upload endpoints return the created documents.</summary>
    public async Task<int> Upload(Transfer transfer, string token, CancellationToken cancellation = default)
    {
        using var request = Request(HttpMethod.Post, transfer.Destination.Endpoint(), token, transfer.Company.Id);
        await using var file = new FileStream(transfer.File, FileMode.Open, FileAccess.Read, FileShare.Read, 262_144, FileOptions.Asynchronous | FileOptions.SequentialScan);
        var part = new StreamContent(file);
        part.Headers.ContentType = new MediaTypeHeaderValue(FileTypes.Mime(transfer.File));
        var form = new MultipartFormDataContent { { part, "files", transfer.Filename.Replace('"', '_').Replace('\r', '_').Replace('\n', '_') } };
        request.Content = form;
        using var response = await http.SendAsync(request, cancellation);
        await Check(response);
        var created = await response.Content.ReadFromJsonAsync<List<JsonElement>>(Json, cancellation);
        return created is [var first, ..] && first.TryGetProperty("id", out var id) && id.TryGetInt32(out var value)
            ? value : throw new InvalidDataException("ReAI accepted the upload but did not return a document ID.");
    }

    /// <summary>Browser device authorization. Returns an access key bound to the one company the user approves.</summary>
    public async Task<string> Connect(Action<string, Uri> showCode, CancellationToken cancellation)
    {
        const string client = "document-scanner-windows";
        using var response = await http.PostAsync("oauth/device/authorize", new FormUrlEncodedContent(new Dictionary<string, string> { ["client_id"] = client, ["client_name"] = "ReAI Document Scanner for Windows" }), cancellation);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException("ReAI could not start the connection. Please try again.");
        var grant = await response.Content.ReadFromJsonAsync<JsonElement>(cancellation);
        var code = grant.GetProperty("user_code").GetString()!;
        int expiry = grant.GetProperty("expires_in").GetInt32(), delay = grant.GetProperty("interval").GetInt32();
        if (!Regex.IsMatch(code, "^[A-Z2-9]{5}-[A-Z2-9]{5}$") || expiry is < 1 or > 600 || delay is < 1 or > 60) throw new InvalidDataException("ReAI returned an invalid approval request.");
        var expected = new Uri(Origin, "connect-app?user_code=" + Uri.EscapeDataString(code));
        if (grant.GetProperty("verification_uri_complete").GetString() != expected.AbsoluteUri) throw new InvalidDataException("ReAI returned an unexpected approval address.");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(TimeSpan.FromSeconds(expiry));
        showCode(code, expected);
        while (true)
        {
            await Task.Delay(TimeSpan.FromSeconds(delay), deadline.Token);
            using var form = new FormUrlEncodedContent(new Dictionary<string, string> { ["client_id"] = client, ["device_code"] = grant.GetProperty("device_code").GetString()!, ["grant_type"] = "urn:ietf:params:oauth:grant-type:device_code" });
            HttpResponseMessage poll;
            try { poll = await http.PostAsync("oauth/device/token", form, deadline.Token); }
            catch (Exception e) when (e is HttpRequestException || !deadline.IsCancellationRequested) { delay = Math.Clamp(delay * 2, 10, 60); continue; }
            using (poll)
            {
                if (poll.StatusCode == HttpStatusCode.TooManyRequests) { delay = Math.Max(delay, (int)(poll.Headers.RetryAfter?.Delta?.TotalSeconds ?? 60)); continue; }
                if (poll.StatusCode is not (HttpStatusCode.OK or HttpStatusCode.BadRequest)) throw new HttpRequestException("ReAI could not finish connecting. Please try again.");
                var result = await poll.Content.ReadFromJsonAsync<JsonElement>(deadline.Token);
                if (poll.IsSuccessStatusCode && result.TryGetProperty("token_type", out var type) && type.GetString() == "Bearer" && result.TryGetProperty("access_token", out var access) && access.GetString() is { Length: > 0 } token) return token;
                switch (result.TryGetProperty("error", out var error) ? error.GetString() : null)
                {
                    case "authorization_pending": break;
                    case "slow_down": delay += 5; break;
                    case "access_denied": throw new InvalidOperationException("Connection declined in ReAI. You can connect again when ready.");
                    case "expired_token": throw new InvalidOperationException("The approval code expired. Please connect again.");
                    default: throw new InvalidOperationException("ReAI could not authorize this app. Please connect again.");
                }
            }
        }
    }
}
