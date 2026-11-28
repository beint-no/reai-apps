import Foundation

/// One fiscal receipt the bridge has seen. Its state survives restarts so receipts are neither printed twice nor skipped.
struct ReceiptRecord: Codable, Equatable, Identifiable, Sendable {
    enum State: String, Codable, Sendable {
        /// Waiting for the printer. Nothing has been sent yet.
        case pending
        /// Saved before sending; found on launch only if the app stopped mid-print.
        case printing
        case printed
        /// Bytes may have reached the printer. Only printed again after explicit confirmation.
        case uncertain
        /// The receipt cannot be laid out from ReAI's data. Never printed automatically.
        case blocked
        /// Older than 24 hours when the printer became available. Print manually if still needed.
        case skipped
    }
    enum CopyState: String, Codable, Sendable { case printing, printed, uncertain }

    let id: Int64
    let tenantId: Int
    let cashPointId: Int
    let receiptNumber: String
    let type: String
    let occurredAt: String
    let grossAmount: Decimal
    let cash: Bool
    var state: State
    var detail: String?
    var attempts = 0
    var updatedAt: Date
    /// At most one copy per receipt (kassasystemforskriften § 2-6).
    var copy: CopyState?

    var date: Date { ReceiptRenderer.parseInstant(occurredAt) ?? .distantPast }
}

struct BridgeState: Codable, Equatable, Sendable {
    var version = 1
    var tenantId: Int?
    var allCashPoints = false
    var cashPoints: [Int] = []
    /// Cash point ID to the latest receipt seen there, as a hint for choosing.
    var knownCashPoints: [String: String] = [:]
    /// Selection key to the server time it was chosen. Receipts before it are history and never printed.
    var baselines: [String: Date] = [:]
    /// Selection key to the next poll's inclusive start.
    var cursors: [String: Date] = [:]
    var receipts: [ReceiptRecord] = []
    var printer = PrinterSettings()
    var openDrawerForCash = true
    var printQRCode = true
    var paused = false
}

/// Private JSON ledger in Application Support. Written atomically after every state change.
struct Ledger: Sendable {
    static var directory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "ReAI POS Print Bridge")
    }
    var file: URL { Self.directory.appending(path: "bridge.json") }

    func load() throws -> BridgeState {
        guard FileManager.default.fileExists(atPath: file.path) else { return BridgeState() }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(BridgeState.self, from: Data(contentsOf: file))
    }

    func save(_ state: BridgeState) throws {
        try FileManager.default.createDirectory(at: Self.directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(state).write(to: file, options: [.atomic])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
}
