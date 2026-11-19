import Foundation
import Observation

@MainActor @Observable
final class ReceiptModel {
    private let api = ReAIAPI()
    private let connection = Connection()
    private let credentials = Credentials()
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
            let known = Set(receipts.map(\.id))
            receipts += displayed.items.reversed().filter { !known.contains($0.id) }
            self.page = page
            query = filters
            totalItems = displayed.totalItems
        } catch is CancellationError {
        } catch { self.error = error.localizedDescription }
    }

    func printNote(_ document: NoteDocument) -> Bool {
        guard !busy else { return false }
        busy = true
        error = nil
        defer { busy = false }
        do { return try document.printNote() }
        catch { self.error = error.localizedDescription; return false }
    }
}
