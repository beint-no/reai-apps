import Foundation
import PDFKit

struct PrintRequest: Codable, Equatable, Sendable {
    let tenantId: Int
    let shipmentId: Int
    var key: String { "\(tenantId):\(shipmentId)" }

}

struct Printer: Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let isZebra: Bool
}

actor LabelPrinter {
    func printers() throws -> [Printer] {
        let queues = try run("/usr/bin/lpstat", ["-e"]).split(separator: "\n").map(String.init)
        return queues.filter { $0.range(of: "^[A-Za-z0-9_.-]+$", options: .regularExpression) != nil }
            .map { queue in
                let options = (try? run("/usr/bin/lpoptions", ["-p", queue])) ?? ""
                let description = (queue + " " + options).lowercased()
                return Printer(id: queue, name: queue.replacingOccurrences(of: "_", with: " "),
                               isZebra: description.contains("zebra") || description.contains("zdesigner"))
            }
    }

    func submit(_ data: Data, printer: String, shipmentId: Int) throws -> String {
        let media = try Self.media(for: data)
        guard try printers().contains(where: { $0.id == printer }) else {
            throw appError("The selected printer is unavailable. Check Printers & Scanners in System Settings.")
        }
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appending(path: "label.pdf")
        try data.write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        return try run("/usr/bin/lp", ["-d", printer, "-t", "ReAI \(shipmentId)", "-n", "1",
                                       "-o", "media=\(media)", "-o", "fit-to-page", "-o", "sides=one-sided",
                                       "-o", "job-sheets=none,none", "-o", "number-up=1", file.path])
    }

    static func media(for data: Data) throws -> String {
        guard let document = PDFDocument(data: data), !document.isLocked, (1...20).contains(document.pageCount),
              let first = document.page(at: 0) else { throw appError("The shipping label PDF is invalid.") }
        let box = first.bounds(for: .mediaBox)
        let rotated = abs(first.rotation) % 180 == 90
        let width = (rotated ? box.height : box.width) * 25.4 / 72
        let height = (rotated ? box.width : box.height) * 25.4 / 72
        guard width.isFinite, height.isFinite, (40...120).contains(width), (40...220).contains(height) else {
            throw appError("This PDF is not label-sized. Open the order in ReAI to print it manually.")
        }
        for index in 0..<document.pageCount {
            guard let page = document.page(at: index), page.rotation == first.rotation,
                  abs(page.bounds(for: .mediaBox).width - box.width) < 1,
                  abs(page.bounds(for: .mediaBox).height - box.height) < 1 else {
                throw appError("The PDF contains different page sizes. Print it manually from ReAI.")
            }
        }
        return String(format: "Custom.%.2fx%.2fmm", locale: Locale(identifier: "en_US_POSIX"), width, height)
    }

    private func run(_ executable: String, _ arguments: [String]) throws -> String {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = output
        process.standardError = output
        process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8"]
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw appError("macOS could not send the label to the printer. Check the printer queue before trying again.")
        }
        return String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
