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

private struct InvoiceProduct: Decodable, Equatable, Sendable {
    let id: Int
    let title: String
    let stockItem: Bool
    let archived: Bool
    let revenueAccountCode: String?
    let vatCode: String?
}

private struct InvoiceVAT: Decodable, Equatable, Sendable {
    let code: String
    let rate: Decimal
    let description: String
}

private struct InvoiceResult: Decodable, Sendable {
    let id: Int
    let number: String
    let paymentReference: String?
    let creditNote: Bool
    let issueDate: String
    let dueDate: String?
    let totalAmount: Decimal
    let totalExclVatAmount: Decimal
    let totalVatAmount: Decimal
    let currencyCode: String
    let originalAttachmentId: Int?
    let voucherId: Int?
    let automaticRemindersEnabled: Bool
    let importSource: String?
    let importSourceInstance: String?
    let externalId: String?
}

struct InvoiceBatch {
    let rows: [AccountingRow]
    let mappings: [AccountingMapping]
    fileprivate let documents: [RecManInvoice]
    fileprivate let companies: [RecManCompany]
    fileprivate let customers: [InvoiceCustomer]
    fileprivate let products: [InvoiceProduct]
    fileprivate let vat: [InvoiceVAT]
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
        let pending = documents.filter { $0.date >= start && journal.result(for: $0.key) == nil }
        let companies: [RecManCompany]
        let sourceProducts: [RecManProduct]
        if pending.isEmpty {
            companies = []
            sourceProducts = []
        } else {
            companies = try await source.companies(key: key)
            sourceProducts = try await source.products(key: key)
        }
        let customers = pending.isEmpty ? [] : try await loadCustomers()
        let products: [InvoiceProduct] = pending.isEmpty ? [] : try await target.list("/api/products")
        let vat: [InvoiceVAT] = pending.isEmpty ? [] : try await target.read("/api/vat-codes", query: [
            URLQueryItem(name: "usage", value: "customer_invoice")
        ])

        var mappings: [String: AccountingMapping] = [:]
        var rows: [AccountingRow] = []
        for document in pending.sorted(by: { ($0.date, $0.key) < ($1.date, $1.key) }) {
            let company = companies.first { Int($0.companyId) == document.companyId }
            let customerID = customerKey(document.companyId)
            if mappings[customerID] == nil, let company {
                mappings[customerID] = customerMapping(company, customers: customers)
            }
            var requirements = Set([customerID])
            var problem = documentProblem(document)
            if company == nil { problem = "The RecMan customer is missing." }
            for line in document.lines {
                guard let product = sourceProducts.first(where: { $0.productId == line.productId }) else {
                    problem = "A line has no RecMan product."
                    continue
                }
                let mappingID = productKey(product.productId, rate: line.vatPercent)
                requirements.insert(mappingID)
                if mappings[mappingID] == nil {
                    mappings[mappingID] = productMapping(product, rate: line.vatPercent, products: products, vat: vat)
                }
            }
            let sign = document.kind == .creditNote && document.total > 0 ? -1 : 1
            let multiplier = Decimal(sign)
            let vatTotal = document.lines.reduce(Decimal(0)) { $0 + $1.sumVat } * multiplier
            let kid = normalizedIdentity(document.identificationCode).map { " · KID \($0)" } ?? ""
            rows.append(AccountingRow(id: document.key, title: "\(document.kind.title) \(document.number)",
                                      detail: "\(company?.name ?? "Unknown customer") · \(document.date) · NOK \(document.total * multiplier) · VAT \(vatTotal)\(kid)",
                                      requirements: requirements.sorted(), problem: problem,
                                      lineDetails: document.lines.map {
                                          "\($0.description) · \($0.qty) × NOK \($0.price) · total \($0.sumInclVat * multiplier)"
                                      }))
        }
        let requiredMappings = Set(rows.filter { $0.problem == nil }.flatMap(\.requirements))
        let reviewMappings = mappings.values.filter { requiredMappings.contains($0.id) }.sorted { $0.label < $1.label }
        return InvoiceBatch(rows: rows, mappings: reviewMappings,
                            documents: documents, companies: companies, customers: customers, products: products,
                            vat: vat, start: start)
    }

    func perform(_ batch: InvoiceBatch, selection: Set<String>, choices: [String: String]) async throws -> String {
        let journal = try target.journal()
        let chosen = batch.rows.filter { selection.contains($0.id) }
        guard !chosen.isEmpty, chosen.count == selection.count else { throw appError("Select invoices to import.") }
        try validateChoices(chosen, mappings: batch.mappings, choices: choices)
        let customers = try await loadCustomers()
        let products: [InvoiceProduct] = try await target.list("/api/products")
        let vat: [InvoiceVAT] = try await target.read("/api/vat-codes", query: [
            URLQueryItem(name: "usage", value: "customer_invoice")
        ])
        guard Set(customers.map(\.id)).count == customers.count,
              Set(products.map(\.id)).count == products.count,
              vat == batch.vat else { throw appError("The ReAI accounting configuration changed. Reload the preview.") }

        var pdfs: [String: String] = [:]
        let documents = batch.documents.filter { selection.contains($0.key) }
        for document in documents {
            guard journal.result(for: document.key) == nil else { throw appError("An invoice was already imported. Reload the preview.") }
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
            for line in document.lines {
                let selected = choices[productKey(line.productId, rate: line.vatPercent)].flatMap(Int.init)
                guard let selected, let product = products.first(where: { $0.id == selected }),
                      product == batch.products.first(where: { $0.id == selected }) else {
                    throw appError("A selected product changed in ReAI. Reload the preview.")
                }
            }
            pdfs[document.key] = try await source.originalPDF(document: document, key: key)
        }

        var customerIDs: [Int: Int] = [:]
        var completed: [Int] = []
        for document in documents.sorted(by: { ($0.date, $0.key) < ($1.date, $1.key) }) {
            do {
                guard let choice = choices[customerKey(document.companyId)],
                      let company = batch.companies.first(where: { Int($0.companyId) == document.companyId }),
                      let pdf = pdfs[document.key] else { throw appError("The invoice review is incomplete.") }
                let customerID: Int
                if let id = Int(choice) ?? customerIDs[document.companyId] {
                    customerID = id
                } else {
                    customerID = try await createCustomer(company, journal: journal)
                    customerIDs[document.companyId] = customerID
                }
                try await book(document, customerID: customerID, choices: choices, pdf: pdf, journal: journal)
                completed.append(document.number)
            } catch {
                let imported = completed.isEmpty ? "" : "\n\nBooked before the error: \(completed.map(String.init).joined(separator: ", "))."
                throw appError("Could not finish document \(document.number). \(error.localizedDescription)\(imported)")
            }
        }
        for kind in InvoiceKind.allCases {
            let contiguous = batch.documents.filter { $0.kind == kind }.sorted { $0.id < $1.id }.prefix {
                $0.date < batch.start || journal.result(for: $0.key) != nil
            }
            if let last = contiguous.last { try journal.advanceCheckpoint(checkpoint(kind, start: batch.start), through: last.id) }
        }
        return "Booked \(completed.count) invoice or credit note records."
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
    private func productKey(_ id: Int, rate: Decimal) -> String { "product-\(id)-\(rate)" }

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
        let suggestion = matches.count == 1 && compatible.contains(where: { $0.id == matches[0].id }) ? String(matches[0].id) : nil
        return AccountingMapping(id: customerKey(Int(source.companyId) ?? 0), label: "Customer · \(source.name)",
                                 options: options, suggestion: suggestion)
    }

    private func productMapping(_ source: RecManProduct, rate: Decimal, products: [InvoiceProduct],
                                vat: [InvoiceVAT]) -> AccountingMapping {
        let options = products.compactMap { product -> AccountingOption? in
            guard !product.archived, !product.stockItem, let account = product.revenueAccountCode, account.hasPrefix("3"),
                  let code = product.vatCode, let tax = vat.first(where: { $0.code == code && $0.rate == rate }) else { return nil }
            return AccountingOption(id: String(product.id), label: "\(product.title) · \(account) · VAT \(code) \(tax.description)")
        }.sorted { $0.label < $1.label }
        return AccountingMapping(id: productKey(source.productId, rate: rate),
                                 label: "\(source.name) · RecMan account \(source.creditAccount), VAT \(source.vatCode) (\(rate)%)",
                                 options: options, suggestion: nil,
                                 unavailableReason: options.isEmpty
                                     ? "Set up a non-stock ReAI product with an explicit revenue account and a VAT code for \(rate)%, then reload."
                                     : nil)
    }

    private func documentProblem(_ document: RecManInvoice) -> String? {
        if document.departmentId <= 0 || document.number <= 0 || document.lines.isEmpty || document.total == 0 ||
            (document.kind == .invoice && document.total < 0) {
            return "The source document has an unsupported number, department, or total."
        }
        if document.kind == .invoice, let due = normalizedIdentity(document.dueDate),
           !accountingDate(due) || due < document.date { return "The invoice due date is invalid." }
        if document.kind == .invoice, document.paid == 1 { return "Already paid in RecMan. Reconcile the payment before booking." }
        for line in document.lines {
            if line.qty == 0 || roundedMoney(line.qty * line.price) != line.sumExclVat ||
                roundedMoney(line.sumExclVat * line.vatPercent / 100) != line.sumVat ||
                line.sumExclVat + line.sumVat != line.sumInclVat {
                return "Line amounts cannot be reproduced by the ReAI import API."
            }
        }
        return nil
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

    private func book(_ document: RecManInvoice, customerID: Int, choices: [String: String], pdf: String,
                      journal: Journal) async throws {
        let multiplier: Decimal = document.kind == .creditNote && document.total > 0 ? -1 : 1
        let items = try document.lines.map { line -> [String: Any] in
            guard let id = choices[productKey(line.productId, rate: line.vatPercent)].flatMap(Int.init) else {
                throw appError("A product mapping is missing.")
            }
            let price = line.price * (line.qty < 0 ? -1 : 1) * multiplier
            return ["productId": id, "quantity": decimalJSON(abs(line.qty)), "price": decimalJSON(price), "currencyCode": "NOK"]
        }
        let instance = "department-\(document.departmentId)"
        let number = String(document.number)
        var fields: [String: Any] = [
            "source": "recman", "sourceInstance": instance, "externalId": document.key, "number": number,
            "customerId": customerID, "issueDate": document.date, "accounting": "book",
            "automaticRemindersEnabled": false, "orderItems": items,
            "originalPdf": ["filename": "\(document.kind.scope)-\(number).pdf", "contentBase64": pdf]
        ]
        if document.kind == .invoice, let due = normalizedIdentity(document.dueDate) { fields["dueDate"] = due }
        if let kid = normalizedIdentity(document.identificationCode) { fields["paymentReference"] = kid }
        let record: InvoiceResult = try await target.write("/api/invoices/import", fields: fields, key: document.key, journal: journal)
        guard record.number == number, record.issueDate == document.date, record.creditNote == (document.kind == .creditNote),
              record.totalAmount == document.total * multiplier,
              record.totalExclVatAmount == document.lines.reduce(0, { $0 + $1.sumExclVat }) * multiplier,
              record.totalVatAmount == document.lines.reduce(0, { $0 + $1.sumVat }) * multiplier,
              record.paymentReference == fields["paymentReference"] as? String,
              record.dueDate == fields["dueDate"] as? String,
              record.currencyCode == "NOK", record.originalAttachmentId != nil, record.voucherId != nil,
              !record.automaticRemindersEnabled, record.importSource == "recman",
              record.importSourceInstance == instance, record.externalId == document.key else {
            throw appError("ReAI returned a document that differs from the reviewed import.")
        }
        try journal.complete(document.key, id: record.id)
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
