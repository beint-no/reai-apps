import Foundation

struct CopyAttempt: Codable {
    enum Status: String, Codable { case checkQueue, sentToQueue, printed }

    let requestID: UUID
    let message: String
    var status: Status
}

struct CopyAttempts {
    private var entries: [String: CopyAttempt]
    private let file: URL

    init() throws {
        let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true).appending(path: "ReAI Receipt Printer", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        file = directory.appending(path: "copy-attempts.json")
        do {
            entries = try JSONDecoder().decode([String: CopyAttempt].self, from: Data(contentsOf: file))
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            entries = [:]
        }
    }

    func find(company: Int, receipt: Int64) -> CopyAttempt? {
        entries["\(company)/\(receipt)"]
    }

    mutating func save(_ attempt: CopyAttempt, company: Int, receipt: Int64) throws {
        var updated = entries
        updated["\(company)/\(receipt)"] = attempt
        try JSONEncoder().encode(updated).write(to: file, options: .atomic)
        entries = updated
    }
}
