import AppKit
import Foundation
import Observation

func appError(_ message: String, code: Int = 0) -> NSError {
    NSError(domain: AppInfo.bundle, code: code, userInfo: [NSLocalizedDescriptionKey: message])
}
enum AppEnvironment { static let origin = URL(string: "https://app.reai.no")! }
struct Company: Decodable, Identifiable, Hashable, Sendable { let id: Int; let companyName: String; let currencyCode: String }
struct Account: Decodable, Sendable { let tenants: [Company] }
struct CompanyBank: Decodable, Identifiable, Sendable { let id: Int; let displayName: String; let currency: String; let archived: Bool }
struct BankTransaction: Decodable, Identifiable, Sendable {
    let id: Int; let amount: Double; let currency: String; let transactionDate: String
    let description: String?; let paymentReference: String?
}
struct Reconciliation: Decodable, Sendable { let pendingTransactions: [BankTransaction]? }
struct Payout: Identifiable, Sendable {
    let id: String; let date: String; let amountMinor: Int64; let currency: String
    let reference: String; let detail: String
    var amount: Double { Double(amountMinor) / 100 }
}
struct ReviewRow: Identifiable {
    let payout: Payout; let match: BankTransaction?; let status: String
    var id: String { payout.id }
}

@MainActor @Observable final class ReviewModel {
    private let reai = ReAIAPI()
    private let provider = ProviderAPI()
    private let reaiStore = Credentials(account: "reai-user-token")
    private let providerStore = Credentials(account: "provider-credentials")
    private var reaiToken: String?
    private var providerFields: [String: String]?
    private(set) var account: Account?
    private(set) var banks: [CompanyBank] = []
    private(set) var payouts: [Payout] = []
    private(set) var bankTransactions: [BankTransaction] = []
    private(set) var busy = false
    private(set) var connectedProvider = false
    var reaiInput = ""
    var inputs: [String: String] = [:]
    var companyID = 0 { didSet { if oldValue != companyID { banks = []; bankTransactions = []; payouts = []; bankID = 0 } } }
    var bankID = 0
    var month = Date()
    var error: String?
    var notice: String?
    var company: Company? { account?.tenants.first { $0.id == companyID } }
    var availableBanks: [CompanyBank] { banks.filter { !$0.archived && $0.currency == company?.currencyCode } }
    var rows: [ReviewRow] { payouts.map { payout in
        let candidates = bankTransactions.filter { tx in
            tx.currency == payout.currency && Int64((tx.amount * 100).rounded()) == payout.amountMinor &&
            abs((AppDates.parse(tx.transactionDate)?.timeIntervalSince(AppDates.parse(payout.date) ?? .distantPast) ?? 999999999)) <= 8 * 86400
        }
        let exact = candidates.filter { tx in
            let needle = payout.reference.trimmingCharacters(in: .whitespacesAndNewlines)
            return !needle.isEmpty && ((tx.paymentReference?.localizedCaseInsensitiveContains(needle) ?? false) ||
                (tx.description?.localizedCaseInsensitiveContains(needle) ?? false))
        }
        if exact.count == 1 { return ReviewRow(payout: payout, match: exact[0], status: "Reference + amount") }
        if candidates.count == 1 {
            let competing = payouts.filter { other in
                other.id != payout.id && other.currency == payout.currency && other.amountMinor == payout.amountMinor &&
                abs((AppDates.parse(other.date)?.timeIntervalSince(AppDates.parse(candidates[0].transactionDate) ?? .distantPast) ?? 999999999)) <= 8 * 86400
            }
            if competing.isEmpty { return ReviewRow(payout: payout, match: candidates[0], status: "Amount/date candidate") }
            return ReviewRow(payout: payout, match: nil, status: "Several payouts fit")
        }
        return ReviewRow(payout: payout, match: nil, status: candidates.count > 1 ? "Several candidates" : "No pending bank match")
    } }
    func start() async {
        do {
            reaiToken = try await reaiStore.load()
            if let text = try await providerStore.load(), let data = text.data(using: .utf8) {
                providerFields = try JSONDecoder().decode([String: String].self, from: data)
                connectedProvider = true
            }
            if let token = reaiToken {
                account = try await reai.request("api/me", token: token)
                companyID = account?.tenants.first?.id ?? 0
                try await loadBanks()
            }
        } catch { self.error = error.localizedDescription }
    }
    func connectReAI() {
        let token = reaiInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { error = "Paste a ReAI user access token."; return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                let loaded: Account = try await reai.request("api/me", token: token)
                guard !loaded.tenants.isEmpty else { throw appError("This ReAI token has no accessible companies.") }
                try await reaiStore.save(token)
                reaiToken = token; reaiInput = ""; account = loaded
                companyID = loaded.tenants[0].id
                try await loadBanks()
            } catch { self.error = error.localizedDescription }
        }
    }
    func saveProvider() {
        let values = Dictionary(uniqueKeysWithValues: AppInfo.fields.map { ($0.key, inputs[$0.key]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "") })
        guard values.values.allSatisfy({ !$0.isEmpty }) else { error = "Fill in every provider credential field."; return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                try await provider.validate(values)
                let data = try JSONEncoder().encode(values)
                try await providerStore.save(String(decoding: data, as: UTF8.self))
                providerFields = values; connectedProvider = true; inputs = [:]
                notice = "Provider credentials saved in this Mac's Keychain."
            } catch { self.error = error.localizedDescription }
        }
    }
    func removeProvider() {
        Task {
            do { try await providerStore.delete(); providerFields = nil; connectedProvider = false; payouts = []; bankTransactions = []; notice = "Provider credentials removed." }
            catch { self.error = error.localizedDescription }
        }
    }
    func removeReAI() {
        Task {
            do { try await reaiStore.delete(); reaiToken = nil; account = nil; companyID = 0; notice = "ReAI token removed." }
            catch { self.error = error.localizedDescription }
        }
    }
    func loadBanks() async throws {
        guard let token = reaiToken, companyID > 0 else { return }
        let rows: [CompanyBank] = try await reai.request("api/company-banks", token: token, company: companyID)
        banks = rows
        bankID = availableBanks.first?.id ?? 0
    }
    func refreshBanks() {
        busy = true; error = nil
        Task { defer { busy = false }; do { try await loadBanks() } catch { self.error = error.localizedDescription } }
    }
    func review() {
        guard let token = reaiToken, let fields = providerFields, companyID > 0, bankID > 0 else { error = "Connect both accounts and select a bank account."; return }
        let selectedCompany = companyID, selectedBank = bankID
        let interval = AppDates.monthRange(month)
        let selectedMonth = AppDates.month(month)
        guard let currency = company?.currencyCode, ["NOK", "SEK", "DKK", "EUR", "GBP", "USD"].contains(currency) else {
            error = "This version supports two-decimal currencies only."; return
        }
        busy = true; error = nil; notice = nil
        Task {
            defer { busy = false }
            do {
                let fetched = try await provider.payouts(fields, start: interval.start, end: interval.end)
                let bank: Reconciliation = try await reai.request("api/bank-reconciliations/\(selectedBank)", token: token, company: selectedCompany, query: [URLQueryItem(name: "month", value: selectedMonth)])
                guard companyID == selectedCompany, bankID == selectedBank else { return }
                payouts = fetched.filter { $0.currency == currency }.sorted { $0.date > $1.date }
                bankTransactions = bank.pendingTransactions ?? []
                let excluded = fetched.count - payouts.count
                notice = "Loaded \(payouts.count) payouts and \(bankTransactions.count) pending ReAI bank transactions. \(excluded) other-currency payouts excluded. Review candidates before posting in ReAI."
            } catch { self.error = error.localizedDescription }
        }
    }
    func exportCSV() {
        guard !payouts.isEmpty else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "\(AppInfo.slug)-reconciliation-\(AppDates.month(month)).csv"
        panel.allowedContentTypes = [.commaSeparatedText]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let lines = ["provider,reference,payout_date,amount,currency,match_status,reai_bank_transaction_id,detail"] + rows.map { row in
            [AppInfo.brand, row.payout.reference, row.payout.date, String(format: "%.2f", row.payout.amount), row.payout.currency, row.status,
             row.match.map { String($0.id) } ?? "", row.payout.detail].map(Self.csv).joined(separator: ",")
        }
        do { try (lines.joined(separator: "\r\n") + "\r\n").write(to: url, atomically: true, encoding: .utf8); notice = "Saved review CSV." }
        catch { self.error = error.localizedDescription }
    }
    private static func csv(_ value: String) -> String { "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
}

@MainActor enum AppDates {
    static let calendar = Calendar.current
    static let formatter: DateFormatter = { let f = DateFormatter(); f.calendar = calendar; f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = .current; f.dateFormat = "yyyy-MM-dd"; return f }()
    static func day(_ date: Date) -> String { formatter.string(from: date) }
    static func parse(_ value: String) -> Date? { formatter.date(from: String(value.prefix(10))) }
    static func month(_ date: Date) -> String { String(day(date).prefix(7)) }
    static func monthRange(_ date: Date) -> (start: String, end: String) {
        let start = String(month(date) + "-01")
        let first = parse(start)!
        let next = calendar.date(byAdding: .month, value: 1, to: first)!
        return (start, day(next))
    }
}
