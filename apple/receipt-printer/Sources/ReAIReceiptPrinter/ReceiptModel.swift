import Foundation
import Observation

@MainActor @Observable
final class ReceiptModel {
    private let api = ReAIAPI()
    private let connection = Connection()
    private let credentials = Credentials()
    private var copies: CopyAttempts?
    var copyPrintingAvailable: Bool { copies != nil }
    private var token: String?
    private var query: ReceiptSearch?
    private var page = 0
    private(set) var company: Company?
    private(set) var receipts: [Receipt] = []
    private(set) var totalItems: Int?
    var hasOlder: Bool { page > 1 }
    private(set) var busy = false
    private(set) var connecting = false
    private(set) var code: String?
    private(set) var attemptedSearch = false
    var error: String?

    init() {
        do { copies = try CopyAttempts() }
        catch { self.error = "Could not open the local copy history. Printing is unavailable." }
    }

    func restore() async {
        guard !busy, !connecting, company == nil else { return }
        busy = true
        defer { busy = false }
        do {
            guard let saved = try await credentials.load() else { return }
            company = try await api.account(token: saved)
            token = saved
        } catch { self.error = error.localizedDescription }
    }

    func connect() async {
        guard !busy, !connecting, company == nil else { return }
        connecting = true
        error = nil
        defer { connecting = false; code = nil }
        do {
            let granted = try await connection.authorize { [weak self] code in
                await self?.showApprovalCode(code)
            }
            let approved = try await api.account(token: granted)
            try Task.checkCancellation()
            try await credentials.save(granted)
            token = granted
            company = approved
        } catch is CancellationError {
        } catch { self.error = error.localizedDescription }
    }

    private func showApprovalCode(_ code: String) { self.code = code }

    func disconnect() async {
        guard !busy, !connecting else { return }
        busy = true
        defer { busy = false }
        do {
            try await credentials.delete()
            company = nil
            token = nil
            query = nil
            receipts = []
            page = 0
            totalItems = nil
            attemptedSearch = false
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    func search(start: Date, end: Date, number: String, register: String) async {
        guard !busy else { return }
        let number = number.trimmingCharacters(in: .whitespacesAndNewlines)
        let register = register.trimmingCharacters(in: .whitespacesAndNewlines)
        let cashPoint = Int(register)
        guard number.count <= 100, register.isEmpty || cashPoint.map({ $0 > 0 && $0 <= Int32.max }) == true else {
            error = "Enter a valid receipt number and a positive register ID."
            return
        }
        guard ReceiptSearch.calendar.startOfDay(for: start) <= ReceiptSearch.calendar.startOfDay(for: end) else {
            error = "The start date must be on or before the end date."
            return
        }
        let filters = ReceiptSearch(start: start, end: end, number: number, cashPoint: cashPoint)
        receipts = []
        totalItems = nil
        page = 0
        attemptedSearch = true
        await load(filters, page: nil)
    }

    func more() async {
        guard hasOlder, !busy, let query else { return }
        await load(query, page: page - 1)
    }

    private func load(_ filters: ReceiptSearch, page requestedPage: Int?) async {
        guard let company, let token else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let result = try await api.receipts(filters, page: requestedPage ?? 1, token: token, company: company.id)
            // ReAI returns pages by journal ID ascending. Start at the newest page for a fresh search.
            let page = requestedPage ?? max(1, result.totalPages)
            let displayed = requestedPage == nil && page > 1
                ? try await api.receipts(filters, page: page, token: token, company: company.id)
                : result
            try Task.checkCancellation()
            let known = Set(receipts.map(\.id))
            receipts += displayed.items.reversed().filter { !known.contains($0.id) }
            self.page = page
            query = filters
            totalItems = displayed.totalItems
        } catch {
            if !Task.isCancelled { self.error = error.localizedDescription }
        }
    }

    func copyAttempt(for receipt: Receipt) -> CopyAttempt? {
        guard let company else { return nil }
        return copies?.find(company: company.id, receipt: receipt.id)
    }

    func markPrinted(_ receipt: Receipt) {
        guard !busy, let company, var attempt = copyAttempt(for: receipt), attempt.status == .sentToQueue else { return }
        attempt.status = .printed
        do { try copies?.save(attempt, company: company.id, receipt: receipt.id) }
        catch { self.error = "Could not save the print confirmation." }
    }

    func printCopy(receipt: Receipt, message: String, printer: String, resume: Bool) async {
        guard !busy, let company, let token, var copies, receipt.isSale,
              receipts.contains(where: { $0.id == receipt.id }) else { return }
        let existing = copies.find(company: company.id, receipt: receipt.id)
        guard resume == (existing != nil), existing?.status != .printed else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let output = try ReceiptPrinting(printerName: printer)
            var attempt = existing ?? CopyAttempt(requestID: UUID(), message: message, status: .checkQueue)
            attempt.status = .checkQueue
            try copies.save(attempt, company: company.id, receipt: receipt.id)
            self.copies = copies
            let data = try await api.issueCopy(receipt: receipt.id, attempt: attempt, token: token, company: company.id)
            if try output.printCopy(data) {
                attempt.status = .sentToQueue
                try copies.save(attempt, company: company.id, receipt: receipt.id)
                self.copies = copies
            } else {
                error = "macOS did not confirm queuing the copy. Check the printer queue before resuming."
            }
        } catch { self.error = error.localizedDescription }
    }
}
