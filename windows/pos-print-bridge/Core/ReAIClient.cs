using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ReAI.POSPrintBridge.Core;

/// <summary>Public API client. Every call is a read; the bridge never writes to ReAI.</summary>
public sealed class ReAIClient(HttpMessageHandler? handler = null) : IDisposable
{
    public static readonly Uri Origin = new("https://app.reai.no/");
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HttpClient http = new(handler ?? new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false })
    { BaseAddress = Origin, Timeout = TimeSpan.FromSeconds(20), MaxResponseContentBufferSize = 16 * 1024 * 1024 };
    public void Dispose() => http.Dispose();

    private async Task<Timed<T>> Get<T>(string path, string token, int? company)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Authorization = new("Bearer", token);
        request.Headers.AcceptLanguage.ParseAdd("en");
        request.Headers.Accept.ParseAdd("application/json");
        if (company is int id) request.Headers.Add("X-Tenant-Id", id.ToString(CultureInfo.InvariantCulture));
        using var response = await http.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            string? detail = null;
            try { detail = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString(); } catch { }
            throw new HttpRequestException(response.StatusCode switch
            {
                HttpStatusCode.Unauthorized => "Your connection has expired. Disconnect and connect to ReAI again.",
                HttpStatusCode.Forbidden => detail ?? "Your ReAI user needs kassasystem read and company read permission.",
                _ => detail ?? $"ReAI could not be reached ({(int)response.StatusCode}). Retrying."
            }, null, response.StatusCode);
        }
        var value = await response.Content.ReadFromJsonAsync<T>(Json) ?? throw new InvalidDataException("ReAI returned an invalid response.");
        return new(value, response.Headers.Date ?? DateTimeOffset.UtcNow);
    }

    public async Task<Company> Account(string token) =>
        (await Get<Account>("api/me", token, null)).Value.Tenants is [{ Id: > 0 } company] ? company : throw new InvalidDataException("Connect again and choose one company in ReAI.");

    private sealed record Address(string AddressPart1, string? AddressPart2, string? PostalCode, string City);
    private sealed record Registry(string Name, string? OrganizationNumber, string? CompanyTypeCode, Address? Address);
    private sealed record Settings(Registry Company, bool VatRegistered);
    private sealed record VatCode(string Code, decimal Rate);

    public async Task<Merchant> Merchant(string token, int company)
    {
        var settings = (await Get<Settings>("api/company-settings", token, company)).Value;
        var address = settings.Company.Address is { } a
            ? new[] { a.AddressPart1, a.AddressPart2 ?? "", string.Join(' ', new[] { a.PostalCode ?? "", a.City }.Where(part => part.Length > 0)) }.Where(line => line.Length > 0).ToArray()
            : [];
        return new(settings.Company.Name, settings.Company.OrganizationNumber, settings.VatRegistered, settings.Company.CompanyTypeCode, address);
    }

    public async Task<Dictionary<string, decimal>> VatRates(string token, int company)
    {
        Dictionary<string, decimal> rates = [];
        foreach (var code in (await Get<List<VatCode>>("api/vat-codes", token, company)).Value) rates.TryAdd(code.Code, code.Rate);
        return rates;
    }

    /// <summary>One page of receipts from <paramref name="startAt"/> (inclusive), ordered by journal ID.</summary>
    public Task<Timed<SalesPage>> Sales(string token, int company, DateTimeOffset startAt, int? cashPoint, int page) =>
        Get<SalesPage>($"api/kassasystem/sales?startAt={Uri.EscapeDataString(startAt.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture))}&page={page}&pageSize=100"
            + (cashPoint is int id ? "&cashPointId=" + id.ToString(CultureInfo.InvariantCulture) : ""), token, company);

    public async Task<Sale> Sale(long id, string token, int company) => (await Get<Sale>($"api/kassasystem/sales/{id}", token, company)).Value;

    /// <summary>Browser device authorization. Returns an access key bound to the one company the user approves.</summary>
    public async Task<string> Connect(Action<string, Uri> showCode, CancellationToken cancellation)
    {
        const string client = "pos-print-bridge-windows";
        using var response = await http.PostAsync("oauth/device/authorize", new FormUrlEncodedContent(new Dictionary<string, string> { ["client_id"] = client, ["client_name"] = "ReAI POS Print Bridge for Windows" }), cancellation);
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
