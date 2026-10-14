import AppKit
import Foundation
import Observation

struct PrintRecord: Codable, Identifiable {
    var id: String { request.key }
    let request: PrintRequest
    var state: String
    var queueResult: String?
}

@MainActor @Observable
final class ShippingModel {
    var company: Company?
    var connecting = false
    var busy = false
    var code = ""
    var error: String?
    var notice: String?
    var printers: [Printer] = []
    var printerId: String {
        didSet { UserDefaults.standard.set(printerId, forKey: "shipping.printer") }
    }
    var records: [PrintRecord] = []
    var pending: [PrintRequest] = []
    private let api = ReAIAPI()
    private let credentials = Credentials()
    private let printer = LabelPrinter()
    private var token: String?
    private var initialized = false
    private var historyReadable = true
    private var initialization: Task<Void, Never>?
    private var connectionTask: Task<Void, Never>?
    private let journal: URL

    init() {
        printerId = UserDefaults.standard.string(forKey: "shipping.printer") ?? ""
        journal = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "ReAI Shipping/print-history.json")
        do {
            if FileManager.default.fileExists(atPath: journal.path) {
                records = try JSONDecoder().decode([PrintRecord].self, from: Data(contentsOf: journal))
                if records.contains(where: { $0.state == "submitting" }) {
                    notice = t("A previous print was interrupted. Check the printer queue before reprinting.")
                }
            }
        } catch { historyReadable = false; self.error = t("Print history could not be read. Automatic printing is paused to prevent duplicates.") }
    }

    func start() async {
        if let initialization { await initialization.value; return }
        guard !initialized else { return }
        let task = Task { await restore() }
        initialization = task
        await task.value
        initialized = true
        initialization = nil
    }

    private func restore() async {
        do {
            await refreshPrinters()
            if let saved = try await credentials.load() {
                company = try await api.account(token: saved)
                token = saved
            }
        } catch { self.error = error.localizedDescription }
    }

    func connect() {
        guard !connecting, !busy else { return }
        connecting = true
        error = nil
        connectionTask = Task { [self] in
            defer { connecting = false; code = ""; connectionTask = nil }
            do {
                let key = try await Connection().authorize { [weak self] code in
                    await MainActor.run { self?.code = code }
                }
                let approved = try await api.account(token: key)
                try Task.checkCancellation()
                try await credentials.save(key)
                token = key
                company = approved
                notice = t("Connected. Enable printing in your browser to finish setup.")
                await drain()
            } catch is CancellationError {
            } catch { self.error = error.localizedDescription }
        }
    }

    func disconnect() async {
        guard !busy else { return }
        connectionTask?.cancel()
        do {
            try await credentials.delete()
            token = nil
            company = nil
            pending.removeAll()
            notice = nil
        } catch { self.error = error.localizedDescription }
    }

    func refreshPrinters() async {
        do {
            printers = try await printer.printers()
            if printerId.isEmpty {
                let zebras = printers.filter(\.isZebra)
                if zebras.count == 1 { printerId = zebras[0].id }
            }
        } catch { self.error = error.localizedDescription }
    }

    func receive(_ url: URL) async {
        await start()
        do {
            let request = try PrintRequest(url: url)
            if records.contains(where: { $0.id == request.key }) {
                notice = t("This label was already received. Use Reprint below if another copy is needed.")
                return
            }
            if !pending.contains(request) { pending.append(request) }
            await drain()
        } catch { self.error = error.localizedDescription }
    }

    func drain() async {
        guard historyReadable, !busy, let token, let company, !printerId.isEmpty, !pending.isEmpty else { return }
        busy = true
        defer { busy = false }
        while !pending.isEmpty {
            let request = pending.removeFirst()
            guard request.tenantId == company.id else {
                error = t("This label belongs to another company. Connect to that company before printing.")
                continue
            }
            guard !records.contains(where: { $0.id == request.key }) else { continue }
            await printLabel(request, token: token, verifyHandoff: true)
        }
    }

    func reprint(_ record: PrintRecord) async {
        guard historyReadable, !busy, let token, company?.id == record.request.tenantId, !printerId.isEmpty else { return }
        busy = true
        defer { busy = false }
        await printLabel(record.request, token: token, verifyHandoff: false)
    }

    private func printLabel(_ request: PrintRequest, token: String, verifyHandoff: Bool) async {
        error = nil
        notice = t("Preparing label…")
        let selectedPrinter = printerId
        do {
            let data = try await api.label(request, token: token, verifyHandoff: verifyHandoff)
            _ = try LabelPrinter.media(for: data)
            records.removeAll { $0.id == request.key }
            records.insert(PrintRecord(request: request, state: "submitting"), at: 0)
            // Persist before handing off: a crash must never cause an automatic second print.
            try save()
            let result = try await printer.submit(data, printer: selectedPrinter, shipmentId: request.shipmentId)
            records[0].state = "queued"
            records[0].queueResult = result
            try save()
            notice = t("Sent to the printer queue.")
        } catch {
            if let index = records.firstIndex(where: { $0.id == request.key }) {
                records[index].state = "check_queue"
            } else {
                records.insert(PrintRecord(request: request, state: "failed"), at: 0)
            }
            try? save()
            self.error = error.localizedDescription
            notice = nil
        }
    }

    private func save() throws {
        try FileManager.default.createDirectory(at: journal.deletingLastPathComponent(), withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(records).write(to: journal, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: journal.path)
    }
}
