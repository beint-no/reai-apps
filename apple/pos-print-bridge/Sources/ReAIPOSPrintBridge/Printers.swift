import Foundation
import Network

enum PrinterKind: String, Codable, CaseIterable, Sendable { case network, installed }

struct PrinterSettings: Codable, Equatable, Sendable {
    var kind: PrinterKind = .network
    var host = ""
    var port = 9100
    var queue = ""
    /// 80 mm rolls print 48 columns, 58 mm rolls 32 columns (Font A).
    var paperWidth = 80
    var columns: Int { paperWidth == 58 ? 32 : 48 }
    var configured: Bool { kind == .network ? Self.validHost(host) && (1...65535).contains(port) : !queue.isEmpty }
    var title: String { kind == .network ? "\(host):\(port)" : queue }

    static func validHost(_ host: String) -> Bool {
        host.range(of: #"^[A-Za-z0-9.:\-\[\]%]{1,253}$"#, options: .regularExpression) != nil
    }
}

/// What is known about a print job after it was handed over.
enum SendOutcome: Sendable, Equatable {
    /// The printer or macOS queue accepted every byte.
    case sent
    /// Nothing reached the printer, so sending again cannot duplicate a receipt.
    case notSent(String)
    /// Some bytes may have reached the printer. Never retried automatically.
    case uncertain(String)
}

/// Sends raw ESC/POS bytes: TCP port 9100 for network printers, `lp -o raw` for installed macOS queues.
actor RawPrinter {
    func send(_ data: Data, to settings: PrinterSettings) async -> SendOutcome {
        guard settings.configured else { return .notSent("Choose a receipt printer in Settings.") }
        switch settings.kind {
        case .network: return await sendTCP(data, host: settings.host, port: settings.port)
        case .installed: return await sendQueue(data, queue: settings.queue)
        }
    }

    func queues() async -> [String] {
        guard let (status, output) = try? await run("/usr/bin/lpstat", ["-e"]), status == 0 else { return [] }
        return output.split(separator: "\n").map(String.init)
            .filter { $0.range(of: "^[A-Za-z0-9_.@-]+$", options: .regularExpression) != nil }
    }

    private func sendTCP(_ data: Data, host: String, port: Int) async -> SendOutcome {
        let trimmed = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        let connection = NWConnection(host: NWEndpoint.Host(trimmed), port: NWEndpoint.Port(rawValue: UInt16(port))!, using: .tcp)
        let queue = DispatchQueue(label: "no.reai.posprintbridge.tcp")
        let gate = Gate()
        return await withCheckedContinuation { (continuation: CheckedContinuation<SendOutcome, Never>) in
            let finish: @Sendable (SendOutcome) -> Void = { outcome in
                if gate.claim() { connection.cancel(); continuation.resume(returning: outcome) }
            }
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    gate.markStarted()
                    connection.send(content: data, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { error in
                        if let error { finish(.uncertain("The connection to \(host) broke while sending (\(error.localizedDescription)). Check the printer.")) }
                        else { finish(.sent) }
                    })
                case .waiting(let error), .failed(let error):
                    finish(gate.started ? .uncertain("The connection to \(host) broke while sending (\(error.localizedDescription)). Check the printer.")
                                        : .notSent("The printer at \(host):\(port) is not reachable (\(error.localizedDescription))."))
                default: break
                }
            }
            connection.start(queue: queue)
            queue.asyncAfter(deadline: .now() + 10) {
                finish(gate.started ? .uncertain("The printer at \(host) stopped responding while printing. Check the printer.")
                                    : .notSent("The printer at \(host):\(port) did not answer."))
            }
        }
    }

    private func sendQueue(_ data: Data, queue: String) async -> SendOutcome {
        guard await queues().contains(queue) else { return .notSent("The printer \(queue) is not installed on this Mac.") }
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let file = directory.appending(path: "receipt.bin")
            try data.write(to: file, options: .atomic)
            defer { try? FileManager.default.removeItem(at: directory) }
            let (status, _) = try await run("/usr/bin/lp", ["-d", queue, "-o", "raw", "-t", "ReAI receipt", "-n", "1", file.path])
            return status == 0 ? .sent : .notSent("macOS did not accept the receipt for \(queue). Check the printer queue.")
        } catch {
            try? FileManager.default.removeItem(at: directory)
            return .notSent("macOS could not prepare the receipt for printing.")
        }
    }

    private func run(_ executable: String, _ arguments: [String]) async throws -> (Int32, String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        return try await withCheckedThrowingContinuation { continuation in
            process.terminationHandler = { finished in
                let output = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile().prefix(64 * 1024), as: UTF8.self)
                continuation.resume(returning: (finished.terminationStatus, output))
            }
            do { try process.run() } catch { process.terminationHandler = nil; continuation.resume(throwing: error) }
        }
    }
}

/// Resolves a callback-based job exactly once and records whether bytes started flowing.
private final class Gate: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    private var begun = false
    func claim() -> Bool { lock.withLock { if done { return false }; done = true; return true } }
    func markStarted() { lock.withLock { begun = true } }
    var started: Bool { lock.withLock { begun } }
}
