import AppKit
import Foundation
import Observation

struct Company: Decodable, Hashable, Identifiable, Sendable { let id: Int; let companyName: String; let currencyCode: String }
struct Account: Decodable, Sendable { let tenants: [Company] }
struct Registry: Decodable, Sendable { let name: String; let organizationNumber: String? }
struct Settings: Decodable, Sendable { let company: Registry; let vatRegistered: Bool }
struct LedgerAccount: Decodable, Sendable {
    let accountNumber: String; let number: String; let restrictedToSystemUsage: Bool
    let subsidiaryLedger: Subsidiary?
    struct Subsidiary: Decodable, Sendable { let type: String; let id: Int }
}
struct Bank: Decodable, Sendable { let id: Int; let ledgerAccountNumber: String; let currency: String; let archived: Bool }
struct Voucher: Decodable, Sendable { let id: Int; let number: String; let description: String? }
struct Attempt: Codable { let marker: String; let fingerprint: String; var voucherID: Int? }

@MainActor @Observable final class JournalModel {
    let api = ReAIAPI()
    let credentials = Credentials()
    private var token: String?
    var companies: [Company] = []
    var companyID = 0 { didSet { if oldValue != companyID { invalidate(); registry = nil } } }
    var keyInput = ""
    var code: String?
    var csv: CSVDocument?
    var filename = ""
    var mapping = ColumnMap() { didSet { if oldValue != mapping { invalidate() } } }
    var journal: Journal?
    var registry: Registry?
    var notice: String?
    var error: String?
    var busy = false
    var confirmedCompany = false
    var confirmedSource = false
    var confirmedNoVAT = false
    var confirmedNotBooked = false
    var sourceOrganization = "" { didSet { if oldValue != sourceOrganization { invalidate() } } }
    var voucherID: Int?
    private var banks: [String: Int] = [:]
    private var preparedCompany = 0
    private var preparedMarker = ""
    var company: Company? { companies.first { $0.id == companyID } }
    var canPost: Bool { !busy && journal != nil && preparedCompany == companyID && companyID > 0 && confirmedCompany && confirmedSource && confirmedNoVAT && confirmedNotBooked && voucherID == nil }
    var voucherURL: URL? { voucherID.flatMap { URL(string: "https://app.reai.no/voucher/\($0)?tenantId=\(companyID)") } }
    private func invalidate() {
        journal = nil; preparedCompany = 0; preparedMarker = ""; banks = [:]
        confirmedCompany = false; confirmedSource = false; confirmedNoVAT = false; confirmedNotBooked = false; voucherID = nil
    }
    func start() async {
        do { if let saved = try await credentials.load() { try await accept(saved) } }
        catch { self.error = error.localizedDescription }
    }
    private func accept(_ value: String) async throws {
        let account: Account = try await api.request("api/me", token: value)
        guard !account.tenants.isEmpty else { throw appError("This connection has no accessible companies.") }
        try await credentials.save(value)
        token = value; companies = account.tenants; companyID = companies.count == 1 ? companies[0].id : 0; keyInput = ""
    }
    func connect(browser: Bool) {
        busy = true; error = nil
        Task {
            defer { busy = false; code = nil }
            do {
                let value: String
                if browser { value = try await Connection().authorize { code in await MainActor.run { self.code = code } } }
                else {
                    value = keyInput.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !value.isEmpty else { throw appError("Paste a ReAI user API key.") }
                }
                try await accept(value)
            } catch { self.error = error.localizedDescription }
        }
    }
    func disconnect() {
        busy = true
        Task {
            defer { busy = false }
            do { try await credentials.delete(); token = nil; companies = []; companyID = 0; invalidate(); registry = nil }
            catch { self.error = error.localizedDescription }
        }
    }
    func openCSV() {
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.commaSeparatedText, .plainText]; panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 10_000_000 else { throw appError("Choose a CSV smaller than 10 MB.") }
            let parsed = try CSVDocument.read(Data(contentsOf: url)); invalidate(); csv = parsed; filename = url.lastPathComponent
            mapping = ColumnMap(); notice = "Map the journal columns, then validate against the selected ReAI company."
        } catch { self.error = error.localizedDescription }
    }
    private func attemptURL(_ tenant: Int, month: String) throws -> URL {
        let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appending(path: "ReAIHybelJournal", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        return directory.appending(path: "\(tenant)-\(month).json")
    }
    private func findExisting(_ marker: String, month: String, tenant: Int, token: String) async throws -> Voucher? {
        let vouchers: [Voucher] = try await api.request("api/vouchers", token: token, company: tenant,
            query: [URLQueryItem(name: "startDate", value: month + "-01"), URLQueryItem(name: "endDate", value: Journal.monthEnd(month)), URLQueryItem(name: "includeReversed", value: "true")])
        return vouchers.first { $0.description?.hasPrefix(marker) == true }
    }
    func validate() {
        guard let csv, let token, let company else { error = "Open a journal and select the ReAI company."; return }
        invalidate(); busy = true; error = nil; notice = nil
        let selected = company.id, source = sourceOrganization.trimmingCharacters(in: .whitespacesAndNewlines), map = mapping
        Task {
            defer { busy = false }
            do {
                let parsed = try Journal.build(csv, mapping: map)
                let settings: Settings = try await api.request("api/company-settings", token: token, company: selected)
                guard company.currencyCode == "NOK", source.range(of: "^[0-9]{9}$", options: .regularExpression) != nil, source == settings.company.organizationNumber else {
                    throw appError("Enter the organization number shown on the source report. It must match a Norwegian NOK company in ReAI.")
                }
                let options: [LedgerAccount] = try await api.request("api/chart-of-accounts/accounts", token: token, company: selected)
                let availableBanks: [Bank] = try await api.request("api/company-banks", token: token, company: selected)
                var selectedBanks: [String: Int] = [:]
                for accountNumber in Set(parsed.entries.map(\.account)) {
                    let matches = options.filter { $0.accountNumber == accountNumber }
                    guard matches.contains(where: { !$0.restrictedToSystemUsage }) else { throw appError("Account \(accountNumber) is missing or restricted in ReAI.") }
                    let subsidiaries = matches.compactMap(\.subsidiaryLedger)
                    if subsidiaries.contains(where: { $0.type != "bank" }) || ["1500", "2400", "2910"].contains(accountNumber) {
                        throw appError("Account \(accountNumber) requires a subsidiary ledger. This version imports general-ledger journals only; use Hybel's configured general-ledger export, keeping tenant detail in Hybel.")
                    }
                    if accountNumber.hasPrefix("19") || subsidiaries.contains(where: { $0.type == "bank" }) {
                        let bankMatches = availableBanks.filter { $0.ledgerAccountNumber == accountNumber && !$0.archived && $0.currency == "NOK" }
                        guard bankMatches.count == 1 else { throw appError("Account \(accountNumber) must identify exactly one active NOK bank account in ReAI.") }
                        selectedBanks[accountNumber] = bankMatches[0].id
                    }
                }
                let marker = "Hybel journal \(source) \(parsed.month)"
                if let existing = try await findExisting(marker, month: parsed.month, tenant: selected, token: token) {
                    voucherID = existing.id; throw appError("A journal for this company/month already exists: \(existing.number). Review it in ReAI. Do not import again.")
                }
                let state = try attemptURL(selected, month: parsed.month)
                if FileManager.default.fileExists(atPath: state.path) {
                    throw appError("This Mac has an earlier import attempt for this company/month. Review the saved checkpoint and ReAI voucher history before any retry. No write was made by this validation.")
                }
                guard companyID == selected else { return }
                registry = settings.company; journal = parsed; banks = selectedBanks; preparedCompany = selected; preparedMarker = marker
                notice = "Validated \(parsed.entries.count) postings for \(settings.company.name), \(parsed.month). Every source reference balances. Review all lines below before creating the voucher."
            } catch { self.error = error.localizedDescription }
        }
    }
    func post() {
        guard canPost, let token, let journal else { return }
        let tenant = companyID, marker = preparedMarker, bankMap = banks
        busy = true; error = nil; notice = nil
        Task {
            defer { busy = false }
            do {
                if let existing = try await findExisting(marker, month: journal.month, tenant: tenant, token: token) {
                    voucherID = existing.id; throw appError("The journal already exists in ReAI as \(existing.number). No write was made.")
                }
                let path = try attemptURL(tenant, month: journal.month)
                guard !FileManager.default.fileExists(atPath: path.path) else { throw appError("An import checkpoint already exists. Review ReAI before retrying.") }
                let body = try JSONSerialization.data(withJSONObject: ["date": journal.lastDate, "description": marker + " sha256:" + journal.fingerprint,
                    "reviewReason": "Check the attached Hybel journal/period report, BatchIDs, cutoff, bank entries and VAT code 0. Tenant-level subledger remains in Hybel. Attach source documentation before clearing review.",
                    "postings": journal.postings(bankAccounts: bankMap)])
                let attempt = Attempt(marker: marker, fingerprint: journal.fingerprint, voucherID: nil)
                try JSONEncoder().encode(attempt).write(to: path, options: .withoutOverwriting)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
                let created: Voucher = try await api.request("api/manual-vouchers", token: token, company: tenant, body: body)
                voucherID = created.id; confirmedNotBooked = false
                var completed = attempt; completed.voucherID = created.id
                try JSONEncoder().encode(completed).write(to: path, options: .atomic)
                notice = "Created voucher \(created.number), flagged for accountant review. Attach the original journal and period report in ReAI before clearing review."
            } catch {
                self.error = error.localizedDescription + " If a request was sent, check ReAI before retrying; the checkpoint prevents a second write."
            }
        }
    }
}
