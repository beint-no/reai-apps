import Foundation

enum InvoiceKind: String, CaseIterable, Sendable {
    case invoice
    case creditNote
    var scope: String { rawValue }
    var title: String { self == .invoice ? "Invoice" : "Credit Note" }
}

struct RecManInvoice: Decodable, Identifiable, Sendable {
    struct Line: Decodable, Sendable {
        struct Code: Decodable, Sendable {
            let value: String

            init(from decoder: Decoder) throws {
                let box = try decoder.singleValueContainer()
                if let text = try? box.decode(String.self) {
                    value = text
                } else {
                    value = String(try box.decode(Int.self))
                }
            }
        }

        let productId: Int
        let description: String
        let qty: Decimal
        let price: Decimal
        let sumExclVat: Decimal
        let sumVat: Decimal
        let sumInclVat: Decimal
        let vatPercent: Decimal
        let creditAccount: Code?
        let vatCode: Code?
    }

    let id: Int
    let kind: InvoiceKind
    let number: Int
    let date: String
    let dueDate: String?
    let companyId: Int
    let departmentId: Int
    let identificationCode: String?
    let paid: Int?
    let lines: [Line]

    var key: String { "\(kind.scope)-\(departmentId)-\(id)" }
    var total: Decimal { lines.reduce(0) { $0 + $1.sumInclVat } }

    private enum CodingKeys: String, CodingKey {
        case invoiceId, creditNoteId, number, date, dueDate, companyId, departmentId, identificationCode, paid, lines
    }

    init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        if let creditID = try box.decodeIfPresent(Int.self, forKey: .creditNoteId) {
            id = creditID
            kind = .creditNote
        } else {
            id = try box.decode(Int.self, forKey: .invoiceId)
            kind = .invoice
        }
        number = try box.decode(Int.self, forKey: .number)
        date = try box.decode(String.self, forKey: .date)
        dueDate = try box.decodeIfPresent(String.self, forKey: .dueDate)
        companyId = try box.decode(Int.self, forKey: .companyId)
        departmentId = try box.decode(Int.self, forKey: .departmentId)
        identificationCode = try box.decodeIfPresent(String.self, forKey: .identificationCode)
        paid = try box.decodeIfPresent(Int.self, forKey: .paid)
        lines = try box.decode(RecManRows<Line>.self, forKey: .lines).values
    }
}

struct RecManCompany: Codable, Sendable {
    struct Address: Codable, Hashable, Sendable {
        let address1: String?
        let postalCode: String?
        let city: String?

        var label: String { [address1, postalCode, city].compactMap(normalizedIdentity).joined(separator: " ") }
    }

    let companyId: String
    let name: String
    let number: String?
    let vatNumber: String?
    let visitAddress: Address?

    var organizationNumber: String? {
        guard let vatNumber else { return nil }
        let value = vatNumber.uppercased().replacingOccurrences(of: " ", with: "")
        let number = (value.hasPrefix("NO") ? String(value.dropFirst(2)) : value)
            .replacingOccurrences(of: "MVA", with: "")
        guard number.range(of: #"^[0-9]{9}$"#, options: .regularExpression) != nil else { return nil }
        let digits = number.compactMap(\.wholeNumberValue)
        let sum = zip(digits, [3, 2, 7, 6, 5, 4, 3, 2]).reduce(0) { $0 + $1.0 * $1.1 }
        return digits.last == (11 - sum % 11) % 11 ? number : nil
    }
}

struct RecManProduct: Codable, Sendable {
    let productId: Int
    let name: String
    let creditAccount: String
    let vatCode: String
}

struct RecManWork: Decodable, Sendable {
    let workId: Int
    let candidateId: Int
    let projectId: Int
    let jobId: Int
}

struct RecManProject: Codable, Sendable {
    let projectId: Int
    let companyId: Int?
    let name: String?

    private enum CodingKeys: String, CodingKey { case projectId, companyId, name }

    init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = try box.decode(RecManNumber.self, forKey: .projectId).positiveID else {
            throw appError("RecMan returned an invalid project ID.")
        }
        projectId = id
        companyId = try box.decodeIfPresent(RecManNumber.self, forKey: .companyId)?.positiveID
        name = try box.decodeIfPresent(String.self, forKey: .name)
    }
}

struct RecManPaycheck: Decodable, Sendable {
    struct Line: Decodable, Sendable {
        let paycheckLineId: Int
        let articleId: Int
        let articleName: String
        let articleType: String
        let employmentId: Int
        let workId: Int?
        let qty: Decimal
        let amount: Decimal
        let total: Decimal
        let startDate: String
        let endDate: String
    }

    let paycheckId: Int
    let candidateId: Int
    let departmentId: Int
    let lines: RecManRows<Line>
}

struct AccountingOption: Identifiable, Equatable, Sendable {
    let id: String
    let label: String
}

struct AccountingMapping: Identifiable, Sendable {
    let id: String
    let label: String
    let options: [AccountingOption]
    let suggestion: String?
    var municipalityInput = false
    var municipalitySuggestion: AccountingOption?

    func accepts(_ choice: String?) -> Bool {
        guard let choice else { return false }
        return municipalityInput
            ? choice.range(of: #"^[0-9]{4}$"#, options: .regularExpression) != nil && choice != "0000"
            : options.contains(where: { $0.id == choice })
    }
}

enum AccountingScope: String, CaseIterable {
    case employees = "Employees & Payroll"
    case invoices = "Invoices"
}

func roundedMoney(_ value: Decimal) -> Decimal {
    var input = value
    var rounded = Decimal()
    NSDecimalRound(&rounded, &input, 2, .plain)
    return rounded
}

func decimalJSON(_ value: Decimal) -> NSDecimalNumber { NSDecimalNumber(decimal: value) }

func normalizedIdentity(_ value: String?) -> String? {
    guard let text = value?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
    return text
}

func accountingDate(_ text: String) -> Bool {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withFullDate]
    guard let date = formatter.date(from: text) else { return false }
    return formatter.string(from: date) == text
}

func osloDate(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "Europe/Oslo")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
}
