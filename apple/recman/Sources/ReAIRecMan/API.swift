import Foundation

struct ReAIServer: Equatable, Sendable {
    static let localDefault = ReAIServer(url: URL(string: "http://localhost:8080")!, isProduction: false)

    let url: URL
    let isProduction: Bool

    var displayName: String { isProduction ? "Production · \(url.absoluteString)" : url.absoluteString }
    var credentialAccount: String {
        self == Self.localDefault ? "reai-access-token" : "reai-access-token:\(url.absoluteString)"
    }

    private init(url: URL, isProduction: Bool) {
        self.url = url
        self.isProduction = isProduction
    }

    init(_ input: String) throws {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parts = URLComponents(string: text), let scheme = parts.scheme?.lowercased(),
              let host = parts.host?.lowercased(), parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil, ["", "/"].contains(parts.percentEncodedPath) else {
            throw appError("Enter a ReAI root URL, such as http://localhost:8080 or https://app.reai.no.")
        }

        let isProduction = host == "app.reai.no" && scheme == "https" && (parts.port == nil || parts.port == 443)
        let isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host) &&
            ["https", "http"].contains(scheme)
        guard isProduction || isLocal else {
            throw appError("Use a local loopback URL or https://app.reai.no.")
        }
        if let port = parts.port, !(1...65535).contains(port) {
            throw appError("Enter a port between 1 and 65535.")
        }

        let hostname = host == "::1" ? "[::1]" : host
        let defaultPort = scheme == "https" ? 443 : 80
        let port = parts.port.flatMap { $0 == defaultPort ? nil : ":\($0)" } ?? ""
        guard let url = URL(string: "\(scheme)://\(hostname)\(port)") else {
            throw appError("Enter a valid ReAI root URL.")
        }
        self.init(url: url, isProduction: isProduction)
    }
}

struct AppError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

func appError(_ message: String) -> AppError { AppError(message: message) }

final class RedirectBlocker: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct Company: Decodable, Equatable, Identifiable, Sendable {
    let id: Int
    let companyName: String
    let slug: String
    let currencyCode: String
}

struct Account: Decodable, Sendable { let tenants: [Company] }

private struct ReAIPage<Item: Decodable & Sendable>: Decodable, Sendable { let items: [Item]; let hasNext: Bool }

actor ReAIAPI {
    private struct Problem: Decodable { let detail: String? }
    nonisolated let server: ReAIServer
    private let session: URLSession

    init(server: ReAIServer) {
        self.server = server
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        session = URLSession(configuration: configuration, delegate: RedirectBlocker(), delegateQueue: nil)
    }

    func account(token: String) async throws -> Account {
        try await request("/api/me", token: token)
    }

    func request<T: Decodable & Sendable>(_ path: String, token: String, tenant: Int? = nil,
                                         body: Data? = nil, query: [URLQueryItem] = []) async throws -> T {
        let data = try await response(path, token: token, tenant: tenant, body: body, query: query)
        return try JSONDecoder().decode(T.self, from: data)
    }

    func list<T: Decodable & Sendable>(_ path: String, token: String, tenant: Int,
                                      query: [URLQueryItem] = []) async throws -> [T] {
        var items: [T] = []
        for page in 1...100 {
            let result: ReAIPage<T> = try await request(path, token: token, tenant: tenant, query: query + [
                URLQueryItem(name: "page", value: String(page)), URLQueryItem(name: "pageSize", value: "100")
            ])
            items += result.items
            if !result.hasNext { return items }
        }
        throw appError("ReAI returned too many records to review.")
    }

    private func response(_ path: String, token: String, tenant: Int?, body: Data?,
                          query: [URLQueryItem]) async throws -> Data {
        let url = server.url.appending(path: path).appending(queryItems: query)
        var request = URLRequest(url: url)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.httpBody = body
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("en", forHTTPHeaderField: "Accept-Language")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let tenant { request.setValue(String(tenant), forHTTPHeaderField: "X-Tenant-Id") }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, data.count <= 10_000_000 else {
            throw appError("Invalid or oversized response from ReAI.")
        }
        guard (200..<300).contains(http.statusCode) else {
            let detail = (try? JSONDecoder().decode(Problem.self, from: data))?.detail
            throw appError(detail ?? "ReAI returned HTTP \(http.statusCode) for \(path).")
        }
        return data
    }
}
