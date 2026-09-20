import AppKit
import SwiftUI
import UniformTypeIdentifiers

@MainActor @Observable
final class ImportModel {
    var kind = ImportKind.products
    var sheets: [Sheet] = []
    var sheetIndex = 0
    var headerRow = 0
    var mapping: [String] = []
    var filename = ""
    var decimalComma = false
    var privatePeople = false
    var batch: ImportBatch?
    var company: Company?
    var email = ""
    var error: String?
    var busy = false
    var importing = false
    var stopRequested = false
    var connecting = false
    var connectionCode = ""
    var progress = ""
    private var started = false
    private var token = ""
    private var connectionTask: Task<Void, Never>?
    private let api: ReAIAPI
    private let credentials = Credentials()
    private let reader = SpreadsheetReader()
    private let validator = ImportValidator()
    private let journal: ImportJournal

    init(api: ReAIAPI = ReAIAPI(), journal: ImportJournal = ImportJournal()) { self.api = api; self.journal = journal }
    var rows: [[String]] { sheets.indices.contains(sheetIndex) ? sheets[sheetIndex].rows : [] }
    var headers: [String] { rows.indices.contains(headerRow) ? rows[headerRow] : [] }
    var readyCount: Int { batch?.rows.filter { $0.state == .ready }.count ?? 0 }
    var createdCount: Int { batch?.rows.filter { $0.state == .created }.count ?? 0 }
    var canImport: Bool { !busy && !importing && readyCount > 0 && batch?.company.id == company?.id && batch?.email == email }

    func start() async {
        guard !started else { return }
        started = true
        busy = true
        defer { busy = false }
        do {
            batch = try await journal.load()
            if let batch { kind = batch.kind; filename = batch.filename }
            if let saved = try await credentials.load() { try await connect(saved) }
        } catch { self.error = error.localizedDescription }
    }
    private func connect(_ candidate: String) async throws {
        let account: Account = try await api.request("api/me", token: candidate)
        guard account.tenants.count == 1, let selected = account.tenants.first else { throw appError("Connect again and choose one company in your browser.") }
        try await credentials.save(candidate)
        token = candidate; company = selected; email = account.email
    }
    func connectInBrowser() {
        guard !connecting, !busy, !importing else { return }
        connecting = true; error = nil
        connectionTask = Task { [self] in
            defer { connecting = false; connectionCode = ""; connectionTask = nil }
            do {
                let candidate = try await Connection().authorize { [weak self] code in await MainActor.run { self?.connectionCode = code } }
                try Task.checkCancellation()
                try await connect(candidate)
                NSApp.activate()
            } catch is CancellationError {} catch { self.error = error.localizedDescription }
        }
    }
    func cancelConnection() { connectionTask?.cancel() }
    func disconnect() {
        guard !busy, !importing else { return }
        busy = true
        Task {
            defer { busy = false }
            do { try await credentials.delete(); token = ""; company = nil; email = "" }
            catch { self.error = error.localizedDescription }
        }
    }
    func chooseFile() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "xlsx"), .commaSeparatedText, .tabSeparatedText, .plainText].compactMap { $0 }
        panel.allowsMultipleSelection = false; panel.canChooseDirectories = false
        if panel.runModal() == .OK, let url = panel.url { load(url) }
    }
    func load(_ url: URL) {
        guard !busy, !importing, batch == nil else { return }
        busy = true; error = nil; progress = "Reading file…"
        Task {
            defer { busy = false; progress = "" }
            do {
                let loaded = try await reader.read(url)
                sheets = loaded; sheetIndex = 0; headerRow = 0; filename = url.lastPathComponent
                decimalComma = false
                remap()
            } catch { self.error = error.localizedDescription }
        }
    }
    func remap() {
        mapping = Fields.match(headers, kind: kind)
        error = nil
    }
    func review() {
        guard !busy, let company else { error = "Connect to ReAI so the preview can check existing records in your company."; return }
        let kind = kind, rows = rows, header = headerRow, mapping = mapping, comma = decimalComma, people = privatePeople
        busy = true; error = nil; progress = "Checking existing \(kind.rawValue)…"
        Task {
            defer { busy = false; progress = "" }
            do {
                let existing = try await api.existing(kind: kind, token: token, company: company.id)
                let prepared = try await validator.prepare(rows: rows, headerRow: header, mapping: mapping, kind: kind, decimalComma: comma, privatePeople: people, existing: existing.keys)
                batch = ImportBatch(filename: filename, kind: kind, company: company, email: email, rows: prepared)
            } catch { self.error = error.localizedDescription }
        }
    }
    func editMapping() {
        guard !importing, let batch, batch.rows.allSatisfy({ [.ready, .invalid, .skipped].contains($0.state) }), !sheets.isEmpty else { return }
        self.batch = nil
    }
    func skip(_ rowID: Int) {
        guard !importing, !busy, let index = batch?.rows.firstIndex(where: { $0.id == rowID }), batch?.rows[index].state == .ready else { return }
        batch?.rows[index].state = .skipped; batch?.rows[index].detail = "Excluded from this import."
    }
    func runImport() {
        guard canImport, let initial = batch else { return }
        importing = true; stopRequested = false; error = nil; progress = "Checking existing records…"
        Task {
            defer { importing = false; progress = "" }
            do {
                var current = initial
                var existing = try await api.existing(kind: current.kind, token: token, company: current.company.id)
                for i in current.rows.indices where current.rows[i].state == .ready && !ImportValidator.keys(current.rows[i].fields, kind: current.kind).isDisjoint(with: existing.keys) {
                    current.rows[i].state = .skipped; current.rows[i].detail = "This record now exists in ReAI."
                }
                try await journal.save(current); batch = current
                for i in current.rows.indices where current.rows[i].state == .ready {
                    if stopRequested { break }
                    guard let payload = current.rows[i].payload else { throw appError("A row is missing its prepared data. Start a new import.") }
                    current.rows[i].state = .sending; current.rows[i].detail = "Sending to ReAI…"
                    try await journal.record(current.rows[i], batchID: current.id); batch = current
                    progress = "Creating row \(current.rows[i].line)…"
                    do {
                        struct Created: Decodable, Sendable { let id: Int }
                        let result: Created = try await api.request("api/\(current.kind.rawValue)", token: token, company: current.company.id, body: payload)
                        let matchedExisting = existing.ids.contains(result.id)
                        current.rows[i].state = matchedExisting ? .skipped : .created
                        current.rows[i].remoteID = result.id
                        current.rows[i].detail = matchedExisting ? "ReAI matched an existing record · ID \(result.id)" : "Created in ReAI · ID \(result.id)"
                        existing.ids.insert(result.id)
                    } catch {
                        let failure = error as NSError
                        current.rows[i].state = failure.domain == "no.reai.import" && (400..<500).contains(failure.code) ? .rejected : .uncertain
                        current.rows[i].detail = error.localizedDescription + " Check ReAI before importing this row again."
                        stopRequested = true
                        self.error = "Import paused at row \(current.rows[i].line). Completed rows are saved. Check the row details before continuing."
                    }
                    batch = current
                    try await journal.record(current.rows[i], batchID: current.id)
                }
            } catch { self.error = "Import stopped: " + error.localizedDescription }
        }
    }
    func newImport() {
        guard !busy, !importing else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await journal.clear(); batch = nil; sheets = []; mapping = []; filename = ""; error = nil
            } catch { self.error = error.localizedDescription }
        }
    }
    func exportReport() {
        guard let batch else { return }
        let panel = NSSavePanel(); panel.allowedContentTypes = [.commaSeparatedText]; panel.nameFieldStringValue = "reai-import-report.csv"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let rows = [["Source row", "Name", "Status", "ReAI ID", "Details"]] + batch.rows.map { [String($0.line), $0.name, $0.state.rawValue, $0.remoteID.map(String.init) ?? "", $0.detail] }
        do { try Self.csv(rows).write(to: url, atomically: true, encoding: .utf8) }
        catch { self.error = error.localizedDescription }
    }
    static func csv(_ rows: [[String]]) -> String {
        rows.map { row in row.map { value in
            let first = value.trimmingCharacters(in: .whitespacesAndNewlines).first
            let safe = first.map { "=+-@".contains($0) } == true ? "'" + value : value
            return "\"" + safe.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }.joined(separator: ",") }.joined(separator: "\r\n")
    }
    func saveTemplate() {
        let panel = NSSavePanel(); panel.allowedContentTypes = [.commaSeparatedText]; panel.nameFieldStringValue = "\(kind.rawValue)-template.csv"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try Self.csv([Fields.forKind(kind).map(\.id)]).write(to: url, atomically: true, encoding: .utf8) }
        catch { self.error = error.localizedDescription }
    }
}
