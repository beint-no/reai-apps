import CryptoKit
import Darwin
import Foundation

final class Journal {
    private struct Receipt: Codable {
        let endpoint: String
        let requestDigest: String
        var resultID: Int?
    }

    private let lock: FileHandle
    private let file: URL
    private var receipts: [String: Receipt]

    init(server: ReAIServer, tenant: Company, directory: URL? = nil) throws {
        let root = directory ?? URL.applicationSupportDirectory.appending(path: "ReAIRecMan", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        // The original journal namespace was used exclusively by the default local server.
        let serverPrefix = server == .localDefault ? "" : "\(server.url.absoluteString):"
        let identity = Data("\(serverPrefix)\(tenant.id):\(tenant.slug)".utf8)
        let name = SHA256.hash(data: identity).description.replacingOccurrences(of: "SHA256 digest: ", with: "")
        file = root.appending(path: "\(name).json")
        let descriptor = open(root.appending(path: "\(name).lock").path, O_WRONLY | O_CREAT | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { throw appError("Could not open the local operation lock.") }
        lock = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            throw appError("Another ReAI RecMan window is reviewing or importing into this company.")
        }
        do {
            receipts = try JSONDecoder().decode([String: Receipt].self, from: Data(contentsOf: file))
        } catch CocoaError.fileReadNoSuchFile {
            receipts = [:]
        }
        if let pending = receipts.first(where: { $0.value.resultID == nil }) {
            throw appError("Unverified write (\(pending.key)). Reconcile it on the selected ReAI server before continuing.")
        }
    }

    func result(for key: String) -> Int? { receipts[key]?.resultID }

    func verifiedResult(for key: String, endpoint: String, body: Data) throws -> Int? {
        guard let receipt = receipts[key] else { return nil }
        guard receipt.endpoint == endpoint, receipt.requestDigest == SHA256.hash(data: body).description,
              let id = receipt.resultID else {
            throw appError("The saved order differs from this preview. Review it in ReAI before importing.")
        }
        return id
    }

    func advanceCheckpoint(_ key: String, through id: Int) throws {
        guard id > (result(for: key) ?? 0) else { return }
        receipts[key] = Receipt(endpoint: "checkpoint", requestDigest: "", resultID: id)
        try save()
    }

    func begin(_ key: String, endpoint: String, body: Data) throws {
        guard receipts[key] == nil else { throw appError("This operation already has a receipt.") }
        receipts[key] = Receipt(endpoint: endpoint, requestDigest: SHA256.hash(data: body).description)
        try save()
    }

    func complete(_ key: String, id: Int) throws {
        receipts[key]?.resultID = id
        try save()
    }

    func reject(_ key: String) throws {
        guard let pending = receipts[key], pending.resultID == nil else {
            throw appError("The rejected write has no pending receipt.")
        }
        receipts[key] = nil
        do {
            try save()
        } catch {
            receipts[key] = pending
            throw error
        }
    }

    private func save() throws {
        try JSONEncoder().encode(receipts).write(to: file, options: .atomic)
    }
}
