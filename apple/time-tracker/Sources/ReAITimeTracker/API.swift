import Foundation

final class RedirectBlocker: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

actor ReAIAPI {
    private struct Problem: Decodable { let detail: String? }
    private let session: URLSession

    init(configuration: URLSessionConfiguration = .ephemeral) {
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        session = URLSession(configuration: configuration, delegate: RedirectBlocker(), delegateQueue: nil)
    }

    func request<T: Decodable & Sendable>(_ path: String, token: String, company: Int? = nil,
                                         body: Data? = nil) async throws -> T {
        var request = URLRequest(url: AppEnvironment.origin.appending(path: path))
        request.httpMethod = body == nil ? "GET" : "POST"
        request.httpBody = body
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let company { request.setValue(String(company), forHTTPHeaderField: "X-Tenant-Id") }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw appError("ReAI returned an invalid response.") }
        guard (200..<300).contains(response.statusCode) else {
            let detail = (try? JSONDecoder().decode(Problem.self, from: data))?.detail
            let message: String
            switch response.statusCode {
            case 401: message = "Your connection is no longer valid. Disconnect and connect to ReAI again."
            case 403: message = "Your account does not have permission for this action in the selected company."
            case 409: message = detail ?? "A timer is already running, time tracking is disabled, or your account has no linked employee. Refresh to check."
            default: message = detail ?? "ReAI returned HTTP \(response.statusCode). Try again."
            }
            throw appError(message, code: response.statusCode)
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            if let date = try? Date(text, strategy: .iso8601.time(includingFractionalSeconds: true)) { return date }
            return try Date(text, strategy: .iso8601)
        }
        return try decoder.decode(T.self, from: data)
    }
}
