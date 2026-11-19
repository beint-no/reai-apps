import Foundation

func appError(_ message: String) -> NSError {
    NSError(domain: "no.reai.receiptprinter", code: 0, userInfo: [NSLocalizedDescriptionKey: message])
}

enum AppEnvironment { static let origin = URL(string: "https://app.reai.no")! }

final class RedirectBlocker: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct Company: Decodable, Sendable {
    let id: Int
    let companyName: String
}

struct Receipt: Decodable, Identifiable, Sendable {
    struct Line: Decodable, Identifiable, Sendable {
        let rowNumber: Int
        let productText: String
        let quantity: Decimal
        let grossAmount: Decimal
        var id: Int { rowNumber }
    }
    let id: Int64
    let cashPointId: Int
    let receiptNumber: String
    let type: String
    let occurredAt: Date
    let currencyCode: String?
    let grossAmount: Decimal
    let lines: [Line]

    var isSale: Bool { type == "sale" }
    var displayDate: String {
        var format = Date.FormatStyle(date: .abbreviated, time: .shortened)
        format.timeZone = ReceiptSearch.oslo
        return occurredAt.formatted(format)
    }
    func amount(_ amount: Decimal) -> String {
        if let currencyCode { return amount.formatted(.currency(code: currencyCode)) }
        return amount.formatted() + " (currency unknown)"
    }
}

struct ReceiptSearch: Equatable, Sendable {
    static let oslo = TimeZone(identifier: "Europe/Oslo")!
    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = oslo
        return calendar
    }
    let day: Date
    let number: String
    let cashPoint: Int?

    func parameters(page: Int) -> [URLQueryItem] {
        let interval = Self.calendar.dateInterval(of: .day, for: day)!
        var result = [
            URLQueryItem(name: "startAt", value: interval.start.ISO8601Format()),
            URLQueryItem(name: "endAt", value: interval.end.ISO8601Format()),
            URLQueryItem(name: "page", value: String(page)),
            URLQueryItem(name: "pageSize", value: "50"),
        ]
        if !number.isEmpty { result.append(URLQueryItem(name: "receiptNumber", value: number)) }
        if let cashPoint { result.append(URLQueryItem(name: "cashPointId", value: String(cashPoint))) }
        return result
    }
}

struct ReceiptPage: Decodable, Sendable {
    let items: [Receipt]
    let hasNext: Bool
}

actor ReAIAPI {
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 40
        return URLSession(configuration: config, delegate: RedirectBlocker(), delegateQueue: nil)
    }()

    func account(token: String) async throws -> Company {
        struct Account: Decodable { let tenants: [Company] }
        let account: Account = try await get("api/me", token: token)
        guard account.tenants.count == 1, let company = account.tenants.first else {
            throw appError("Connect again and choose one company in ReAI.")
        }
        return company
    }

    func receipts(_ search: ReceiptSearch, page: Int, token: String, company: Int) async throws -> ReceiptPage {
        try await get("api/kassasystem/sales", token: token, company: company, query: search.parameters(page: page))
    }

    private func get<T: Decodable>(_ path: String, token: String, company: Int? = nil, query: [URLQueryItem] = []) async throws -> T {
        var request = URLRequest(url: AppEnvironment.origin.appending(path: path).appending(queryItems: query))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("en", forHTTPHeaderField: "Accept-Language")
        if let company { request.setValue(String(company), forHTTPHeaderField: "X-Tenant-Id") }
        let (data, raw) = try await session.data(for: request)
        guard let response = raw as? HTTPURLResponse else { throw appError("ReAI returned an invalid response.") }
        switch response.statusCode {
        case 200: break
        case 401: throw appError("Your connection has expired. Disconnect and connect to ReAI again.")
        case 403: throw appError("You need permission to read cash register sales in this company.")
        default: throw appError("Could not load receipts from ReAI. Try again.")
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = (try? Date(raw, strategy: .iso8601)) ?? (try? Date(raw, strategy: .iso8601.time(includingFractionalSeconds: true))) {
                return date
            }
            throw appError("ReAI returned an invalid receipt date.")
        }
        return try decoder.decode(T.self, from: data)
    }
}
