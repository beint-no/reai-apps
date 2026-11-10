import Foundation
import Subprocess

struct Printer: Identifiable, Sendable { let id: String; let name: String }
actor LabelPrinter {
    func printers() async throws -> [Printer] {
        try await run("/usr/bin/lpstat", ["-e"]).split(separator: "\n").map(String.init)
            .filter { $0.range(of: "^[A-Za-z0-9_.-]+$", options: .regularExpression) != nil }
            .map { Printer(id: $0, name: $0.replacingOccurrences(of: "_", with: " ")) }
    }
    func submit(_ data: Data, printer: String, width: Double, height: Double) async throws -> String {
        guard try await printers().contains(where: { $0.id == printer }) else { throw appError("Choose an available printer in System Settings.") }
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appending(path: "labels.pdf")
        try data.write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        let media = String(format: "media=Custom.%.2fx%.2fmm", locale: Locale(identifier: "en_US_POSIX"), width, height)
        return try await run("/usr/bin/lp", ["-d", printer, "-t", "ReAI Product Labels", "-n", "1", "-o", media,
            "-o", "print-scaling=none", "-o", "scaling=100", "-o", "sides=one-sided", "-o", "number-up=1",
            "-o", "orientation-requested=3", "-o", "page-left=0", "-o", "page-right=0", "-o", "page-top=0", "-o", "page-bottom=0",
            "-o", "job-sheets=none,none", file.path])
    }
    private func run(_ executable: String, _ arguments: [String]) async throws -> String {
        do {
            try Task.checkCancellation()
            let result = try await Subprocess.run(.path(.init(executable)), arguments: .init(arguments),
                environment: .custom(["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8"]),
                input: .none, output: .string(limit: 64 * 1024), error: .discarded)
            try Task.checkCancellation()
            guard result.terminationStatus.isSuccess else { throw appError("macOS could not submit the labels. Check the printer queue before trying again.") }
            return result.standardOutput.trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            if Task.isCancelled { throw CancellationError() }
            throw appError("macOS could not submit the labels. Check the printer queue before trying again.")
        }
    }
}
