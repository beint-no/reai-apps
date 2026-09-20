import Foundation
import Security
import UniformTypeIdentifiers

enum TokenStore {
    static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: VaultEnvironment.keychainService, kSecAttrAccount as String: "access-token"] }

    static func read() -> String? {
        var request = query
        request[kSecReturnData as String] = true
        var result: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ token: String) throws {
        let values = [kSecValueData as String: Data(token.utf8)]
        var status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            var request = query.merging(values) { _, new in new }
            request[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(request as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw vaultError("Could not save the token in Keychain (\(status)).") }
    }

    static func delete() { SecItemDelete(query as CFDictionary) }
}

final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

actor ReAIAPI {
    private let session: URLSession
    private let base = VaultEnvironment.baseURL

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
        if let company { request.setValue(String(company), forHTTPHeaderField: "X-Tenant-Id") }
        return request
    }

    private func check(_ response: URLResponse) throws {
        guard let response = response as? HTTPURLResponse else { throw vaultError("Invalid server response.") }
        guard (200..<300).contains(response.statusCode) else {
            switch response.statusCode {
            case 401: throw vaultError("Your access token has expired or is invalid. Reconnect in Settings.")
            case 403: throw vaultError("This token does not have permission for this company or destination.")
            case 413: throw vaultError("This file exceeds the server upload limit.")
            case 405: throw vaultError("This upload destination is unavailable. Choose another destination or contact ReAI support.")
            default: throw vaultError("ReAI returned HTTP \(response.statusCode).")
            }
        }
    }

    func account(token: String) async throws -> Account {
        let (data, response) = try await session.data(for: request("api/me", token: token))
        try check(response)
        return try JSONDecoder().decode(Account.self, from: data)
    }

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
        try check(response)
        struct Created: Decodable { let id: Int }
        guard let created = try JSONDecoder().decode([Created].self, from: data).first else {
            throw vaultError("ReAI accepted the upload but did not return a document ID.")
        }
        return created.id
    }
}
