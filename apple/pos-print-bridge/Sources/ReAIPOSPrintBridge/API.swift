import Foundation

final class RedirectBlocker: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

enum AppEnvironment {
    static let origin = URL(string: "https://app.reai.no")!
}

func appError(_ text: String, code: Int = 0) -> NSError {
    NSError(domain: "no.reai.posprintbridge", code: code, userInfo: [NSLocalizedDescriptionKey: text])
}

private struct Problem: Decodable { let detail: String? }
struct Company: Codable, Equatable, Sendable { let id: Int; let companyName: String; let currencyCode: String }
struct SalesPage: Decodable, Sendable { let items: [Sale]; let hasNext: Bool }
/// A response body together with the server's clock, so receipt windows never depend on this computer's time.
struct Timed<Value: Sendable>: Sendable { let value: Value; let serverDate: Date }

/// Public API client. Every call is a read; the bridge never writes to ReAI.
actor ReAIAPI {
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        return URLSession(configuration: config, delegate: RedirectBlocker(), delegateQueue: nil)
    }()

    func company(token: String) async throws -> Company {
        struct Me: Decodable { let tenants: [Company] }
        let me: Me = try await get("api/me", token: token, company: nil).value
        guard me.tenants.count == 1, let company = me.tenants.first else {
            throw appError("Connect again and choose one company in ReAI.")
        }
        return company
    }

    func merchant(token: String, company: Int) async throws -> Merchant {
        struct Address: Decodable { let addressPart1: String; let addressPart2: String?; let postalCode: String?; let city: String }
        struct Registry: Decodable { let name: String; let organizationNumber: String?; let companyTypeCode: String?; let address: Address? }
        struct Settings: Decodable { let company: Registry; let vatRegistered: Bool }
        let settings: Settings = try await get("api/company-settings", token: token, company: company).value
        let address = settings.company.address.map { address in
            [address.addressPart1, address.addressPart2 ?? "",
             [address.postalCode ?? "", address.city].filter { !$0.isEmpty }.joined(separator: " ")].filter { !$0.isEmpty }
        } ?? []
        return Merchant(name: settings.company.name, organizationNumber: settings.company.organizationNumber,
                        vatRegistered: settings.vatRegistered, companyTypeCode: settings.company.companyTypeCode, address: address)
    }

    func vatRates(token: String, company: Int) async throws -> [String: Decimal] {
        struct Code: Decodable { let code: String; let rate: Decimal }
        let codes: [Code] = try await get("api/vat-codes", token: token, company: company).value
        return Dictionary(codes.map { ($0.code, $0.rate) }, uniquingKeysWith: { first, _ in first })
    }

    /// One page of receipts from `startAt` (inclusive), ordered by journal ID.
    func sales(token: String, company: Int, startAt: Date, cashPoint: Int?, page: Int) async throws -> Timed<SalesPage> {
        var query = [URLQueryItem(name: "startAt", value: Self.instant(startAt)),
                     URLQueryItem(name: "page", value: String(page)), URLQueryItem(name: "pageSize", value: "100")]
        if let cashPoint { query.append(URLQueryItem(name: "cashPointId", value: String(cashPoint))) }
        return try await get("api/kassasystem/sales", token: token, company: company, query: query)
    }

    func sale(_ id: Int64, token: String, company: Int) async throws -> Sale {
        try await get("api/kassasystem/sales/\(id)", token: token, company: company).value
    }

    static func instant(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private func get<T: Decodable & Sendable>(_ path: String, token: String, company: Int?, query: [URLQueryItem] = []) async throws -> Timed<T> {
        var url = AppEnvironment.origin.appending(path: path)
        if !query.isEmpty { url.append(queryItems: query) }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("en", forHTTPHeaderField: "Accept-Language")
        if let company { request.setValue(String(company), forHTTPHeaderField: "X-Tenant-Id") }
        let (data, raw) = try await session.data(for: request)
        guard let response = raw as? HTTPURLResponse else { throw appError("ReAI returned an invalid response.") }
        guard (200..<300).contains(response.statusCode) else {
            let detail = (try? JSONDecoder().decode(Problem.self, from: data))?.detail
            switch response.statusCode {
            case 401: throw appError("Your connection has expired. Disconnect and connect to ReAI again.", code: 401)
            case 403: throw appError(detail ?? "Your ReAI user needs kassasystem read and company read permission.", code: 403)
            default: throw appError(detail ?? "ReAI could not be reached (\(response.statusCode)). Retrying.", code: response.statusCode)
            }
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        let serverDate = response.value(forHTTPHeaderField: "Date").flatMap(formatter.date(from:)) ?? .now
        return Timed(value: try JSONDecoder().decode(T.self, from: data), serverDate: serverDate)
    }
}
