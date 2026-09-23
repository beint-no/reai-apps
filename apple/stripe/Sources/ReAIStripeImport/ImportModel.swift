import AppKit
import Foundation
import Observation

@MainActor @Observable final class ImportModel {
    private let reai = ReAIAPI()
    private let stripe = StripeAPI()
    private let reaiStore = Credentials(account: "reai-access-token")
    private let stripeStore = Credentials(account: "stripe-restricted-key")
    private let connection = Connection()
    private var reaiToken: String?
    private var stripeKey: String?
    private(set) var stripeAccount: String?
    private(set) var account: Account?
    private(set) var invoices: [StripeInvoice] = []
    private(set) var subscriptions: [StripeSubscription] = []
    private(set) var customers: [Customer] = []
    private(set) var products: [Product] = []
    private(set) var vatCodes: [VATCode] = []
    private(set) var truncated = false
    private(set) var busy = false
    private(set) var code = ""
    var stripeInput = ""
    var selectedCompany = 0 { didSet { if oldValue != selectedCompany { clearReAIData() } } }
    var selectedProduct = 0
    var notice: String?
    var error: String?

    var company: Company? { account?.tenants.first(where: { $0.id == selectedCompany }) }
    var zeroVATProducts: [Product] {
        let zeroCodes = Set(vatCodes.filter { $0.rate == 0 && ($0.vatType == "output_vat" || $0.vatType == "outside_scope" || $0.vatType == "exempt") }.map(\.code))
        return products.filter { !$0.archived && !$0.stockItem && $0.vatCode.map(zeroCodes.contains) == true }
    }

    func start() async {
        busy = true
        defer { busy = false }
        do {
            reaiToken = try await reaiStore.load()
            stripeKey = try await stripeStore.load()
            if let token = reaiToken {
                account = try await reai.request("api/me", token: token)
                if let first = account?.tenants.first { selectedCompany = first.id }
            }
            if let key = stripeKey { try await refreshStripe(key) }
            if account != nil { try await refreshReAI() }
        } catch { self.error = error.localizedDescription }
    }

    func connectReAI() {
        busy = true; error = nil; notice = nil
        Task {
            defer { busy = false; code = "" }
            do {
                let token = try await connection.authorize { [weak self] code in
                    await MainActor.run { self?.code = code }
                }
                try await reaiStore.save(token)
                reaiToken = token
                account = try await reai.request("api/me", token: token)
                selectedCompany = account?.tenants.first?.id ?? 0
                try await refreshReAI()
            } catch { self.error = error.localizedDescription }
        }
    }

    func saveStripeKey() {
        let key = stripeInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard key.hasPrefix("rk_live_") || key.hasPrefix("rk_test_") else {
            error = "Use a restricted Stripe key beginning rk_live_ or rk_test_."; return
        }
        busy = true; error = nil; notice = nil
        Task {
            defer { busy = false }
            do {
                try await refreshStripe(key)
                try await stripeStore.save(key)
                stripeKey = key
                stripeInput = ""
            } catch { self.error = error.localizedDescription }
        }
    }

    func refresh() {
        guard !busy, let key = stripeKey else { return }
        busy = true; error = nil; notice = nil
        Task {
            defer { busy = false }
            do {
                try await refreshStripe(key)
                try await refreshReAI()
            } catch { self.error = error.localizedDescription }
        }
    }

    private func refreshStripe(_ key: String) async throws {
        let account = try await stripe.account(key: key)
        let (fetchedInvoices, invoiceTruncated) = try await stripe.invoices(key: key)
        let (fetchedSubscriptions, subscriptionTruncated) = try await stripe.subscriptions(key: key)
        stripeAccount = account.id
        invoices = fetchedInvoices
        subscriptions = fetchedSubscriptions
        truncated = invoiceTruncated || subscriptionTruncated
    }

    private func refreshReAI() async throws {
        guard let token = reaiToken, selectedCompany > 0 else { return }
        let companyID = selectedCompany
        async let fetchedCustomers: [Customer] = reai.request("api/customers", token: token, company: companyID, query: [URLQueryItem(name: "archived", value: "false")])
        async let fetchedProducts: [Product] = reai.request("api/products", token: token, company: companyID)
        async let fetchedVAT: [VATCode] = reai.request("api/vat-codes", token: token, company: companyID, query: [URLQueryItem(name: "usage", value: "customer-invoice")])
        let (loadedCustomers, loadedProducts, loadedVAT) = try await (fetchedCustomers, fetchedProducts, fetchedVAT)
        guard selectedCompany == companyID else { return }
        customers = loadedCustomers
        products = loadedProducts
        vatCodes = loadedVAT
        if !zeroVATProducts.contains(where: { $0.id == selectedProduct }) { selectedProduct = zeroVATProducts.first?.id ?? 0 }
    }

    private func clearReAIData() {
        customers = []; products = []; vatCodes = []; selectedProduct = 0
    }

    private func matchedCustomer(_ email: String?) -> Customer? {
        guard let email = email?.trimmingCharacters(in: .whitespacesAndNewlines), !email.isEmpty else { return nil }
        let matches = customers.filter { !$0.archived && ($0.email?.caseInsensitiveCompare(email) == .orderedSame || $0.invoiceEmail?.caseInsensitiveCompare(email) == .orderedSame) }
        return matches.count == 1 ? matches[0] : nil
    }

    func invoiceReason(_ invoice: StripeInvoice) -> String? {
        guard reaiToken != nil, stripeAccount != nil, let company else { return "Connect both accounts" }
        guard selectedProduct > 0, zeroVATProducts.contains(where: { $0.id == selectedProduct }) else { return "Choose a zero-rate ReAI product" }
        guard ["NOK", "EUR", "USD", "GBP"].contains(company.currencyCode.uppercased()),
              invoice.currency.uppercased() == company.currencyCode.uppercased() else { return "Currency must match the ReAI company" }
        guard invoice.status == "paid", invoice.total > 0, invoice.amount_due == invoice.total,
              invoice.amount_paid == invoice.total, invoice.amount_remaining == 0,
              invoice.amount_overpaid == 0, invoice.starting_balance == 0,
              invoice.ending_balance == nil || invoice.ending_balance == 0,
              invoice.pre_payment_credit_notes_amount == 0, invoice.post_payment_credit_notes_amount == 0,
              invoice.paidAt != nil else { return "Only fully paid positive invoices" }
        guard invoice.total_excluding_tax == invoice.total,
              (invoice.total_tax_amounts != nil || invoice.total_taxes != nil),
              invoice.total_tax_amounts?.allSatisfy({ $0.amount == 0 }) ?? true,
              invoice.total_taxes?.allSatisfy({ $0.amount == 0 }) ?? true else { return "Tax could not be verified as zero" }
        guard let number = invoice.number, !number.isEmpty, number.count <= 100 else { return "Missing invoice number" }
        guard matchedCustomer(invoice.customer_email) != nil else { return "Match exactly one ReAI customer by email" }
        return nil
    }

    func subscriptionReason(_ subscription: StripeSubscription) -> String? {
        guard reaiToken != nil, stripeAccount != nil, let company else { return "Connect both accounts" }
        guard subscription.status == "active", subscription.cancel_at_period_end != true else { return "Only active, continuing subscriptions" }
        guard !subscription.items.has_more, subscription.items.data.count == 1, let item = subscription.items.data.first,
              let amount = item.price.unit_amount, amount > 0, let quantity = item.quantity, (1...100_000).contains(quantity) else { return "Only one fixed-price item" }
        guard let recurring = item.price.recurring, recurring.interval_count == 1,
              recurring.usage_type == "licensed", item.price.billing_scheme == "per_unit",
              recurring.interval == "month" || recurring.interval == "year" else { return "Only fixed monthly or yearly billing" }
        guard subscription.discounts?.isEmpty == true, item.discounts?.isEmpty == true else { return "Discounts need manual review" }
        guard (item.current_period_end ?? subscription.current_period_end) != nil else { return "Next period date is unavailable" }
        guard subscription.automatic_tax?.enabled == false, subscription.default_tax_rates?.isEmpty == true,
              item.tax_rates?.isEmpty == true else { return "Tax configuration needs manual review" }
        guard subscription.currency?.uppercased() == company.currencyCode.uppercased(),
              item.price.currency.uppercased() == company.currencyCode.uppercased(),
              ["NOK", "EUR", "USD", "GBP"].contains(company.currencyCode.uppercased()) else { return "Currency must match the ReAI company" }
        guard matchedCustomer(subscription.customer?.email) != nil else { return "Match exactly one ReAI customer by email" }
        guard zeroVATProducts.contains(where: { $0.id == selectedProduct }) else { return "Choose a zero-rate ReAI product" }
        return nil
    }

    func importInvoice(_ invoice: StripeInvoice) {
        guard let token = reaiToken, let source = stripeAccount, let customer = matchedCustomer(invoice.customer_email),
              let company, let paidAt = invoice.paidAt, let number = invoice.number,
              invoiceReason(invoice) == nil else { error = "Refresh the preview and check this invoice before importing."; return }
        busy = true; error = nil; notice = nil
        Task {
            defer { busy = false }
            do {
                let amount = Double(invoice.total) / 100
                let body: [String: Any] = [
                    "source": "stripe", "sourceInstance": source, "externalId": invoice.id,
                    "number": number, "issueDate": Dates.day(invoice.issuedAt),
                    "dueDate": Dates.day(invoice.due_date ?? paidAt), "accounting": "none",
                    "automaticRemindersEnabled": false, "customerId": customer.id,
                    "comment": "Historical Stripe invoice \(invoice.id). Revenue and VAT were not posted by this import.",
                    "orderItems": [["productId": selectedProduct, "quantity": 1, "price": amount, "currency": company.currencyCode]],
                    "payments": [["reference": "stripe:\(source):\(invoice.id):paid", "date": Dates.day(paidAt),
                                  "paidAmount": amount, "receivedAmount": amount]]
                ]
                let data = try JSONSerialization.data(withJSONObject: body)
                let imported: ImportedInvoice = try await reai.request("api/invoices/import", token: token, company: company.id, body: data)
                notice = "Imported \(number) as ReAI invoice #\(imported.id). Historical accounting remains in Stripe."
            } catch { self.error = error.localizedDescription }
        }
    }

    func stageSubscription(_ subscription: StripeSubscription) {
        guard let token = reaiToken, let source = stripeAccount, let company,
              let item = subscription.items.data.first, let amount = item.price.unit_amount,
              let quantity = item.quantity, let recurring = item.price.recurring,
              let end = item.current_period_end ?? subscription.current_period_end,
              let customer = matchedCustomer(subscription.customer?.email),
              let vat = zeroVATProducts.first(where: { $0.id == selectedProduct })?.vatCode,
              subscriptionReason(subscription) == nil else { error = "Refresh the preview and check this subscription before staging."; return }
        busy = true; error = nil; notice = nil
        Task {
            defer { busy = false }
            do {
                let marker = "Stripe subscription \(source)/\(subscription.id)"
                let existing: [SubscriptionSummary] = try await reai.request("api/subscriptions", token: token, company: company.id,
                    query: [URLQueryItem(name: "customerId", value: String(customer.id))])
                for row in existing {
                    guard let id = row.id else { continue }
                    let detail: SubscriptionDetail = try await reai.request("api/subscriptions/\(id)", token: token, company: company.id)
                    if detail.internalComment?.contains(marker) == true { throw appError("This Stripe subscription is already staged in ReAI (#\(id)).") }
                }
                let body: [String: Any] = [
                    "customerId": customer.id, "startDate": Dates.day(end),
                    "intervalMonths": recurring.interval == "year" ? 12 : 1,
                    "billingTiming": "in_advance", "periodAlignment": "start_date",
                    "outputMode": "create_order", "automaticBillingGeneration": false,
                    "currencyCode": company.currencyCode, "billingLeadDays": 0, "daysUntilDue": 0,
                    "sendEhf": false,
                    "internalComment": "\(marker). Staged from Stripe; verify terms, VAT, customer and payment collection before activating ReAI billing. Stripe remains active.",
                    "subscriptionLines": [["rowNumber": 1, "itemName": item.price.nickname ?? "Stripe subscription",
                                           "quantity": quantity, "unitPrice": Double(amount) / 100, "vatCode": vat]]
                ]
                let data = try JSONSerialization.data(withJSONObject: body)
                let created: CreatedSubscription = try await reai.request("api/subscriptions", token: token, company: company.id, body: data)
                notice = "Staged subscription #\(created.id.map(String.init) ?? "created") with automatic billing off. Stripe is still active."
            } catch { self.error = error.localizedDescription }
        }
    }

    func disconnectStripe() {
        Task {
            do { try await stripeStore.delete(); stripeKey = nil; stripeAccount = nil; invoices = []; subscriptions = []; notice = "Stripe key removed from this Mac." }
            catch { self.error = error.localizedDescription }
        }
    }
}
