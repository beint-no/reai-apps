import Foundation
import PDFKit

enum ShippingDocument: String, Codable, Sendable {
    case label
    case customsInvoice = "customs-invoice"

    var title: String { self == .label ? "Shipping label" : "Customs invoice" }
}

struct PrintRequest: Codable, Equatable, Sendable {
    let tenantId: Int
    let shipmentId: Int
    private let documentType: ShippingDocument?
    var document: ShippingDocument { documentType ?? .label }
    var key: String { "\(tenantId):\(shipmentId)" + (document == .label ? "" : ":\(document.rawValue)") }

    init(tenantId: Int, shipmentId: Int, document: ShippingDocument = .label) {
        self.tenantId = tenantId
        self.shipmentId = shipmentId
        // Missing documentType in an existing journal means label; retain its receipt identity.
        documentType = document == .label ? nil : document
    }
}

struct PrintLayout: Equatable, Sendable {
    let media: String
    let fullPage: Bool
    let landscape: Bool
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

    func submit(_ data: Data, printer: String, request: PrintRequest) throws -> String {
        guard request.document == .label else { throw appError("Customs invoices are printed from ReAI.") }
        let layout = try Self.layout(for: data)
        guard let queue = try printers().first(where: { $0.id == printer }) else {
            throw appError("The selected printer is unavailable. Check Printers & Scanners in System Settings.")
        }
        guard !layout.fullPage || !queue.isZebra else {
            throw appError("This full-page label needs an A4 / Letter printer. Choose one below or print it from ReAI.")
        }
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appending(path: "\(request.document.rawValue).pdf")
        try data.write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        return try run("/usr/bin/lp", ["-d", printer, "-t", "ReAI \(request.shipmentId) · \(t(request.document.title))", "-n", "1",
                                       "-o", "media=\(layout.media)", "-o", "fit-to-page", "-o", "sides=one-sided",
                                       "-o", "orientation-requested=\(layout.landscape ? 4 : 3)",
                                       "-o", "job-sheets=none,none", "-o", "number-up=1", file.path])
    }

    static func layout(for data: Data) throws -> PrintLayout {
        guard data.count <= 10 * 1024 * 1024, data.starts(with: Data("%PDF-".utf8)),
              let document = PDFDocument(data: data), !document.isLocked, (1...20).contains(document.pageCount),
              let first = document.page(at: 0) else { throw appError("The shipping document PDF is invalid.") }
        let box = first.bounds(for: .mediaBox)
        let rotated = abs(first.rotation) % 180 == 90
        let width = (rotated ? box.height : box.width) * 25.4 / 72
        let height = (rotated ? box.width : box.height) * 25.4 / 72
        guard width.isFinite, height.isFinite, width > 0, height > 0 else {
            throw appError("The shipping document PDF is invalid.")
        }
        for index in 0..<document.pageCount {
            guard let page = document.page(at: index), page.rotation == first.rotation,
                  abs(page.bounds(for: .mediaBox).width - box.width) < 1,
                  abs(page.bounds(for: .mediaBox).height - box.height) < 1 else {
                throw appError("The PDF contains different page sizes. Print it manually from ReAI.")
            }
        }
        let short = min(width, height), long = max(width, height)
        if abs(short - 210) < 2 && abs(long - 297) < 2 {
            return PrintLayout(media: "A4", fullPage: true, landscape: width > height)
        }
        if abs(short - 215.9) < 2 && abs(long - 279.4) < 2 {
            return PrintLayout(media: "Letter", fullPage: true, landscape: width > height)
        }
        if (40...120).contains(width), (40...220).contains(height) {
            return PrintLayout(media: String(format: "Custom.%.2fx%.2fmm", locale: Locale(identifier: "en_US_POSIX"), width, height),
                               fullPage: false, landscape: false)
        }
        throw appError("This PDF has an unsupported page size. Print it manually from ReAI.")
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
            throw appError("macOS could not send the document to the printer. Check the printer queue before trying again.")
        }
        return String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
