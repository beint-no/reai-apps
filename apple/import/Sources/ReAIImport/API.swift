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
    func existing(kind: ImportKind, token: String, company: Int) async throws -> ExistingSnapshot {
        var snapshot = ExistingSnapshot()
        for archived in ["false", "true"] {
            let records: [ExistingRecord] = try await request("api/\(kind.rawValue)", token: token, company: company, query: [URLQueryItem(name: "archived", value: archived)])
            for record in records { snapshot.keys.formUnion(record.keys); snapshot.ids.insert(record.id) }
        }
        return snapshot
    }
}
actor ImportJournal {
    private struct Progress: Codable { let batchID: UUID; let row: ImportRow }
    private let file: URL
    private var activeID: UUID?
    private var progressFile: URL { file.appendingPathExtension("progress") }
    init(file: URL? = nil) {
        self.file = file ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "ReAI Import", directoryHint: .isDirectory).appending(path: "last-import.json")
    }
    func save(_ batch: ImportBatch) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.deletingLastPathComponent().path)
        try JSONEncoder().encode(batch).write(to: file, options: [.atomic])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }
        try handle.synchronize()
        if FileManager.default.fileExists(atPath: progressFile.path) { try FileManager.default.removeItem(at: progressFile) }
        activeID = batch.id
    }
    func record(_ row: ImportRow, batchID: UUID) throws {
        guard activeID == batchID else { throw appError("The local import record changed. Reopen the app before continuing.") }
        if !FileManager.default.fileExists(atPath: progressFile.path) {
            guard FileManager.default.createFile(atPath: progressFile.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw appError("Could not save import progress.") }
        }
        var data = try JSONEncoder().encode(Progress(batchID: batchID, row: row)); data.append(10)
        let handle = try FileHandle(forWritingTo: progressFile)
        defer { try? handle.close() }
        try handle.seekToEnd(); try handle.write(contentsOf: data); try handle.synchronize()
    }
    func load() throws -> ImportBatch? {
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        var batch = try JSONDecoder().decode(ImportBatch.self, from: Data(contentsOf: file))
        guard Set(batch.rows.map(\.line)).count == batch.rows.count else { throw appError("The saved import report is invalid.") }
        let indices = Dictionary(uniqueKeysWithValues: batch.rows.enumerated().map { ($0.element.line, $0.offset) })
        if FileManager.default.fileExists(atPath: progressFile.path) {
            let data = try Data(contentsOf: progressFile)
            var lines = data.split(separator: 10, omittingEmptySubsequences: false)
            if !lines.isEmpty { lines.removeLast() }
            for line in lines where !line.isEmpty {
                let progress = try JSONDecoder().decode(Progress.self, from: Data(line))
                if progress.batchID == batch.id, let index = indices[progress.row.line] { batch.rows[index] = progress.row }
            }
        }
        for i in batch.rows.indices where batch.rows[i].state == .sending {
            batch.rows[i].state = .uncertain
            batch.rows[i].detail = "The app closed during this request. Check ReAI before importing this row again."
        }
        activeID = batch.id
        return batch
    }
    func clear() throws {
        for url in [file, progressFile] where FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        activeID = nil
    }
}
