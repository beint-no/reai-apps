import Foundation

final class RedirectBlocker: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct Company: Decodable, Sendable { let id: Int; let companyName: String }
struct Problem: Decodable { let detail: String? }
struct Account: Decodable, Sendable { let tenants: [Company] }

enum AppEnvironment {
    static let origin = URL(string: "https://app.reai.no")!

}

func t(_ key: String) -> String { NSLocalizedString(key, bundle: .module, comment: "") }
func appError(_ text: String, code: Int = 0) -> NSError {
    NSError(domain: "no.reai.shipping", code: code, userInfo: [NSLocalizedDescriptionKey: t(text)])
}

actor ReAIAPI {
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 30
        return URLSession(configuration: config, delegate: RedirectBlocker(), delegateQueue: nil)
    }()

    func account(token: String) async throws -> Company {
        let (data, _) = try await get("api/me", token: token)
        let account = try JSONDecoder().decode(Account.self, from: data)
        guard account.tenants.count == 1, let company = account.tenants.first else {
            throw appError("Connect again and choose one company in ReAI.")
        }
        return company
    }

    func label(_ job: PrintRequest, token: String) async throws -> Data {
        let deadline = ContinuousClock.now.advanced(by: .seconds(120))
        while ContinuousClock.now < deadline {
            try Task.checkCancellation()
            let (data, response) = try await get("api/shipments/\(job.shipmentId)/label", token: token, company: job.tenantId)
            if response.statusCode == 202 {
                try await Task.sleep(for: .seconds(2))
                continue
            }
            guard response.mimeType == "application/pdf", data.count <= 10 * 1024 * 1024,
                  data.starts(with: Data("%PDF-".utf8)) else {
                throw appError("This label is not a supported PDF. Open the order in ReAI to print it manually.")
            }
            return data
        }
        throw appError("The label is still being prepared. Try again here; the shipment will not be booked again.")
    }

    private func get(_ path: String, token: String, company: Int? = nil) async throws -> (Data, HTTPURLResponse) {
        let url = AppEnvironment.origin.appending(path: path)
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(Locale.preferredLanguages.first ?? "en", forHTTPHeaderField: "Accept-Language")
        if let company { request.setValue(String(company), forHTTPHeaderField: "X-Tenant-Id") }
        let (data, raw) = try await session.data(for: request)
        guard let response = raw as? HTTPURLResponse else { throw appError("ReAI returned an invalid response.") }
        guard (200..<300).contains(response.statusCode) else {
            switch response.statusCode {
            case 401: throw appError("Your connection has expired. Disconnect and connect to ReAI again.", code: 401)
            case 403: throw appError("You do not have permission for this shipping operation.", code: 403)
            case 404: throw appError("The shipment was not found, or shipping is disabled for this company.", code: 404)
            default:
                let detail = (try? JSONDecoder().decode(Problem.self, from: data))?.detail
                throw appError(detail ?? "ReAI could not load the label. Open the order to check its status.", code: response.statusCode)
            }
        }
        return (data, response)
    }
}

struct ReadyOrder: Decodable, Identifiable, Sendable {
    var id: Int { orderId }
    let orderId: Int; let orderNumber: String; let customerName: String; let date: String
    let remainingQuantity: Decimal?; let preparedShipmentId: Int?
}
struct HistoricalOrder: Decodable, Sendable {
    let id: Int; let number: String; let customerName: String?; let date: String
    var row: ReadyOrder { ReadyOrder(orderId: id, orderNumber: number, customerName: customerName ?? "", date: date,
                                     remainingQuantity: nil, preparedShipmentId: nil) }
}
struct HistoryPage: Sendable { let items: [ReadyOrder]; let nextBeforeId: Int? }
struct ReadyPage: Decodable, Sendable { let items: [ReadyOrder]; let page: Int; let totalPages: Int; let totalItems: Int }
struct Recipient: Codable, Equatable, Sendable {
    var name: String?; var email: String?; var phone: String?; var countryCode: String?
    var city: String?; var postalCode: String?; var addressPart1: String?; var addressPart2: String?
}
struct Parcel: Codable, Equatable, Sendable { var weightGrams: Int; var lengthCm: Decimal; var widthCm: Decimal; var heightCm: Decimal }
struct ShipmentLine: Codable, Equatable, Identifiable, Sendable { var id: Int { orderLineId }; let orderLineId: Int; var quantity: Decimal }
struct Quote: Codable, Equatable, Sendable {
    let customerPriceAmount: Decimal; let currencyCode: String; let productCode: String; let fingerprint: String
    var display: String { "\(customerPriceAmount.formatted()) \(currencyCode)" }
}
struct Draft: Codable, Equatable, Sendable {
    var requestId: UUID; var carrierCode: String?; var deliveryMethod: String?; var recipient: Recipient
    var parcel: Parcel; var lines: [ShipmentLine]; var pickupProviderId: String?; var acceptedQuote: Quote?
}
struct ShippingService: Decodable, Identifiable, Sendable {
    var id: String { carrierCode + ":" + deliveryMethod }
    let carrierCode: String; let deliveryMethod: String; let carrierName: String; let name: String; let pickupRequired: Bool; let testMode: Bool
}
struct AvailableLine: Decodable, Identifiable, Sendable { var id: Int { orderLineId }; let orderLineId: Int; let name: String; let availableQuantity: Decimal }
struct ShipmentPage: Decodable, Sendable { let items: [ShipmentSummary]; let nextBeforeId: Int? }
struct ShipmentSummary: Decodable, Identifiable, Sendable { let id: Int; let orderId: Int; let status: String }
struct ShippingOptions: Decodable, Sendable {
    let orderId: Int; let canCreate: Bool; let unavailableReason: String?; let weightEstimated: Bool
    let services: [ShippingService]; let availableLines: [AvailableLine]; let defaults: Draft?; let existingShipments: ShipmentPage
}
struct Rate: Decodable, Identifiable, Sendable {
    var id: String { carrierCode + ":" + deliveryMethod }
    let carrierCode: String; let deliveryMethod: String; let status: String; let quote: Quote?
    let bookingBlockedReason: String?; let error: String?
}
struct Pickup: Decodable, Identifiable, Sendable { var id: String { providerId }; let providerId: String; let name: String; let displayName: String; let description: String }
struct QuoteResult: Decodable, Sendable {
    let status: String; let quote: Quote?; let pickupRequired: Bool; let pickupPlaces: [Pickup]
    let selectedPickupProviderId: String?; let bookingBlockedReason: String?; let error: String?
}
struct Shipment: Decodable, Sendable {
    let id: Int; let orderId: Int; let status: String; let checkoutManaged: Bool; let carrierCode: String; let recipient: Recipient; let parcel: Parcel
    let error: String?; let errorCode: String?; let labelAvailable: Bool; let actions: [String]
    let inventoryRecordingPending: Bool
    struct Charge: Decodable, Sendable { let amount: Decimal?; let currencyCode: String?; let recordingPending: Bool }
    let customerCharge: Charge
    var pending: Bool { status == "capture_pending" || status == "booking" }
}

extension ReAIAPI {
    func orders(token: String, company: Int, search: String, page: Int) async throws -> ReadyPage {
        try await json("api/orders/shipping-ready", token: token, company: company, query: [
            URLQueryItem(name: "search", value: search), URLQueryItem(name: "page", value: String(page))])
    }
    func history(token: String, company: Int, search: String, beforeId: Int?) async throws -> HistoryPage {
        let term = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !term.isEmpty {
            var orderId = Int(term)
            if let url = URLComponents(string: term), url.scheme != nil {
                guard url.scheme == "https", url.host == AppEnvironment.origin.host(),
                      url.path.hasPrefix("/order/"),
                      let id = Int(url.path.dropFirst("/order/".count)), id > 0 else {
                    throw appError("Paste a ReAI order link, order number or order ID.")
                }
                if let tenant = url.queryItems?.first(where: { $0.name == "tenantId" })?.value,
                   tenant != String(company) { throw appError("This order link belongs to another company. Connect to that company first.") }
                orderId = id
            }
            var rows: [HistoricalOrder] = []
            if let id = orderId, id > 0 {
                do { rows.append(try await json("api/orders/\(id)", token: token, company: company)) }
                catch let error as NSError where error.code == 404 { }
            }
            if !term.contains("://") {
                let matches: [HistoricalOrder] = try await json("api/orders", token: token, company: company, query: [
                    URLQueryItem(name: "status", value: "all"), URLQueryItem(name: "startDate", value: "0001-01-01"),
                    URLQueryItem(name: "endDate", value: "9999-12-31"), URLQueryItem(name: "orderNumber", value: term)])
                let known = Set(rows.map(\.id))
                rows += matches.filter { !known.contains($0.id) }
            }
            return HistoryPage(items: rows.map(\.row), nextBeforeId: nil)
        }
        let page = try await shipments(order: nil, beforeId: beforeId, token: token, company: company)
        let ids = Array(Set(page.items.map(\.orderId)))
        var rows: [ReadyOrder] = []
        // Bound concurrent lookups while browsing the shipment cursor.
        for offset in stride(from: 0, to: ids.count, by: 4) {
            let batch = Array(ids[offset..<min(offset + 4, ids.count)])
            let values = try await withThrowingTaskGroup(of: ReadyOrder.self) { group in
                for id in batch {
                    group.addTask {
                        let order: HistoricalOrder = try await self.json("api/orders/\(id)", token: token, company: company)
                        return order.row
                    }
                }
                var values: [ReadyOrder] = []
                for try await value in group { values.append(value) }
                return values
            }
            rows += values
        }
        let positions = Dictionary(page.items.reversed().map { ($0.orderId, $0.id) }, uniquingKeysWith: { _, latest in latest })
        rows.sort { positions[$0.id, default: 0] > positions[$1.id, default: 0] }
        return HistoryPage(items: rows, nextBeforeId: page.nextBeforeId)
    }
    func shipments(order: Int?, beforeId: Int? = nil, token: String, company: Int) async throws -> ShipmentPage {
        var query = [URLQueryItem(name: "limit", value: "50")]
        if let order { query.append(URLQueryItem(name: "orderId", value: String(order))) }
        if let beforeId { query.append(URLQueryItem(name: "beforeId", value: String(beforeId))) }
        return try await json("api/shipments", token: token, company: company, query: query)
    }
    func options(order: Int, token: String, company: Int) async throws -> ShippingOptions {
        try await json("api/orders/\(order)/shipping-options", token: token, company: company)
    }
    func rates(order: Int, draft: Draft, token: String, company: Int) async throws -> [Rate] {
        try await json("api/orders/\(order)/shipping-rates", token: token, company: company, body: JSONEncoder().encode(draft))
    }
    func quote(order: Int, draft: Draft, token: String, company: Int) async throws -> QuoteResult {
        try await json("api/orders/\(order)/shipping-quote", token: token, company: company, body: JSONEncoder().encode(draft))
    }
    func create(order: Int, draft: Draft, token: String, company: Int) async throws -> Shipment {
        struct Request: Encodable { let orderId: Int; let shipment: Draft }
        return try await json("api/shipments", token: token, company: company, body: JSONEncoder().encode(Request(orderId: order, shipment: draft)))
    }
    func shipment(_ id: Int, token: String, company: Int, book: Bool = false) async throws -> Shipment {
        try await json("api/shipments/\(id)" + (book ? "/book" : ""), token: token, company: company, body: book ? Data() : nil)
    }
    func cancel(_ id: Int, token: String, company: Int) async throws -> Shipment {
        try await json("api/shipments/\(id)/cancel", token: token, company: company, body: Data())
    }
    func find(requestId: UUID, token: String, company: Int) async throws -> Shipment? {
        do { return try await json("api/shipments/by-request-id/\(requestId.uuidString)", token: token, company: company) }
        catch let error as NSError where error.code == 404 { return nil }
    }
    private func json<T: Decodable & Sendable>(_ path: String, token: String, company: Int,
                query: [URLQueryItem] = [], body: Data? = nil) async throws -> T {
        var url = AppEnvironment.origin.appending(path: path)
        if !query.isEmpty { url.append(queryItems: query) }
        var request = URLRequest(url: url)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(String(company), forHTTPHeaderField: "X-Tenant-Id")
        request.setValue(Locale.preferredLanguages.first ?? "en", forHTTPHeaderField: "Accept-Language")
        let (data, raw) = try await session.data(for: request)
        guard let response = raw as? HTTPURLResponse else { throw appError("ReAI returned an invalid response.") }
        guard (200..<300).contains(response.statusCode) else {
            let detail = (try? JSONDecoder().decode(Problem.self, from: data))?.detail
            throw appError(detail ?? "The shipping operation failed. Refresh to check the current state.", code: response.statusCode)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
