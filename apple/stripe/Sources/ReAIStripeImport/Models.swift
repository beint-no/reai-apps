import Foundation

func appError(_ message: String, code: Int = 0) -> NSError {
    NSError(domain: "no.reai.stripeimport", code: code, userInfo: [NSLocalizedDescriptionKey: message])
}

enum AppEnvironment {
    static let origin = URL(string: "https://app.reai.no")!
    static let profile = URL(string: "https://app.reai.no/user/profile#user-access-tokens")!
}

struct Company: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let companyName: String
    let currencyCode: String
}
struct Account: Decodable, Sendable { let tenants: [Company] }
struct Customer: Decodable, Identifiable, Sendable {
    let id: Int
    let name: String?
    let email: String?
    let invoiceEmail: String?
    let archived: Bool
}
struct Product: Decodable, Identifiable, Sendable {
    let id: Int
    let title: String
    let archived: Bool
    let stockItem: Bool
    let vatCode: String?
}
struct VATCode: Decodable, Sendable { let code: String; let rate: Double; let vatType: String }
struct ImportedInvoice: Decodable, Sendable { let id: Int }
struct SubscriptionSummary: Decodable, Sendable { let id: Int? }
struct SubscriptionDetail: Decodable, Sendable { let internalComment: String? }
struct CreatedSubscription: Decodable, Sendable { let id: Int? }

struct StripeAccount: Decodable, Sendable { let id: String }
struct StripePage<T: Decodable & Sendable>: Decodable, Sendable {
    let data: [T]
    let has_more: Bool
}
struct StripeInvoice: Decodable, Identifiable, Sendable {
    struct StatusTransitions: Decodable, Sendable { let paid_at: Int?; let finalized_at: Int? }
    struct TaxAmount: Decodable, Sendable { let amount: Int }
    let id: String
    let number: String?
    let customer_email: String?
    let customer_name: String?
    let currency: String
    let created: Int
    let due_date: Int?
    let status: String?
    let amount_paid: Int
    let amount_due: Int
    let amount_overpaid: Int?
    let amount_remaining: Int
    let total: Int
    let total_excluding_tax: Int?
    let total_tax_amounts: [TaxAmount]?
    let total_taxes: [TaxAmount]?
    let status_transitions: StatusTransitions?
    let starting_balance: Int?
    let ending_balance: Int?
    let pre_payment_credit_notes_amount: Int?
    let post_payment_credit_notes_amount: Int?
    var paidAt: Int? { status_transitions?.paid_at }
    var issuedAt: Int { status_transitions?.finalized_at ?? created }
}
struct StripeCustomer: Decodable, Sendable { let id: String; let email: String?; let name: String? }
struct StripeSubscription: Decodable, Identifiable, Sendable {
    struct Price: Decodable, Sendable {
        struct Recurring: Decodable, Sendable { let interval: String; let interval_count: Int; let usage_type: String? }
        let unit_amount: Int?
        let currency: String
        let recurring: Recurring?
        let nickname: String?
        let billing_scheme: String?
    }
    struct Item: Decodable, Sendable {
        let id: String
        let price: Price
        let quantity: Int?
        let current_period_end: Int?
        let tax_rates: [String]?
        let discounts: [String]?
        enum CodingKeys: String, CodingKey { case id, price, quantity, current_period_end, tax_rates, discounts }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            price = try c.decode(Price.self, forKey: .price)
            quantity = try c.decodeIfPresent(Int.self, forKey: .quantity)
            current_period_end = try c.decodeIfPresent(Int.self, forKey: .current_period_end)
            tax_rates = try? c.decode([String].self, forKey: .tax_rates)
            discounts = try? c.decode([String].self, forKey: .discounts)
        }
    }
    struct Items: Decodable, Sendable { let data: [Item]; let has_more: Bool }
    let id: String
    let status: String
    let currency: String?
    let customer: StripeCustomer?
    let items: Items
    let current_period_end: Int?
    let cancel_at_period_end: Bool?
    let automatic_tax: AutomaticTax?
    let default_tax_rates: [String]?
    let discounts: [String]?
    struct AutomaticTax: Decodable, Sendable { let enabled: Bool }

    enum CodingKeys: String, CodingKey {
        case id, status, currency, customer, items, current_period_end, cancel_at_period_end, automatic_tax, default_tax_rates, discounts
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        status = try c.decode(String.self, forKey: .status)
        currency = try c.decodeIfPresent(String.self, forKey: .currency)
        customer = try? c.decode(StripeCustomer.self, forKey: .customer)
        items = try c.decode(Items.self, forKey: .items)
        current_period_end = try c.decodeIfPresent(Int.self, forKey: .current_period_end)
        cancel_at_period_end = try c.decodeIfPresent(Bool.self, forKey: .cancel_at_period_end)
        automatic_tax = try c.decodeIfPresent(AutomaticTax.self, forKey: .automatic_tax)
        default_tax_rates = (try? c.decode([String].self, forKey: .default_tax_rates))
        discounts = (try? c.decode([String].self, forKey: .discounts))
    }
}

@MainActor enum Dates {
    static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(secondsFromGMT: 0)
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    static func day(_ seconds: Int) -> String { formatter.string(from: Date(timeIntervalSince1970: TimeInterval(seconds))) }
}
