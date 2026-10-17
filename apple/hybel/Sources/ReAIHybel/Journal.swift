import Foundation
import CryptoKit

func appError(_ message: String) -> NSError {
    NSError(domain: "no.reai.hybeljournal", code: 0, userInfo: [NSLocalizedDescriptionKey: message])
}
enum AppEnvironment { static let origin = URL(string: "https://app.reai.no")! }

struct CSVDocument: Sendable {
    let headers: [String]
    let rows: [[String]]
    static func read(_ data: Data) throws -> Self {
        guard data.count <= 10_000_000 else { throw appError("Choose a CSV smaller than 10 MB.") }
        guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .windowsCP1252) else {
            throw appError("Save the journal as UTF-8 or Windows-1252 CSV.")
        }
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let first = normalized.prefix { $0 != "\n" && $0 != "\r" }
        let separator: Character = first.filter { $0 == ";" }.count > first.filter { $0 == "," }.count ? ";" : ","
        var result: [[String]] = [], row: [String] = [], field = "", quoted = false, closed = false
        let chars = Array(normalized.replacingOccurrences(of: "\u{FEFF}", with: ""))
        var index = 0
        while index < chars.count {
            let c = chars[index]
            if quoted {
                if c == "\"" {
                    if index + 1 < chars.count && chars[index + 1] == "\"" { field.append("\""); index += 1 }
                    else { quoted = false; closed = true }
                } else { field.append(c) }
            } else if c == separator {
                row.append(field); field = ""; closed = false
            } else if c == "\r" || c == "\n" {
                row.append(field); field = ""; closed = false
                if row.contains(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) { result.append(row) }
                row = []
                if c == "\r" && index + 1 < chars.count && chars[index + 1] == "\n" { index += 1 }
            } else if c == "\"" && field.isEmpty && !closed { quoted = true }
            else {
                guard !closed && c != "\"" else { throw appError("Malformed CSV quoting. Export the original CSV again.") }
                field.append(c)
            }
            index += 1
        }
        guard !quoted else { throw appError("The CSV ends inside a quoted field.") }
        if !field.isEmpty || !row.isEmpty { row.append(field); result.append(row) }
        guard let headers = result.first, headers.count > 1, headers.count <= 100, result.count > 1, result.count <= 5001 else {
            throw appError("Choose a CSV with a header and 1–5,000 journal lines.")
        }
        guard result.dropFirst().allSatisfy({ $0.count == headers.count }) else { throw appError("Every CSV row must have the same number of columns as the header.") }
        return Self(headers: headers, rows: Array(result.dropFirst()))
    }
}

struct ColumnMap: Equatable, Sendable {
    var date = -1, account = -1, amount = -1, debit = -1, credit = -1, reference = -1, description = -1, vat = -1
    var complete: Bool { date >= 0 && account >= 0 && reference >= 0 && (amount >= 0 || (debit >= 0 && credit >= 0)) }
}
struct JournalEntry: Identifiable, Sendable {
    let id: Int
    let date: String
    let account: String
    let minor: Int64
    let reference: String
    let description: String
    var amount: String { NSDecimalNumber(value: minor).dividing(by: 100).stringValue }
}
struct Journal: Sendable {
    let entries: [JournalEntry]
    let month: String
    let debitMinor: Int64
    let fingerprint: String
    var lastDate: String { entries.map(\.date).max()! }
    static func build(_ csv: CSVDocument, mapping m: ColumnMap) throws -> Self {
        guard m.complete else { throw appError("Map date, account, reference and signed amount (or both debit and credit amounts).") }
        let columns = [m.date, m.account, m.reference, m.amount, m.debit, m.credit, m.description, m.vat].filter { $0 >= 0 }
        guard Set(columns).count == columns.count else { throw appError("Choose a separate source column for each mapped field.") }
        var entries: [JournalEntry] = []
        for (i, row) in csv.rows.enumerated() {
            func value(_ column: Int) -> String { column < 0 ? "" : row[column].trimmingCharacters(in: .whitespacesAndNewlines) }
            let date = try parseDay(value(m.date))
            let account = value(m.account)
            guard account.range(of: "^[1-8][0-9]{3}$", options: .regularExpression) != nil else {
                throw appError("Line \(i + 2): use a four-digit Norwegian general-ledger account.")
            }
            let vat = value(m.vat)
            guard vat.isEmpty || vat == "0" else { throw appError("Line \(i + 2): this version only supports VAT code 0. VAT must be reviewed separately.") }
            let amount: Int64
            if m.amount >= 0 { amount = try minor(value(m.amount)) }
            else {
                let debit = try minor(value(m.debit)), credit = try minor(value(m.credit))
                guard debit >= 0, credit >= 0, debit == 0 || credit == 0 else { throw appError("Line \(i + 2): debit and credit must be nonnegative, with only one nonzero.") }
                amount = debit - credit
            }
            if amount == 0 { continue }
            let ref = value(m.reference)
            guard !ref.isEmpty, ref.count <= 100 else { throw appError("Line \(i + 2): include the source voucher/BatchID reference (up to 100 characters).") }
            let description = value(m.description)
            guard description.count <= 500 else { throw appError("Line \(i + 2): description exceeds 500 characters.") }
            entries.append(JournalEntry(id: i, date: date, account: account, minor: amount, reference: ref, description: description))
        }
        guard let first = entries.first, Set(entries.map { String($0.date.prefix(7)) }).count == 1 else {
            throw appError("Choose one complete calendar month with nonzero postings.")
        }
        let groups = Dictionary(grouping: entries, by: { $0.date + "|" + $0.reference })
        for (_, rows) in groups {
            guard rows.reduce(Int64(0), { $0 + $1.minor }) == 0 else {
                throw appError("Source reference \(rows[0].reference), \(rows[0].date), does not balance. Include both sides of every entry.")
            }
        }
        let canonical = entries.map { "\($0.date)|\($0.account)|\($0.minor)|\($0.reference)|\($0.description)" }.sorted().joined(separator: "\n")
        let hash = SHA256.hash(data: Data(canonical.utf8)).map { String(format: "%02x", $0) }.joined()
        return Self(entries: entries, month: String(first.date.prefix(7)), debitMinor: entries.filter { $0.minor > 0 }.reduce(0) { $0 + $1.minor }, fingerprint: hash)
    }
    static func monthEnd(_ month: String) -> String {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let parts = month.split(separator: "-").compactMap { Int($0) }
        let start = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: 1))!
        let end = calendar.date(byAdding: DateComponents(month: 1, day: -1), to: start)!
        let formatter = DateFormatter(); formatter.calendar = calendar; formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = calendar.timeZone; formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: end)
    }
    static func minor(_ input: String) throws -> Int64 {
        if input.isEmpty { return 0 }
        let text = input.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\u{00A0}", with: "").replacingOccurrences(of: ",", with: ".")
        guard text.range(of: "^[+-]?[0-9]+(?:\\.[0-9]{1,2})?$", options: .regularExpression) != nil,
              let decimal = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")), abs(decimal) <= 100_000_000 else {
            throw appError("Invalid amount '\(input.prefix(40))'. Use decimal comma or point and no more than two decimals; maximum 100 million per line.")
        }
        return NSDecimalNumber(decimal: decimal * 100).int64Value
    }
    static func parseDay(_ input: String) throws -> String {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.isLenient = false
        for format in ["yyyy-MM-dd", "dd.MM.yyyy", "dd/MM/yyyy"] {
            formatter.dateFormat = format
            if let date = formatter.date(from: input), formatter.string(from: date) == input {
                formatter.dateFormat = "yyyy-MM-dd"; return formatter.string(from: date)
            }
        }
        throw appError("Invalid date '\(input.prefix(40))'. Use yyyy-MM-dd, dd.MM.yyyy or dd/MM/yyyy.")
    }
    func postings(bankAccounts: [String: Int]) -> [[String: Any]] {
        let groups = Dictionary(grouping: entries, by: { $0.date + "|" + $0.reference })
        var result: [[String: Any]] = [], rowNumber = 0
        for key in groups.keys.sorted() {
            let rows = groups[key]!
            let debits = rows.filter { $0.minor > 0 }, credits = rows.filter { $0.minor < 0 }
            var d = 0, c = 0, debitLeft = debits[0].minor, creditLeft = -credits[0].minor
            while d < debits.count && c < credits.count {
                let amount = min(debitLeft, creditLeft)
                let description = "Hybel \(rows[0].reference): " + Array(Set([debits[d].description, credits[c].description])).sorted().filter { !$0.isEmpty }.joined(separator: " / ")
                for (entry, signed) in [(debits[d], amount), (credits[c], -amount)] {
                    var posting: [String: Any] = ["accountNumber": entry.account, "postingDate": entry.date, "currency": "NOK", "amount": NSDecimalNumber(value: signed).dividing(by: 100), "vatCode": "0", "rowNumber": rowNumber, "description": String(description.prefix(1000))]
                    if let bank = bankAccounts[entry.account] { posting["companyBankId"] = bank }
                    result.append(posting)
                }
                rowNumber += 1; debitLeft -= amount; creditLeft -= amount
                if debitLeft == 0 { d += 1; if d < debits.count { debitLeft = debits[d].minor } }
                if creditLeft == 0 { c += 1; if c < credits.count { creditLeft = -credits[c].minor } }
            }
        }
        return result
    }
}
