import AppKit
import Foundation
import Observation

@MainActor @Observable
final class BridgeModel {
    private(set) var state = BridgeState()
    private(set) var readable = false
    private(set) var company: Company?
    private(set) var connecting = false
    private(set) var code = ""
    private(set) var busy = false
    private(set) var finding = false
    private(set) var queues: [String] = []
    private(set) var status = "Starting…"
    private(set) var lastCheck: Date?
    /// The latest ReAI polling failure, cleared by the next successful check.
    private(set) var connectionProblem: String?
    /// Why the printer did not take the last receipt, cleared when a job is accepted.
    private(set) var printerProblem: String?
    var error: String?
    var notice: String?

    private let api = ReAIAPI()
    private let credentials = Credentials()
    private let printer = RawPrinter()
    private let ledger = Ledger()
    private var token: String?
    private var merchant: Merchant?
    private var vatRates: [String: Decimal] = [:]
    private var referenceLoaded: Date?
    private var sales: [Int64: Sale] = [:]
    private var clockOffset: TimeInterval = 0
    private var failures = 0
    private var printerRetryAt = Date.distantPast
    private var started = false
    private var loop: Task<Void, Never>?
    private var connection: Task<Void, Never>?

    /// Polling interval while healthy; errors back off to at most one minute.
    static let interval: TimeInterval = 3
    /// Each poll re-reads this much of the past so late-arriving receipts are not missed.
    static let overlap: TimeInterval = 10 * 60
    /// Receipts older than this are not printed automatically after downtime.
    static let autoPrintLimit: TimeInterval = 24 * 60 * 60

    var connected: Bool { company != nil }
    var receipts: [ReceiptRecord] { state.receipts.filter { $0.tenantId == company?.id }.sorted { $0.id > $1.id } }
    var waiting: Int { receipts.filter { $0.state == .pending }.count }
    var attention: [ReceiptRecord] { receipts.filter { [.uncertain, .blocked, .skipped, .printing].contains($0.state) } }
    var knownCashPoints: [Int] { Set(state.knownCashPoints.keys.compactMap(Int.init) + state.cashPoints).sorted() }
    var serverNow: Date { Date().addingTimeInterval(clockOffset) }
    var selecting: Bool { state.allCashPoints || !state.cashPoints.isEmpty }
    var problem: Bool { error != nil || connectionProblem != nil || printerProblem != nil || !attention.isEmpty }

    // MARK: Lifecycle

    func start() async {
        guard !started else { return }
        started = true
        do {
            state = try ledger.load()
            readable = true
            var changed = false
            for index in state.receipts.indices {
                if state.receipts[index].state == .printing {
                    state.receipts[index].state = .uncertain
                    state.receipts[index].detail = "The app stopped while printing. Check the printer; make a copy in ReAI if no receipt came out."
                    changed = true
                }
            }
            if changed { save() }
        } catch {
            readable = false
            self.error = "The receipt ledger could not be read. Printing is paused to prevent duplicates. Move \(ledger.file.path) away to start over."
        }
        do {
            if let stored = try await credentials.load() { try await activate(token: stored) }
        } catch {
            self.error = error.localizedDescription
        }
        await refreshQueues()
        loop = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let delay = await self.tick()
                try? await Task.sleep(for: .seconds(delay))
            }
        }
    }

    func connect() {
        guard connection == nil else { return }
        error = nil; connecting = true
        connection = Task {
            defer { connecting = false; code = ""; connection = nil }
            do {
                let token = try await Connection().authorize { code in await MainActor.run { self.code = code } }
                try await activate(token: token)
                try await credentials.save(token)
                notice = "Connected. Choose the cash points this computer prints for."
            } catch is CancellationError {
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    func cancelConnect() { connection?.cancel() }

    func disconnect() async {
        connection?.cancel()
        do { try await credentials.delete() } catch { self.error = error.localizedDescription; return }
        token = nil; company = nil; merchant = nil; referenceLoaded = nil; sales = [:]
        notice = "Disconnected. Revoke access in your ReAI profile to remove it from ReAI."
    }

    private func activate(token: String) async throws {
        let company = try await api.company(token: token)
        self.token = token
        self.company = company
        if state.tenantId != company.id {
            // Another company: start a fresh selection, keep the other company's receipt history.
            state.tenantId = company.id
            state.allCashPoints = false; state.cashPoints = []; state.knownCashPoints = [:]
            state.baselines = [:]; state.cursors = [:]
            save()
        }
        try await loadReference(force: true)
        if state.knownCashPoints.isEmpty { await findCashPoints() }
    }

    private func loadReference(force: Bool) async throws {
        guard let token, let company else { return }
        if !force, let loaded = referenceLoaded, Date().timeIntervalSince(loaded) < 6 * 3600 { return }
        merchant = try await api.merchant(token: token, company: company.id)
        vatRates = try await api.vatRates(token: token, company: company.id)
        referenceLoaded = Date()
    }

    // MARK: Cash points

    func findCashPoints() async {
        guard let token, let company else { return }
        finding = true; defer { finding = false }
        do {
            var page = 1
            repeat {
                let result = try await api.sales(token: token, company: company.id, startAt: serverNow.addingTimeInterval(-30 * 86400), cashPoint: nil, page: page)
                adjustClock(result.serverDate)
                for sale in result.value.items { state.knownCashPoints[String(sale.cashPointId)] = "Last receipt \(sale.receiptNumber)" }
                guard result.value.hasNext else { break }
                page += 1
            } while page <= 5
            save()
            if state.knownCashPoints.isEmpty { notice = "No receipts in the last 30 days. Add the cash point ID shown on a ReAI receipt." }
        } catch { self.error = error.localizedDescription }
    }

    func setAllCashPoints(_ on: Bool) {
        state.allCashPoints = on
        if on { state.baselines[key(nil)] = baselineNow() }
        save()
    }

    func setCashPoint(_ id: Int, _ on: Bool) {
        state.cashPoints.removeAll { $0 == id }
        if on {
            state.cashPoints.append(id); state.cashPoints.sort()
            state.baselines[key(id)] = baselineNow()
            state.cursors[key(id)] = nil
        }
        save()
    }

    func addCashPoint(_ text: String) {
        guard let id = Int(text.trimmingCharacters(in: .whitespaces)), id > 0 else { error = "Enter the numeric cash point ID."; return }
        if state.knownCashPoints[String(id)] == nil { state.knownCashPoints[String(id)] = "Added manually" }
        setCashPoint(id, true)
    }

    func hint(_ id: Int) -> String? { state.knownCashPoints[String(id)] }

    private func key(_ cashPoint: Int?) -> String { "\(company?.id ?? 0):\(cashPoint.map(String.init) ?? "all")" }

    /// The next whole server second, so history up to now is never printed.
    private func baselineNow() -> Date { Date(timeIntervalSince1970: (serverNow.timeIntervalSince1970 + 1).rounded(.down)) }

    private func adjustClock(_ server: Date) { clockOffset = server.timeIntervalSince(Date()) }

    // MARK: Settings

    func update(_ change: (inout BridgeState) -> Void) { change(&state); save() }

    func refreshQueues() async { queues = await printer.queues() }

    func togglePaused() { update { $0.paused.toggle() } }

    // MARK: Polling

    /// One poll and print pass. Returns the delay before the next pass.
    private func tick() async -> TimeInterval {
        guard readable else { status = "Paused: the receipt ledger could not be read."; return 30 }
        guard let token, let company else { status = "Connect to ReAI to print receipts."; return 5 }
        guard selecting else { status = "Choose the cash points this computer prints for."; return 5 }
        guard !state.paused else { status = "Printing is paused."; return 5 }
        do {
            try await loadReference(force: false)
            let keys: [Int?] = state.allCashPoints ? [nil] : state.cashPoints.map { $0 }
            for cashPoint in keys { try await poll(cashPoint: cashPoint, token: token, company: company) }
            failures = 0
            lastCheck = Date()
            connectionProblem = nil
        } catch {
            failures += 1
            connectionProblem = error.localizedDescription
            let delay = min(60, Self.interval * pow(2, Double(min(failures, 5))))
            status = "Could not reach ReAI. Retrying in \(Int(delay)) s."
            return delay
        }
        await printPending()
        let where_ = state.allCashPoints ? "all cash points" : state.cashPoints.count == 1 ? "cash point \(state.cashPoints[0])" : "cash points " + state.cashPoints.map(String.init).joined(separator: ", ")
        if !state.printer.configured { status = "Choose a receipt printer." }
        else if let printerProblem, waiting > 0 { status = "\(printerProblem) \(waiting) receipt(s) waiting." }
        else { status = "Printing for \(where_)." }
        return Self.interval
    }

    private func poll(cashPoint: Int?, token: String, company: Company) async throws {
        let key = key(cashPoint)
        guard let baseline = state.baselines[key] else { state.baselines[key] = baselineNow(); save(); return }
        let start = max(baseline, state.cursors[key] ?? baseline)
        var page = 1, serverDate = serverNow, latest: Date?
        var known = Set(state.receipts.filter { $0.tenantId == company.id }.map(\.id))
        while true {
            let result = try await api.sales(token: token, company: company.id, startAt: start, cashPoint: cashPoint, page: page)
            if page == 1 { serverDate = result.serverDate; adjustClock(result.serverDate) }
            for sale in result.value.items {
                state.knownCashPoints[String(sale.cashPointId)] = "Last receipt \(sale.receiptNumber)"
                guard !known.contains(sale.id), let date = ReceiptRenderer.parseInstant(sale.occurredAt), date >= baseline else { continue }
                known.insert(sale.id)
                sales[sale.id] = sale
                latest = max(latest ?? date, date)
                state.receipts.append(ReceiptRecord(id: sale.id, tenantId: company.id, cashPointId: sale.cashPointId, receiptNumber: sale.receiptNumber,
                                                    type: sale.type, occurredAt: sale.occurredAt, grossAmount: sale.grossAmount,
                                                    cash: ReceiptRenderer.hasCash(sale), state: .pending, updatedAt: Date()))
            }
            guard result.value.hasNext else { break }
            if page == 10 {
                // Bounded work per pass; continue after the newest receipt next time.
                state.cursors[key] = max(baseline, latest ?? start)
                prune(); save(); return
            }
            page += 1
        }
        state.cursors[key] = max(baseline, serverDate.addingTimeInterval(-Self.overlap))
        prune(); save()
    }

    private func prune() {
        let cutoff = Date().addingTimeInterval(-30 * 86400)
        state.receipts.removeAll { $0.updatedAt < cutoff && $0.date < cutoff && $0.state != .pending }
        if state.receipts.count > 5000 { state.receipts.removeFirst(state.receipts.count - 5000) }
    }

    private func printPending() async {
        guard state.printer.configured, Date() >= printerRetryAt, !busy else { return }
        for record in receipts.filter({ $0.state == .pending }).sorted(by: { $0.id < $1.id }) {
            if record.date < serverNow.addingTimeInterval(-Self.autoPrintLimit) {
                change(record.id) { $0.state = .skipped; $0.detail = "Not printed automatically: older than 24 hours." }
                continue
            }
            guard await printOriginal(record.id) else { return }
        }
    }

    // MARK: Printing

    /// Prints the original receipt once: automatically when pending, or on request when it was blocked or skipped and never sent.
    /// Returns false when the printer is unavailable, so the queue waits.
    @discardableResult
    func printOriginal(_ id: Int64) async -> Bool {
        guard let token, let company, let record = state.receipts.first(where: { $0.id == id && $0.tenantId == company.id }),
              [.pending, .blocked, .skipped].contains(record.state) else { return false }
        busy = true; defer { busy = false }
        let elements: [ReceiptElement]
        let sale: Sale
        do {
            if record.state == .blocked { try await loadReference(force: true) }
            if let cached = sales[id] { sale = cached } else { sale = try await api.sale(id, token: token, company: company.id); sales[id] = sale }
            elements = try ReceiptRenderer.render(sale, context: context(company: company))
        } catch let error as ReceiptError {
            change(id) { $0.state = .blocked; $0.detail = error.localizedDescription + " Fix it in ReAI and click Print, or print the receipt from ReAI instead." }
            return true
        } catch {
            connectionProblem = error.localizedDescription
            return false
        }
        change(id) { $0.state = .printing; $0.attempts += 1 }
        let data = EscPos.encode(elements, columns: state.printer.columns, openDrawer: state.openDrawerForCash && ReceiptRenderer.hasCash(sale))
        switch await printer.send(data, to: state.printer) {
        case .sent:
            change(id) { $0.state = .printed; $0.detail = nil }
            sales[id] = nil
            printerRetryAt = .distantPast; printerProblem = nil
            return true
        case .notSent(let reason):
            change(id) { $0.state = .pending; $0.detail = reason }
            printerRetryAt = Date().addingTimeInterval(min(60, Self.interval * pow(2, Double(min(record.attempts, 4)))))
            printerProblem = reason
            return false
        case .uncertain(let reason):
            change(id) { $0.state = .uncertain; $0.detail = reason + " Make a copy in ReAI if no receipt came out." }
            printerProblem = nil
            return true
        }
    }

    func testPrint() async {
        busy = true; defer { busy = false }
        let data = EscPos.encode(ReceiptRenderer.testPage(columns: state.printer.columns, printer: state.printer.title), columns: state.printer.columns, openDrawer: false)
        report(await printer.send(data, to: state.printer), success: "Test page sent to \(state.printer.title).")
    }

    func openDrawer() async {
        busy = true; defer { busy = false }
        report(await printer.send(EscPos.drawerOnly(), to: state.printer), success: "Drawer signal sent.")
    }

    private func report(_ outcome: SendOutcome, success: String) {
        switch outcome {
        case .sent: notice = success; error = nil; printerRetryAt = .distantPast; printerProblem = nil
        case .notSent(let reason), .uncertain(let reason): error = reason
        }
    }

    private func context(company: Company) throws -> ReceiptContext {
        guard let merchant else { throw appError("Company details from ReAI are not loaded yet.") }
        return ReceiptContext(tenantId: company.id, merchant: merchant, companyCurrency: company.currencyCode, vatRates: vatRates,
                              columns: state.printer.columns, printQRCode: state.printQRCode)
    }

    private func change(_ id: Int64, _ edit: (inout ReceiptRecord) -> Void) {
        guard let index = state.receipts.firstIndex(where: { $0.id == id && $0.tenantId == company?.id }) else { return }
        edit(&state.receipts[index])
        state.receipts[index].updatedAt = Date()
        save()
    }

    private func save() {
        guard readable else { return }
        do { try ledger.save(state) } catch {
            self.error = "The receipt ledger could not be saved. Printing is paused to prevent duplicates."
            readable = false
        }
    }
}
