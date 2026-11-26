import AppKit
import Foundation
import OSLog

enum Diagnostics {
    private static let logger = Logger(subsystem: "no.reai.shipping", category: "app")
    private static let maxLogBytes = 256 * 1024
    private static let queue = DispatchQueue(label: "no.reai.shipping.diagnostics", qos: .utility)

    private static var supportDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "ReAI Shipping")
    }
    static var logURL: URL { supportDirectory.appending(path: "diagnostics.log") }
    private static var sessionSentinelURL: URL { supportDirectory.appending(path: "active-session.marker") }

    static func startSession() {
        NSSetUncaughtExceptionHandler { exception in
            let name = exception.name.rawValue
            let reason = exception.reason ?? "unknown"
            let frames = exception.callStackSymbols.prefix(12).joined(separator: " | ")
            Diagnostics.writeSync(level: "CRASH", operation: "uncaught-exception",
                                  detail: "name=\(name) reason=\(reason) stack=\(frames)")
        }
        let info = Bundle.main.infoDictionary ?? [:]
        let version = info["CFBundleShortVersionString"] as? String ?? "dev"
        let build = info["CFBundleVersion"] as? String ?? "0"
        let os = ProcessInfo.processInfo.operatingSystemVersionString
        queue.async {
            if let previous = try? String(contentsOf: sessionSentinelURL, encoding: .utf8), !previous.isEmpty {
                writeLine(level: "WARN", operation: "previous-session-unclean", detail: previous.trimmingCharacters(in: .whitespacesAndNewlines))
            }
            let marker = "started=\(ISO8601DateFormatter().string(from: .now)) version=\(version) (\(build)) os=\(os)\n"
            try? ensureDirectory()
            try? Data(marker.utf8).write(to: sessionSentinelURL, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: sessionSentinelURL.path)
            writeLine(level: "INFO", operation: "session-start", detail: "version=\(version) (\(build)) os=\(os)")
        }
    }

    static func endSession() {
        queue.sync {
            writeLine(level: "INFO", operation: "session-end", detail: "clean-shutdown")
            try? FileManager.default.removeItem(at: sessionSentinelURL)
        }
    }

    static func recordError(operation: String, error: any Error) {
        if error is CancellationError { return }
        let nsError = error as NSError
        let detail = "domain=\(sanitize(nsError.domain)) code=\(nsError.code) type=\(sanitize(String(reflecting: type(of: error))))"
        logger.error("[\(operation, privacy: .public)] \(detail, privacy: .public)")
        queue.async {
            writeLine(level: "ERROR", operation: sanitize(operation), detail: detail)
        }
    }

    private static func writeSync(level: String, operation: String, detail: String) {
        writeLine(level: level, operation: sanitize(operation), detail: sanitize(detail))
    }

    private static func writeLine(level: String, operation: String, detail: String) {
        do {
            try ensureDirectory()
            if let attributes = try? FileManager.default.attributesOfItem(atPath: logURL.path),
               let size = attributes[.size] as? Int, size > maxLogBytes {
                let backup = supportDirectory.appending(path: "diagnostics.previous.log")
                try? FileManager.default.removeItem(at: backup)
                try? FileManager.default.moveItem(at: logURL, to: backup)
            }
            let timestamp = ISO8601DateFormatter().string(from: .now)
            let line = "\(timestamp) [\(level)] \(operation): \(detail)\n"
            let data = Data(line.utf8)
            if FileManager.default.fileExists(atPath: logURL.path),
               let handle = try? FileHandle(forWritingTo: logURL) {
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
            } else {
                try data.write(to: logURL, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: logURL.path)
            }
        } catch {}
    }

    private static func ensureDirectory() throws {
        try FileManager.default.createDirectory(at: supportDirectory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
    }

    private static func sanitize(_ text: String) -> String {
        let singleLine = text.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\r", with: " ")
        return String(singleLine.prefix(400))
    }
}
