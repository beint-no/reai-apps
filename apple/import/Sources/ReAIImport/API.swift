import Foundation

final class RedirectBlocker: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
actor ReAIAPI {
    private struct Problem: Decodable { let detail: String? }
    private let session: URLSession
    init(configuration: URLSessionConfiguration = .ephemeral) {
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        session = URLSession(configuration: configuration, delegate: RedirectBlocker(), delegateQueue: nil)
    }
    func request<T: Decodable & Sendable>(_ path: String, token: String, company: Int? = nil, body: Data? = nil,
                                          query: [URLQueryItem] = []) async throws -> T {
        var request = URLRequest(url: AppEnvironment.origin.appending(path: path).appending(queryItems: query))
        request.httpMethod = body == nil ? "GET" : "POST"; request.httpBody = body
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let company { request.setValue(String(company), forHTTPHeaderField: "X-Tenant-Id") }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw appError("ReAI returned an invalid response.") }
        guard (200..<300).contains(response.statusCode) else {
            let detail = (try? JSONDecoder().decode(Problem.self, from: data))?.detail
            let message = switch response.statusCode {
            case 401: "Your connection expired or was revoked. Connect to ReAI again."
            case 403: "Your ReAI account needs read and write permission for this type of record."
            case 429: "ReAI is limiting requests. Wait before continuing."
            default: detail ?? "ReAI returned HTTP \(response.statusCode)."
            }
            throw appError(message, code: response.statusCode)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
    func existing(kind: ImportKind, token: String, company: Int) async throws -> Set<String> {
        var keys = Set<String>()
        for archived in ["false", "true"] {
            let records: [ExistingRecord] = try await request("api/\(kind.rawValue)", token: token, company: company, query: [URLQueryItem(name: "archived", value: archived)])
            for record in records { keys.formUnion(record.keys) }
        }
        return keys
    }
}
actor ImportJournal {
    private let file: URL
    init(file: URL? = nil) {
        self.file = file ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "ReAI Import", directoryHint: .isDirectory).appending(path: "last-import.json")
    }
    func save(_ batch: ImportBatch) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.deletingLastPathComponent().path)
        try JSONEncoder().encode(batch).write(to: file, options: [.atomic])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
    func load() throws -> ImportBatch? {
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        var batch = try JSONDecoder().decode(ImportBatch.self, from: Data(contentsOf: file))
        for i in batch.rows.indices where batch.rows[i].state == .sending {
            batch.rows[i].state = .uncertain
            batch.rows[i].detail = "The app closed during this request. Check ReAI before importing this row again."
        }
        return batch
    }
    func clear() throws {
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
}
