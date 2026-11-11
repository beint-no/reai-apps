// TEMPORARY: canned ReAI responses so CI can render the connected UI. Removed before merge.
using System.Globalization;
using System.Net;
using System.Text;

namespace ReAI.Shipping;

internal sealed class TmpFake : HttpMessageHandler
{
    private bool exists; private string status = "prepared";
    private const string Draft = """{"requestId":"11111111-2222-3333-4444-555555555555","carrierCode":null,"deliveryMethod":null,"productCode":null,"recipient":{"name":"Kari Nordmann","email":"kari@example.no","phone":"+4790000000","addressPart1":"Storgata 1","postalCode":"0155","city":"Oslo","countryCode":"NO"},"parcel":{"weightGrams":500,"lengthCm":30,"widthCm":20.5,"heightCm":10},"lines":[{"orderLineId":3,"quantity":1},{"orderLineId":4,"quantity":2}]}""";
    private string Shipment() => $$"""{"id":77,"orderId":5,"requestId":"x","status":"{{status}}","checkoutManaged":false,"carrierCode":"bring","deliveryMethod":"home","productCode":"P1","recipient":{"name":"Kari Nordmann","addressPart1":"Storgata 1","postalCode":"0155","city":"Oslo"},"parcel":{"weightGrams":900,"lengthCm":30,"widthCm":20.5,"heightCm":10},"lines":[],"customerCharge":{"amount":149.00,"currencyCode":"NOK","recordingPending":false},"inventoryRecordingPending":false,"labelAvailable":{{(status == "booked" ? "true" : "false")}},"customsInvoiceAvailable":true,"tracking":{"status":"x"},"actions":[{{(status == "prepared" ? "\"book\",\"cancel\"" : "")}}]}""";
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        await Task.Delay(150, cancellationToken);
        var path = request.RequestUri!.PathAndQuery;
        static HttpResponseMessage Json(string json, int code = 200) => new((HttpStatusCode)code) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        if (path == "/api/me") return Json("""{"email":"a@b.no","tenants":[{"id":8,"companyName":"Testbutikken AS"}]}""");
        if (path.StartsWith("/api/orders/shipping-ready")) return Json("""{"items":[{"orderId":5,"orderNumber":"SO-5","customerId":1,"customerName":"Kari Nordmann","date":"2026-11-10","remainingQuantity":1,"preparedShipmentId":null},{"orderId":6,"orderNumber":"SO-6","customerId":2,"customerName":"Ola Hansen med et ganske langt kundenavn AS","date":"2026-11-09","remainingQuantity":1,"preparedShipmentId":77}],"page":0,"size":50,"totalItems":120,"totalPages":3}""");
        if (path.StartsWith("/api/shipments?")) return Json(path.Contains("orderId") ? (exists ? """{"items":[{"id":77,"orderId":5,"status":"booked"},{"id":60,"orderId":5,"status":"cancelled"}],"nextBeforeId":60}""" : """{"items":[],"nextBeforeId":null}""") : """{"items":[{"id":77,"orderId":5,"status":"booked"},{"id":70,"orderId":4,"status":"booked"}],"nextBeforeId":60}""");
        if (path == "/api/orders/5/shipping-options") return Json($$"""{"orderId":5,"canCreate":true,"weightEstimated":true,"services":[{"carrierCode":"bring","deliveryMethod":"home","carrierName":"Bring","name":"Hjem","pickupRequired":false,"testMode":true},{"carrierCode":"bring","deliveryMethod":"pickup_point","carrierName":"Bring","name":"Hentested","pickupRequired":true,"testMode":true}],"availableLines":[{"orderLineId":3,"name":"Ullsokker grå 42-45","availableQuantity":1},{"orderLineId":4,"name":"Lue","availableQuantity":2}],"defaults":{{Draft}},"existingShipments":{"items":[]} }""");
        if (path == "/api/orders/5/shipping-rates") return Json("""[{"carrierCode":"bring","deliveryMethod":"pickup_point","status":"quoted","retryable":false,"quote":{"customerPriceAmount":99.00,"currencyCode":"NOK","productCode":"PP","fingerprint":"f0"}},{"carrierCode":"bring","deliveryMethod":"home","name":"Pakke levert hjem","status":"quoted","retryable":false,"quote":{"customerPriceAmount":149.00,"currencyCode":"NOK","productCode":"P1","fingerprint":"f1"}}]""");
        if (path == "/api/orders/5/shipping-quote") return Json("""{"status":"quoted","pickupRequired":false,"pickupPlaces":[{"providerId":"a","name":"Coop","addressPart1":"x","postalCode":"0155","city":"Oslo","countryCode":"NO","type":"x","displayName":"Coop Mega Storgata, 0155 Oslo","description":"x"}],"retryable":false,"quote":{"customerPriceAmount":149.00,"currencyCode":"NOK","productCode":"P1","fingerprint":"f1"}}""");
        if (path.StartsWith("/api/shipments/by-request-id/")) return exists ? Json(Shipment()) : Json("""{"detail":"Not found"}""", 404);
        if (path == "/api/shipments" && request.Method == HttpMethod.Post) { exists = true; return Json(Shipment(), 201); }
        if (path == "/api/shipments/77/book") { status = "booking"; return Json(Shipment(), 202); }
        if (path == "/api/shipments/77") { if (status == "booking") status = "booked"; return Json(Shipment()); }
        if (path == "/api/shipments/77/label") return new(HttpStatusCode.OK) { Content = new ByteArrayContent(Pdf(100, 150)) { Headers = { ContentType = new("application/pdf") } } };
        if (path is "/api/orders/5" or "/api/orders/4") return Json($$"""{"id":{{path[^1]}},"number":"SO-{{path[^1]}}","customerName":"Kari Nordmann","date":"2026-11-10"}""");
        if (path == "/api/warehouses") return Json("""[{"id":1,"name":"Hovedlager Oslo"},{"id":2,"name":"Butikk"}]""");
        if (path.StartsWith("/api/warehouses/1/locations")) return Json("""[{"id":10,"warehouseId":1,"name":"A-01-02","description":"Sokker og luer","zoneId":2,"scanCode":"reai:location:0b0e7a52-7f0c-4b7e-9f52-1a2b3c4d5e6f"},{"id":11,"warehouseId":1,"name":"B-07","scanCode":null},{"id":12,"warehouseId":1,"name":"C-03-01","zoneId":2,"scanCode":"reai:location:1b0e7a52-7f0c-4b7e-9f52-1a2b3c4d5e6f"}]""");
        if (path == "/api/warehouses/1/zones") return Json("""[{"id":2,"name":"Plukksone"}]""");
        return Json("""{"detail":"unexpected"}""", 500);
    }
    private static byte[] Pdf(double width, double height)
    {
        static string Points(double mm) => (mm * 72 / 25.4).ToString("0.##", CultureInfo.InvariantCulture);
        var content = new StringBuilder($"1 w {Points(2)} {Points(2)} {Points(width - 4)} {Points(height - 4)} re S\n");
        for (int bar = 0; bar < 40; bar++) content.Append($"{Points(10 + bar * 1.5)} {Points(height / 2)} {Points(bar % 3 == 0 ? 1 : 0.5)} {Points(25)} re f\n");
        content.Append($"BT /F1 14 Tf {Points(10)} {Points(height - 20)} Td (ReAI UI test label) Tj ET\n");
        string[] objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [4 0 R] /Count 1 >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            $"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {Points(width)} {Points(height)}] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>", $"<< /Length {content.Length} >>\nstream\n{content}endstream"];
        var pdf = new StringBuilder("%PDF-1.4\n");
        var offsets = new List<int>();
        for (int index = 0; index < objects.Length; index++) { offsets.Add(pdf.Length); pdf.Append($"{index + 1} 0 obj\n{objects[index]}\nendobj\n"); }
        int xref = pdf.Length;
        pdf.Append($"xref\n0 {objects.Length + 1}\n0000000000 65535 f \n");
        foreach (var offset in offsets) pdf.Append($"{offset:0000000000} 00000 n \n");
        pdf.Append($"trailer\n<< /Size {objects.Length + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n");
        return Encoding.ASCII.GetBytes(pdf.ToString());
    }
}
