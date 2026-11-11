using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Web;

namespace ReAI.Shipping.Core;

public sealed class ReAIClient(HttpMessageHandler? handler = null) : IDisposable
{
    public static readonly Uri Origin = new("https://app.reai.no/");
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
    private readonly HttpClient http = new(handler ?? new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false })
    { BaseAddress = Origin, Timeout = TimeSpan.FromSeconds(30), MaxResponseContentBufferSize = 16 * 1024 * 1024 };
    public void Dispose() => http.Dispose();

    private async Task<HttpResponseMessage> Send(HttpMethod method, string path, string token, int? company, object? body = null)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new("Bearer", token);
        request.Headers.AcceptLanguage.ParseAdd("en");
        if (company is int id) request.Headers.Add("X-Tenant-Id", id.ToString(CultureInfo.InvariantCulture));
        if (method == HttpMethod.Post) request.Content = body == null ? new ByteArrayContent([]) : new StringContent(JsonSerializer.Serialize(body, Json), Encoding.UTF8, "application/json");
        var response = await http.SendAsync(request);
        if (response.IsSuccessStatusCode) return response;
        using (response)
        {
            string? detail = null;
            try { detail = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("detail").GetString(); } catch { }
            throw new HttpRequestException(response.StatusCode switch
            {
                HttpStatusCode.Unauthorized => "Your connection has expired. Disconnect and connect to ReAI again.",
                HttpStatusCode.Forbidden => detail ?? "You do not have permission for this shipping operation.",
                HttpStatusCode.NotFound => detail ?? "The shipment was not found, or shipping is disabled for this company.",
                _ => detail ?? "The shipping operation failed. Refresh to check the current state."
            }, null, response.StatusCode);
        }
    }
    private async Task<TResult> Read<TResult>(HttpMethod method, string path, string token, int? company, object? body = null)
    {
        using var response = await Send(method, path, token, company, body);
        return await response.Content.ReadFromJsonAsync<TResult>(Json) ?? throw new InvalidDataException("ReAI returned an invalid response.");
    }
    private Task<TResult> Get<TResult>(string path, string token, int? company) => Read<TResult>(HttpMethod.Get, path, token, company);
    private Task<TResult> Post<TResult>(string path, string token, int company, object? body = null) => Read<TResult>(HttpMethod.Post, path, token, company, body);

    public async Task<Company> Account(string token) =>
        (await Get<Account>("api/me", token, null)).Tenants is [{ Id: > 0 } company] ? company : throw new InvalidDataException("Connect again and choose one company in ReAI.");
    public Task<OrderPage> Orders(string token, int company, string search, int page, string from) =>
        Get<OrderPage>($"api/orders/shipping-ready?search={Uri.EscapeDataString(search)}&page={page}&from={from}", token, company);
    public Task<ShipmentPage> Shipments(int? order, int? beforeId, string token, int company) =>
        Get<ShipmentPage>("api/shipments?limit=50" + (order is int o ? "&orderId=" + o : "") + (beforeId is int b ? "&beforeId=" + b : ""), token, company);
    public Task<Options> Options(int order, string token, int company) => Get<Options>($"api/orders/{order}/shipping-options", token, company);
    public Task<List<Rate>> Rates(int order, Draft draft, string token, int company) => Post<List<Rate>>($"api/orders/{order}/shipping-rates", token, company, draft);
    public Task<QuoteResult> Quote(int order, Draft draft, string token, int company) => Post<QuoteResult>($"api/orders/{order}/shipping-quote", token, company, draft);
    public Task<Shipment> Create(int order, Draft draft, string token, int company) => Post<Shipment>("api/shipments", token, company, new { orderId = order, shipment = draft });
    public Task<Shipment> Shipment(int id, string token, int company) => Get<Shipment>($"api/shipments/{id}", token, company);
    public Task<Shipment> Book(int id, string token, int company) => Post<Shipment>($"api/shipments/{id}/book", token, company);
    public Task<Shipment> Cancel(int id, string token, int company) => Post<Shipment>($"api/shipments/{id}/cancel", token, company);
    public async Task<Shipment?> Find(Guid requestId, string token, int company)
    {
        try { return await Get<Shipment>($"api/shipments/by-request-id/{requestId}", token, company); }
        catch (HttpRequestException e) when (e.StatusCode == HttpStatusCode.NotFound) { return null; }
    }
    public Task<List<Warehouse>> Warehouses(string token, int company) => Get<List<Warehouse>>("api/warehouses", token, company);
    public Task<List<Zone>> Zones(int warehouse, string token, int company) => Get<List<Zone>>($"api/warehouses/{warehouse}/zones", token, company);
    public Task<List<Location>> Locations(int warehouse, string token, int company) =>
        Get<List<Location>>($"api/warehouses/{warehouse}/locations?includePartialCoordinates=true", token, company);

    /// <summary>Downloads the stored label. ReAI answers 202 while the carrier is still producing it; this never books anything.</summary>
    public async Task<byte[]> Label(int shipment, string token, int company)
    {
        for (var elapsed = Stopwatch.StartNew(); elapsed.Elapsed < TimeSpan.FromMinutes(2); await Task.Delay(TimeSpan.FromSeconds(2)))
        {
            using var response = await Send(HttpMethod.Get, $"api/shipments/{shipment}/label", token, company);
            if (response.StatusCode == HttpStatusCode.Accepted) continue;
            var pdf = await response.Content.ReadAsByteArrayAsync();
            if (response.Content.Headers.ContentType?.MediaType != "application/pdf" || pdf.Length > 10 * 1024 * 1024 || !pdf.AsSpan().StartsWith("%PDF-"u8))
                throw new InvalidDataException("This document is not a supported PDF. Open the order in ReAI to print it manually.");
            return pdf;
        }
        throw new TimeoutException("The label is still being prepared. Try again here; the shipment will not be booked again.");
    }

    /// <summary>Browses orders with saved shipments, or finds any order by number, ID or ReAI order link.</summary>
    public async Task<(List<Order> Items, int? NextBeforeId)> History(string token, int company, string search, int? beforeId)
    {
        static Order Row(HistoricalOrder order) => new(order.Id, order.Number, order.CustomerName, order.Date);
        Task<HistoricalOrder> Lookup(int id) => Get<HistoricalOrder>($"api/orders/{id}", token, company);
        var term = search.Trim();
        if (term.Length == 0)
        {
            var page = await Shipments(null, beforeId, token, company);
            List<Order> rows = [];
            // Bound concurrent lookups while browsing the shipment cursor.
            foreach (var batch in page.Items.Select(s => s.OrderId).Distinct().Chunk(4)) rows.AddRange((await Task.WhenAll(batch.Select(Lookup))).Select(Row));
            return (rows, page.NextBeforeId);
        }
        List<HistoricalOrder> found = [];
        var link = Uri.TryCreate(term, UriKind.Absolute, out var uri) ? uri : null;
        int orderId = 0;
        if (link != null)
        {
            if (link.Scheme != "https" || link.Host != Origin.Host || !link.AbsolutePath.StartsWith("/order/") || !int.TryParse(link.AbsolutePath["/order/".Length..], out orderId) || orderId <= 0)
                throw new FormatException("Paste a ReAI order link, order number or order ID.");
            if (HttpUtility.ParseQueryString(link.Query)["tenantId"] is { } tenant && tenant != company.ToString(CultureInfo.InvariantCulture))
                throw new InvalidOperationException("This order link belongs to another company. Connect to that company first.");
        }
        else int.TryParse(term, out orderId);
        if (orderId > 0)
            try { found.Add(await Lookup(orderId)); } catch (HttpRequestException e) when (e.StatusCode == HttpStatusCode.NotFound) { }
        if (link == null)
        {
            var matches = await Get<HistoricalOrderPage>($"api/orders?status=all&startDate=0001-01-01&endDate=9999-12-31&orderNumber={Uri.EscapeDataString(term)}", token, company);
            found.AddRange(matches.Items.Where(match => found.All(order => order.Id != match.Id)));
        }
        return (found.Select(Row).ToList(), null);
    }

    /// <summary>Browser device authorization. Returns an access key bound to the one company the user approves.</summary>
    public async Task<string> Connect(Action<string, Uri> showCode, CancellationToken cancellation)
    {
        const string client = "shipping-windows";
        using var response = await http.PostAsync("oauth/device/authorize", new FormUrlEncodedContent(new Dictionary<string, string> { ["client_id"] = client, ["client_name"] = "ReAI Shipping for Windows" }), cancellation);
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
