import Foundation

enum AppEnvironment {
    static let origin = URL(string: "http://localhost:8080")!
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

struct Page<T: Decodable & Sendable>: Decodable, Sendable {
    let items: [T]
    let hasNext: Bool
}

actor ReAIAPI {
    private struct Problem: Decodable { let detail: String? }
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        session = URLSession(configuration: configuration, delegate: RedirectBlocker(), delegateQueue: nil)
    }

    func account(token: String) async throws -> Account {
        try await request("/api/me", token: token)
    }

    func list<T: Decodable & Sendable>(_ path: String, token: String, tenant: Int,
                                       query: [URLQueryItem] = []) async throws -> [T] {
        var items: [T] = []
        for page in 1...100 {
            let result: Page<T> = try await request(path, token: token, tenant: tenant, query: query + [
                URLQueryItem(name: "page", value: String(page)), URLQueryItem(name: "pageSize", value: "100")
            ])
            items += result.items
            if !result.hasNext { return items }
        }
        throw appError("Too many records to review in the local test company.")
    }

    func request<T: Decodable & Sendable>(_ path: String, token: String, tenant: Int? = nil,
                                         body: Data? = nil, query: [URLQueryItem] = []) async throws -> T {
        let data = try await response(path, token: token, tenant: tenant, body: body, query: query,
                                      accept: "application/json")
        return try JSONDecoder().decode(T.self, from: data)
    }

    func invoicePDF(id: Int, token: String, tenant: Int) async throws -> Data {
        try await response("/api/invoices/\(id)/pdf", token: token, tenant: tenant, accept: "application/pdf")
    }

    private func response(_ path: String, token: String, tenant: Int?, body: Data? = nil,
                          query: [URLQueryItem] = [], accept: String) async throws -> Data {
        let url = AppEnvironment.origin.appending(path: path).appending(queryItems: query)
        var request = URLRequest(url: url)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.httpBody = body
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("en", forHTTPHeaderField: "Accept-Language")
        request.setValue(accept, forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let tenant { request.setValue(String(tenant), forHTTPHeaderField: "X-Tenant-Id") }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, data.count <= 10_000_000 else {
            throw appError("Invalid or oversized response from localhost ReAI.")
        }
        guard (200..<300).contains(http.statusCode) else {
            let detail = (try? JSONDecoder().decode(Problem.self, from: data))?.detail
            throw appError(detail ?? "Local ReAI returned HTTP \(http.statusCode) for \(path).")
        }
        return data
    }
}
