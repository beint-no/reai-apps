import Foundation

private struct InvoiceCustomer: Decodable, Equatable, Sendable {
    let id: Int
    let name: String?
    let number: String?
    let organizationNumber: String?
    let archived: Bool
    let type: String

    var label: String { [name, number, organizationNumber].compactMap(normalizedIdentity).joined(separator: " · ") }
}

private struct InvoiceSalesAccount: Decodable, Sendable {
    let number: String
}

private struct InvoiceLine: Equatable, Sendable {
    let itemName: String
    let quantity: Decimal
    let unitPrice: Decimal
    let netAmount: Decimal
    let taxAmount: Decimal
    let accountNumber: String
    let vatCode: String
    let usesProductCodes: Bool

    var orderFields: [String: Any] {
        ["itemName": itemName, "quantity": decimalJSON(quantity), "unitPrice": decimalJSON(unitPrice), "vatCode": vatCode]
    }

    func snapshot(orderID: Int) -> [String: Any] {
        orderFields.merging([
            "orderId": orderID, "netAmount": decimalJSON(netAmount), "taxAmount": decimalJSON(taxAmount),
            "accountNumber": accountNumber
        ]) { _, value in value }
    }

    var preview: String {
        let source = usesProductCodes ? " · Accounting codes include RecMan product data" : ""
        return "\(itemName) · \(quantity) × NOK \(unitPrice) · net \(netAmount) · VAT \(vatCode) (\(taxAmount)) · account \(accountNumber)\(source)"
    }
}

private struct InvoiceSourceOrder: Decodable, Sendable {
    struct Line: Decodable, Equatable, Sendable {
        let itemName: String
        let quantity: Decimal
        let unitPrice: Decimal
        let vatCode: String
    }

    let id: Int
    let customerId: Int
    let issueDate: String
    let currencyCode: String
    let externalReference: String?
    let invoiceId: Int?
    let sendEhf: Bool
    let lifecycle: String
    let lines: [Line]
}

private struct InvoiceVAT: Decodable, Equatable, Sendable {
    let code: String
    let rate: Decimal
}

private struct InvoiceVATProblem: LocalizedError {
    let message: String
    var showSettings = false
    var errorDescription: String? { message }
}

private struct InvoiceVATReview {
    let sales: [String: InvoiceVAT]
    let catalog: [String: InvoiceVAT]?

    private static let settings = [
        "5": "No output VAT (inside the VAT Act) - (0%)",
        "6": "No output VAT (outside the VAT Act) - (0%)",
        "31": "Output VAT, medium rate - (15.0%)",
        "33": "Output VAT, low rate - (12.0%)"
    ]

    func validate(line: RecManInvoice.Line, productCode: String?, description: String) throws -> String {
        let lineCode = normalizedIdentity(line.vatCode?.value)
        let prefix = "VAT on “\(description)” ·"
        guard let code = lineCode ?? normalizedIdentity(productCode) else {
            throw InvoiceVATProblem(message: "\(prefix) RecMan code missing, rate \(line.vatPercent)%. Check the invoice line and product in RecMan.")
        }
        let source = lineCode == nil ? "RecMan line code missing, product code \(code)" : "RecMan code \(code)"
        let detail = "\(prefix) \(source), rate \(line.vatPercent)%."

        if let known = sales[code] ?? catalog?[code], known.rate != line.vatPercent {
            throw InvoiceVATProblem(message: "\(detail) ReAI defines code \(code) at \(known.rate)%. Verify the code and rate on the original invoice.")
        }
        if sales[code] != nil { return code }
        if let catalog, catalog[code] == nil {
            throw InvoiceVATProblem(message: "\(detail) ReAI does not recognize code \(code). Verify its ReAI equivalent before importing.")
        }
        if let setting = Self.settings[code], sales["3"] != nil {
            throw InvoiceVATProblem(
                message: "\(detail) This sales VAT code is disabled for the connected company. If this is the correct VAT treatment, enable “\(setting)” in ReAI, then click Load Records again.",
                showSettings: true
            )
        }
        let allowed = sales.keys.sorted().joined(separator: ", ")
        let available = allowed.isEmpty ? "" : " Available sales codes are \(allowed)."
        throw InvoiceVATProblem(message: "\(detail) ReAI does not allow this code on sales invoices for the connected company.\(available) Verify the VAT treatment before importing.")
    }
}

struct InvoiceResult: Decodable, Sendable {
    let id: Int
    let number: String
    let paymentReference: String?
    let creditNote: Bool
    let issueDate: String
    let dueDate: String?
    let totalAmount: Decimal
    let totalExclVatAmount: Decimal
    let totalVatAmount: Decimal
    let outstanding: Decimal
    let currencyCode: String
    let originalAttachmentId: Int?
    let voucherId: Int?
    let automaticRemindersEnabled: Bool
    let importSource: String?
    let importSourceInstance: String?
    let externalId: String?
    let orders: [SourceOrder]

    struct SourceOrder: Decodable, Sendable { let id: Int }
}

struct InvoiceBatch {
    let rows: [AccountingRow]
    let mappings: [AccountingMapping]
    let bankMatches: [String: InvoiceBankMatch]
    let bookingOpen: Set<String>
    fileprivate let documents: [RecManInvoice]
    fileprivate let pending: [RecManInvoice]
    fileprivate let companies: [RecManCompany]
    fileprivate let customers: [InvoiceCustomer]
    fileprivate let lines: [String: [InvoiceLine]]
    fileprivate let start: String
}

@MainActor
struct InvoiceImport {
    let source: RecManAPI
    let key: String
    let target: AccountingTarget

    func load(from start: String) async throws -> InvoiceBatch {
        guard accountingDate(start), target.tenant.currencyCode == "NOK" else {
            throw appError("Choose a valid start date and an NOK ReAI company.")
        }
        let journal = try target.journal()
        var documents: [RecManInvoice] = []
        for kind in InvoiceKind.allCases {
            let minID = journal.result(for: checkpoint(kind, start: start))
            let argument = kind == .invoice ? "minInvoiceId" : "minCreditNoteId"
            let parameters = minID.map { [argument: String($0)] } ?? [:]
            let loaded: [RecManInvoice] = try await source.fetchAll(kind.scope, key: key, parameters: parameters)
            guard loaded.allSatisfy({ $0.kind == kind && $0.id > 0 && accountingDate($0.date) }),
                  Set(loaded.map(\.id)).count == loaded.count else {
                throw appError("RecMan returned inconsistent \(kind.title.lowercased()) IDs or dates.")
            }
            documents += loaded.filter { $0.id > (minID ?? 0) }
        }
        let pending = documents.filter { $0.date >= start && !finished($0, journal: journal) }
        let newDocuments = pending.filter { journal.result(for: $0.key) == nil }
        let bankReview: InvoicePaymentReview
        do {
            bankReview = try await InvoicePayments(target: target).review(pending, journal: journal)
        } catch {
            try Task.checkCancellation()
            let issue = "Paid in RecMan. Could not verify a bank match in ReAI. \(error.localizedDescription)"
            bankReview = InvoicePaymentReview(issues: Dictionary(uniqueKeysWithValues: pending.filter(\.needsBankMatch).map { ($0.key, issue) }))
        }
        let companies: [RecManCompany]
        let sourceProducts: [RecManProduct]
        if pending.isEmpty {
            companies = []
            sourceProducts = []
        } else {
            companies = try await source.companies(key: key)
            sourceProducts = newDocuments.isEmpty ? [] : try await source.products(key: key)
        }
        let customers = newDocuments.isEmpty ? [] : try await loadCustomers()
        let taxes = try await invoiceVATReview(needed: !newDocuments.isEmpty)
        let accounts: Set<String> = newDocuments.isEmpty ? [] : try await salesAccounts()
        let productsByID = Dictionary(grouping: sourceProducts, by: \.productId)

        var mappings: [String: AccountingMapping] = [:]
        var prepared: [String: [InvoiceLine]] = [:]
        var bookingOpen: Set<String> = []
        var rows: [AccountingRow] = []
        for document in pending.sorted(by: { ($0.date, $0.key) < ($1.date, $1.key) }) {
            let company = companies.first { Int($0.companyId) == document.companyId }
            let customerID = customerKey(document.companyId)
            let alreadyBooked = journal.result(for: document.key) != nil
            let bankMatch = bankReview.matches[document.key]
            let bankIssue = bankReview.issues[document.key] ?? "Paid in RecMan. No verified bank match."
            let bookOpen = document.needsBankMatch && bankMatch == nil && !alreadyBooked
            var problem: String?
            var vatSettingsURL: URL?
            let multiplier = documentMultiplier(document)
            do {
                try validateDocument(document)
                if document.needsBankMatch, bankMatch == nil, alreadyBooked {
                    throw appError(bankIssue)
                }
                if !alreadyBooked {
                    guard let company else { throw appError("The RecMan customer is missing.") }
                    let lines = try document.lines.map { line in
                        try prepareLine(line, products: productsByID, taxes: taxes, accounts: accounts,
                                        multiplier: multiplier)
                    }
                    guard lines.contains(where: { $0.quantity != 0 || $0.unitPrice != 0 }) else {
                        throw appError("The document needs at least one priced or quantified order line.")
                    }
                    prepared[document.key] = lines
                    if mappings[customerID] == nil {
                        mappings[customerID] = customerMapping(company, customers: customers)
                    }
                }
                if bookOpen { bookingOpen.insert(document.key) }
            } catch let error as InvoiceVATProblem {
                problem = error.message
                if error.showSettings {
                    vatSettingsURL = target.api.server.url.appending(path: "company/settings").appending(queryItems: [
                        URLQueryItem(name: "tenantId", value: String(target.tenant.id))
                    ])
                }
            } catch {
                problem = error.localizedDescription
            }
            let vatTotal = document.lines.reduce(Decimal(0)) { $0 + $1.sumVat } * multiplier
            let kid = normalizedIdentity(document.identificationCode).map { " · KID \($0)" } ?? ""
            let payment = bankMatch.map { "\n\($0.detail)" } ??
                (bookOpen && problem == nil ? "\n\(bankIssue) Will be booked as open with reminders off." : "")
            let booked = alreadyBooked ? " · Already booked in ReAI" : ""
            rows.append(AccountingRow(id: document.key, title: "\(document.kind.title) \(document.number)",
                                      detail: "\(company?.name ?? "Unknown customer") · \(document.date) · NOK \(document.total * multiplier) · VAT \(vatTotal)\(kid)\(booked)\(payment)",
                                      requirements: alreadyBooked ? [] : [customerID], problem: problem,
                                      lineDetails: prepared[document.key]?.map(\.preview) ?? document.lines.map {
                                          "\($0.description) · \($0.qty) × NOK \($0.price) · total \($0.sumInclVat * multiplier)"
                                      }, vatSettingsURL: vatSettingsURL))
        }
        let requiredMappings = Set(rows.filter { $0.problem == nil }.flatMap(\.requirements))
        let reviewMappings = mappings.values.filter { requiredMappings.contains($0.id) }.sorted { $0.label < $1.label }
        return InvoiceBatch(rows: rows, mappings: reviewMappings, bankMatches: bankReview.matches, bookingOpen: bookingOpen,
                            documents: documents, pending: pending, companies: companies, customers: customers,
                            lines: prepared, start: start)
    }

    func perform(_ batch: InvoiceBatch, selection: Set<String>, choices: [String: String]) async throws -> String {
        let journal = try target.journal()
        let chosen = batch.rows.filter { selection.contains($0.id) }
        guard !chosen.isEmpty, chosen.count == selection.count else { throw appError("Select invoices to import.") }
        try validateChoices(chosen, mappings: batch.mappings, choices: choices)
        let documents = batch.pending.filter { selection.contains($0.key) }
        let payments = InvoicePayments(target: target)
        let matchingDocuments = documents.filter { batch.bankMatches[$0.key] != nil }
        if !matchingDocuments.isEmpty {
            let fresh = try await payments.review(batch.pending, journal: journal)
            for document in matchingDocuments {
                guard fresh.matches[document.key] == batch.bankMatches[document.key] else {
                    throw appError("The bank match for invoice \(document.number) changed. Reload the preview.")
                }
            }
        }

        let newDocuments = documents.filter { journal.result(for: $0.key) == nil }
        let customers = newDocuments.isEmpty ? [] : try await loadCustomers()
        let taxes = newDocuments.isEmpty ? [:] : try await invoiceVAT()
        let accounts: Set<String> = newDocuments.isEmpty ? [] : try await salesAccounts()
        guard Set(customers.map(\.id)).count == customers.count else {
            throw appError("The ReAI customer list changed. Reload the preview.")
        }

        var pdfs: [String: String] = [:]
        for document in newDocuments {
            guard let company = batch.companies.first(where: { Int($0.companyId) == document.companyId }) else {
                throw appError("The RecMan customer is missing.")
            }
            let proposed = customerMapping(company, customers: customers).options.map(\.id)
            guard let choice = choices[customerKey(document.companyId)], proposed.contains(choice) else {
                throw appError("The customer mapping changed in ReAI. Reload the preview.")
            }
            if let id = Int(choice), customers.first(where: { $0.id == id }) != batch.customers.first(where: { $0.id == id }) {
                throw appError("A selected ReAI customer changed. Reload the preview.")
            }
            guard let lines = batch.lines[document.key],
                  zip(lines, document.lines).allSatisfy({ line, source in
                      accounts.contains(line.accountNumber) && taxes[line.vatCode]?.rate == source.vatPercent
                  }) else { throw appError("The ReAI VAT or revenue account settings changed. Reload the preview.") }
            pdfs[document.key] = try await source.originalPDF(document: document, key: key)
        }

        var customerIDs: [Int: Int] = [:]
        var bookedCount = 0
        var bookedOpenCount = 0
        var reconciledCount = 0
        var completed: [Int] = []
        var rejections: [String] = []
        for document in documents.sorted(by: { ($0.date, $0.key) < ($1.date, $1.key) }) {
            do {
                guard !finished(document, journal: journal) else {
                    throw appError("The document was already imported. Reload the preview.")
                }
                let invoiceID: Int
                let bookOpen = batch.bookingOpen.contains(document.key)
                if let bookedID = journal.result(for: document.key) {
                    guard !bookOpen else {
                        throw appError("The invoice was already booked. Reload the preview.")
                    }
                    invoiceID = bookedID
                } else {
                    guard let choice = choices[customerKey(document.companyId)],
                          let company = batch.companies.first(where: { Int($0.companyId) == document.companyId }),
                          let pdf = pdfs[document.key], let lines = batch.lines[document.key] else {
                        throw appError("The invoice review is incomplete.")
                    }
                    let customerID: Int
                    if let id = Int(choice) ?? customerIDs[document.companyId] {
                        customerID = id
                    } else {
                        customerID = try await createCustomer(company, journal: journal)
                        customerIDs[document.companyId] = customerID
                    }
                    let order = try await sourceOrder(for: document, customerID: customerID, lines: lines, journal: journal)
                    invoiceID = try await book(document, customerID: customerID, orderID: order, lines: lines,
                                               pdf: pdf, bookOpen: bookOpen, journal: journal)
                    bookedCount += 1
                    if bookOpen { bookedOpenCount += 1 }
                }
                if let match = batch.bankMatches[document.key] {
                    try await payments.reconcile(match, document: document, invoiceID: invoiceID, journal: journal)
                    reconciledCount += 1
                }
                completed.append(document.number)
            } catch {
                let partial = document.needsBankMatch && journal.result(for: document.key) != nil
                    ? " The invoice is booked in ReAI. Check its payment and bank reconciliation." : ""
                let failure = "Could not finish document \(document.number). \(error.localizedDescription)\(partial)"
                if error is ReAIWriteRejected {
                    rejections.append(failure)
                    continue
                }
                let imported = completed.isEmpty ? [] : ["Completed before the error: \(completed.map(String.init).joined(separator: ", "))."]
                throw appError((rejections + [failure] + imported).joined(separator: "\n\n"))
            }
        }
        for kind in InvoiceKind.allCases {
            let contiguous = batch.documents.filter { $0.kind == kind }.sorted { $0.id < $1.id }.prefix {
                $0.date < batch.start || finished($0, journal: journal)
            }
            if let last = contiguous.last { try journal.advanceCheckpoint(checkpoint(kind, start: batch.start), through: last.id) }
        }
        let openInvoices = bookedOpenCount == 0 ? "" : "\nBooked \(bookedOpenCount) paid RecMan invoices as open with reminders off."
        let reconciliation = reconciledCount == 0 ? "" : "\nReconciled \(reconciledCount) invoice payments."
        let summary = "Booked \(bookedCount) invoice or credit note records.\(openInvoices)\(reconciliation)"
        guard rejections.isEmpty else {
            throw appError(([summary] + rejections).joined(separator: "\n\n"))
        }
        return summary
    }

    private func finished(_ document: RecManInvoice, journal: Journal) -> Bool {
        journal.result(for: document.openInvoiceReceipt) != nil ||
            (journal.result(for: document.key) != nil &&
             (!document.needsBankMatch || journal.result(for: document.bankMatchReceipt) != nil))
    }

    private func loadCustomers() async throws -> [InvoiceCustomer] {
        let active: [InvoiceCustomer] = try await target.list("/api/customers")
        let archived: [InvoiceCustomer] = try await target.list("/api/customers", archived: true)
        return active + archived
    }

    private func checkpoint(_ kind: InvoiceKind, start: String) -> String {
        "checkpoint-\(RecManState.fingerprint(key))-\(kind.scope)-\(start)"
    }
    private func customerKey(_ id: Int) -> String { "customer-\(id)" }

    private func customerMapping(_ source: RecManCompany, customers: [InvoiceCustomer]) -> AccountingMapping {
        let organization = source.organizationNumber
        let number = normalizedIdentity(source.number).flatMap { $0 == "0" ? nil : $0 }
        let orgMatches = customers.filter { organization != nil && $0.organizationNumber == organization }
        let numberMatches = customers.filter { number != nil && $0.number == number }
        let nameMatches = customers.filter { $0.name?.caseInsensitiveCompare(source.name) == .orderedSame }
        let matches = [orgMatches, numberMatches, nameMatches].first { !$0.isEmpty } ?? []
        let compatible = customers.filter {
            !$0.archived && $0.type == "company" &&
                (organization == nil || normalizedIdentity($0.organizationNumber) == nil || $0.organizationNumber == organization)
        }
        var options = compatible.sorted { $0.label < $1.label }.map {
            AccountingOption(id: String($0.id), label: $0.label)
        }
        if matches.isEmpty, !source.name.isEmpty, organization != nil {
            options.insert(AccountingOption(id: "create", label: "Create customer from RecMan"), at: 0)
        }
        let matchedID = matches.count == 1 && compatible.contains(where: { $0.id == matches[0].id })
            ? String(matches[0].id) : nil
        let suggestion = matchedID ?? (options.first?.id == "create" ? "create" : nil)
        return AccountingMapping(id: customerKey(Int(source.companyId) ?? 0), label: "Customer · \(source.name)",
                                 options: options, suggestion: suggestion)
    }

    private func invoiceVAT(usage: String? = "customer_invoice") async throws -> [String: InvoiceVAT] {
        let query = usage.map { [URLQueryItem(name: "usage", value: $0)] } ?? []
        let codes: [InvoiceVAT] = try await target.read("/api/vat-codes", query: query)
        guard Set(codes.map(\.code)).count == codes.count else { throw appError("ReAI returned repeated VAT codes.") }
        return Dictionary(uniqueKeysWithValues: codes.map { ($0.code, $0) })
    }

    private func invoiceVATReview(needed: Bool) async throws -> InvoiceVATReview {
        guard needed else { return InvoiceVATReview(sales: [:], catalog: nil) }
        let sales = try await invoiceVAT()
        let catalog = try? await invoiceVAT(usage: nil)
        try Task.checkCancellation()
        return InvoiceVATReview(sales: sales, catalog: catalog)
    }

    private func salesAccounts() async throws -> Set<String> {
        let accounts: [InvoiceSalesAccount] = try await target.read("/api/chart-of-accounts")
        return Set(accounts.map(\.number).filter { $0.hasPrefix("3") })
    }

    private func validateDocument(_ document: RecManInvoice) throws {
        guard document.departmentId > 0, document.number > 0, (1...1000).contains(document.lines.count),
              document.total != 0, document.date <= osloDate(.now) else {
            throw appError("The source document has an unsupported number, date, department, or total.")
        }
        if document.kind == .invoice {
            guard document.total > 0, let due = normalizedIdentity(document.dueDate),
                  accountingDate(due), due >= document.date else {
                throw appError("The invoice needs a valid due date and a positive total.")
            }
        }
    }

    private func documentMultiplier(_ document: RecManInvoice) -> Decimal {
        document.kind == .creditNote && document.total > 0 ? -1 : 1
    }

    private func prepareLine(_ line: RecManInvoice.Line, products: [Int: [RecManProduct]],
                             taxes: InvoiceVATReview, accounts: Set<String>, multiplier: Decimal) throws -> InvoiceLine {
        let matches = products[line.productId] ?? []
        let product = matches.count == 1 ? matches.first : nil
        guard let description = normalizedIdentity(line.description), description.utf16.count <= 255 else {
            throw appError("A RecMan line description is blank or exceeds ReAI’s 255-character limit.")
        }
        let lineAccount = normalizedIdentity(line.creditAccount?.value)
        let lineVAT = normalizedIdentity(line.vatCode?.value)
        guard let account = lineAccount ?? normalizedIdentity(product?.creditAccount),
              account.range(of: #"^3[0-9]{3}$"#, options: .regularExpression) != nil,
              accounts.contains(account) else {
            throw appError("The RecMan revenue account for \(description) is missing or unavailable in ReAI.")
        }
        let code = try taxes.validate(line: line, productCode: product?.vatCode, description: description)
        guard abs(line.qty) <= Decimal(string: "99999999.99")!, abs(line.price) <= 10_000_000,
              [line.qty, line.price, line.sumExclVat, line.sumVat].allSatisfy({ roundedMoney($0) == $0 }),
              [line.sumExclVat, line.sumVat].allSatisfy({ abs($0) < 1_000_000_000_000 }),
              line.sumExclVat + line.sumVat == line.sumInclVat,
              line.sumVat == 0 || (line.vatPercent > 0 && (line.sumVat < 0) == (line.sumExclVat < 0) && line.sumExclVat != 0) else {
            throw appError("The original amounts for \(description) exceed ReAI’s limits or are inconsistent.")
        }
        return InvoiceLine(itemName: description, quantity: line.qty, unitPrice: line.price * multiplier,
                           netAmount: line.sumExclVat * multiplier, taxAmount: line.sumVat * multiplier,
                           accountNumber: account, vatCode: code, usesProductCodes: lineAccount == nil || lineVAT == nil)
    }

    private func sourceOrder(for document: RecManInvoice, customerID: Int, lines: [InvoiceLine],
                             journal: Journal) async throws -> Int {
        let endpoint = "/api/orders"
        let orderKey = "invoice-order-\(document.key)"
        let reference = "recman-\(document.key)"
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        let daysUntilDue: Int
        if document.kind == .invoice, let due = document.dueDate.flatMap(normalizedIdentity).flatMap(formatter.date(from:)),
           let issued = formatter.date(from: document.date) {
            daysUntilDue = Int(due.timeIntervalSince(issued) / 86_400)
        } else {
            daysUntilDue = 0
        }
        let fields: [String: Any] = [
            "externalReference": reference, "customerId": customerID, "currencyCode": "NOK",
            "orderDate": document.date, "issueDate": document.date, "daysUntilDue": daysUntilDue,
            "sendEhf": false, "orderLines": lines.map(\.orderFields)
        ]
        let body = try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys])
        let savedID = try journal.verifiedResult(for: orderKey, endpoint: endpoint, body: body)
        let order: InvoiceSourceOrder
        if let savedID {
            order = try await target.read("\(endpoint)/\(savedID)")
        } else {
            order = try await target.write(endpoint, fields: fields, key: orderKey, journal: journal)
        }
        let expected = lines.map {
            InvoiceSourceOrder.Line(itemName: $0.itemName, quantity: $0.quantity, unitPrice: $0.unitPrice, vatCode: $0.vatCode)
        }
        guard order.id > 0, savedID == nil || order.id == savedID, order.customerId == customerID,
              order.currencyCode == "NOK", order.issueDate == document.date, order.externalReference == reference,
              order.invoiceId == nil, order.lifecycle != "cancelled", !order.sendEhf, order.lines == expected else {
            throw appError("ReAI returned an order that differs from the preview.")
        }
        if savedID == nil { try journal.complete(orderKey, id: order.id) }
        return order.id
    }

    private func createCustomer(_ company: RecManCompany, journal: Journal) async throws -> Int {
        guard let org = company.organizationNumber else { throw appError("A verified organization number is required.") }
        var fields: [String: Any] = ["name": company.name, "organizationNumber": org,
                                     "countryCode": "NO", "skipRegistryLookup": true]
        if let number = normalizedIdentity(company.number), number != "0" { fields["number"] = number }
        let key = "invoice-customer-\(company.companyId)"
        let customer: InvoiceCustomer = try await target.write("/api/customers", fields: fields, key: key, journal: journal)
        guard customer.organizationNumber == org else { throw appError("Could not verify the created customer.") }
        try journal.complete(key, id: customer.id)
        return customer.id
    }

    private func book(_ document: RecManInvoice, customerID: Int, orderID: Int, lines: [InvoiceLine],
                      pdf: String, bookOpen: Bool, journal: Journal) async throws -> Int {
        let multiplier = documentMultiplier(document)
        let instance = "department-\(document.departmentId)"
        let number = String(document.number)
        var fields: [String: Any] = [
            "source": "recman", "sourceInstance": instance, "externalId": document.key, "number": number,
            "customerId": customerID, "issueDate": document.date, "accounting": "book",
            "automaticRemindersEnabled": false, "orderId": orderID,
            "snapshotLines": lines.map { $0.snapshot(orderID: orderID) },
            "originalPdf": ["filename": "\(document.kind.scope)-\(number).pdf", "contentBase64": pdf]
        ]
        if document.kind == .invoice, let due = normalizedIdentity(document.dueDate) { fields["dueDate"] = due }
        if let kid = normalizedIdentity(document.identificationCode) { fields["paymentReference"] = kid }
        let receipt = bookOpen ? document.openInvoiceReceipt : document.key
        let record: InvoiceResult = try await target.write("/api/invoices/import", fields: fields, key: receipt, journal: journal)
        guard record.id > 0, record.number == number, record.issueDate == document.date, record.creditNote == (document.kind == .creditNote),
              record.totalAmount == document.total * multiplier,
              !bookOpen || record.outstanding == document.total,
              record.totalExclVatAmount == document.lines.reduce(0, { $0 + $1.sumExclVat }) * multiplier,
              record.totalVatAmount == document.lines.reduce(0, { $0 + $1.sumVat }) * multiplier,
              record.paymentReference == fields["paymentReference"] as? String,
              record.dueDate == fields["dueDate"] as? String,
              record.currencyCode == "NOK", record.originalAttachmentId != nil, record.voucherId != nil,
              !record.automaticRemindersEnabled, record.orders.map(\.id) == [orderID], record.importSource == "recman",
              record.importSourceInstance == instance, record.externalId == document.key else {
            throw appError("ReAI returned a document that differs from the reviewed import.")
        }
        try journal.complete(receipt, id: record.id)
        return record.id
    }
}

func validateChoices(_ rows: [AccountingRow], mappings: [AccountingMapping], choices: [String: String]) throws {
    let valid = Dictionary(uniqueKeysWithValues: mappings.map { ($0.id, $0) })
    guard rows.allSatisfy({ row in
        row.problem == nil && row.requirements.allSatisfy { required in
            valid[required]?.accepts(choices[required]) == true
        }
    }) else { throw appError("Review the required mappings before importing.") }
}
