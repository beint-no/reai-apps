import Foundation
import Security

actor Credentials {
    private static let service = "no.reai.posprintbridge"
    private let identity: [String: String] = [
        kSecClass as String: kSecClassGenericPassword as String,
        kSecAttrService as String: Credentials.service,
        kSecAttrAccount as String: "reai-access-token"
    ]

    /// Whether a connection is stored, without reading the token.
    nonisolated static func stored() -> Bool {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecAttrAccount as String: "reai-access-token", kSecReturnAttributes as String: true]
        return SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess
    }

    func load() throws -> String? {
        var query: [String: Any] = identity
        query[kSecReturnData as String] = true
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data,
              let token = String(data: data, encoding: .utf8) else {
            throw appError("Could not read the ReAI connection from Keychain." + " (\(status))")
        }
        return token
    }

    func save(_ token: String) throws {
        let value = [kSecValueData as String: Data(token.utf8)]
        var status = SecItemUpdate(identity as CFDictionary, value as CFDictionary)
        if status == errSecItemNotFound {
            var item: [String: Any] = identity
            item[kSecValueData as String] = Data(token.utf8)
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw appError("Could not save your connection in Keychain." + " (\(status))") }
    }

    func delete() throws {
        let status = SecItemDelete(identity as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw appError("Could not remove your connection from Keychain." + " (\(status))")
        }
    }
}
