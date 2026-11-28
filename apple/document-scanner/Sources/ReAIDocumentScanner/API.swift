import Foundation
import Security
import UniformTypeIdentifiers

enum TokenStore {
    private static func query(_ service: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "access-token"]
    }

    static func read(service: String = AppEnvironment.keychainService) -> String? {
        var request = query(service)
        request[kSecReturnData as String] = true
        var result: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ token: String) throws {
        let values = [kSecValueData as String: Data(token.utf8)]
        var status = SecItemUpdate(query(AppEnvironment.keychainService) as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            var request = query(AppEnvironment.keychainService).merging(values) { _, new in new }
            request[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(request as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw appError("Could not save the token in Keychain (\(status)).") }
    }

    static func delete() { SecItemDelete(query(AppEnvironment.keychainService) as CFDictionary) }
}

final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// ReAI answered that it did not create the document, so trying again cannot duplicate it.
struct UploadRejected: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

actor ReAIAPI {
    private let session: URLSession
    private let base = AppEnvironment.baseURL

    init(configuration: URLSessionConfiguration = .ephemeral) {
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 300
        configuration.httpMaximumConnectionsPerHost = 2
        session = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }

    private func request(_ path: String, token: String, company: Int? = nil) -> URLRequest {
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("en", forHTTPHeaderField: "Accept-Language")
        if let company { request.setValue(String(company), forHTTPHeaderField: "X-Tenant-Id") }
        return request
    }

    private func check(_ response: URLResponse, data: Data) throws {
        guard let response = response as? HTTPURLResponse else { throw appError("Invalid server response.") }
        guard !(200..<300).contains(response.statusCode) else { return }
        struct Problem: Decodable { let detail: String? }
        let detail = (try? JSONDecoder().decode(Problem.self, from: data))?.detail
        let message = switch response.statusCode {
        case 401: "Your access token has expired or is invalid. Reconnect in Settings."
        case 403: detail ?? "This token does not have permission for this company or destination."
        case 413: "This file exceeds the server upload limit."
        case 405: "This upload destination is unavailable. Choose another destination or contact ReAI support."
        default: detail ?? "ReAI returned HTTP \(response.statusCode)."
        }
        // Client errors are definite answers. Timeouts, rate limits and server errors leave the outcome unknown.
        if (400..<500).contains(response.statusCode), ![408, 429].contains(response.statusCode) {
            throw UploadRejected(message: message)
        }
        throw appError(message)
    }

    func account(token: String) async throws -> Account {
        let (data, response) = try await session.data(for: request("api/me", token: token))
        try check(response, data: data)
        return try JSONDecoder().decode(Account.self, from: data)
    }

    /// Sends one file as multipart `files`. The reception endpoints return the created documents.
    func upload(_ transfer: Transfer, token: String) async throws -> Int {
        let boundary = UUID().uuidString
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        FileManager.default.createFile(atPath: temporary.path, contents: nil, attributes: [.posixPermissions: 0o600])
        defer { try? FileManager.default.removeItem(at: temporary) }
        let output = try FileHandle(forWritingTo: temporary)
        defer { try? output.close() }
        let filename = transfer.filename.replacingOccurrences(of: "\"", with: "_")
            .replacingOccurrences(of: "\r", with: "_").replacingOccurrences(of: "\n", with: "_")
        let mime = UTType(filenameExtension: transfer.file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        try output.write(contentsOf: Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"files\"; filename=\"\(filename)\"\r\nContent-Type: \(mime)\r\n\r\n".utf8))
        let input = try FileHandle(forReadingFrom: transfer.file)
        defer { try? input.close() }
        while let chunk = try input.read(upToCount: 262_144), !chunk.isEmpty {
            try Task.checkCancellation()
            try output.write(contentsOf: chunk)
        }
        try output.write(contentsOf: Data("\r\n--\(boundary)--\r\n".utf8))
        var request = request(transfer.destination.endpoint, token: token, company: transfer.company.id)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await session.upload(for: request, fromFile: temporary)
        try check(response, data: data)
        struct Created: Decodable { let id: Int }
        guard let created = try JSONDecoder().decode([Created].self, from: data).first else {
            throw appError("ReAI accepted the upload but did not return a document ID.")
        }
        return created.id
    }
}
