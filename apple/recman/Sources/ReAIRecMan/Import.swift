import Foundation

private struct Customer: Decodable, Equatable {
    let id: Int
    let name: String?
    let number: String?
    let archived: Bool
}

private struct Product: Decodable, Equatable {
    struct Variant: Decodable, Equatable { let sku: String? }
    let id: Int
    let title: String
    let archived: Bool
    let stockItem: Bool
    let revenueAccountCode: String?
    let vatCode: String?
    let variants: [Variant]
}

private struct EmployeeSummary: Decodable {
    let id: Int
    let name: String
    let email: String
}

private struct Employee: Decodable, Equatable {
    struct Bank: Decodable, Equatable {
        let bankCode: String
        let accountNumber: String
        let countryCode: String
        var localNumber: String { bankCode + accountNumber }
    }

    struct Relation: Decodable, Equatable {
        struct Line: Decodable, Equatable {
            let startDate: String
            let municipality: String?
            let remunerationType: String?
        }
        let startDate: String
        let endDate: String?
        let employmentLines: [Line]
    }
    let id: Int
    let name: String
    let email: String?
    let bankAccount: Bank?
    let employmentRelations: [Relation]
}

private struct ImportedInvoice: Decodable {
    let id: Int
    let externalId: String?
    let importSource: String?
    let importSourceInstance: String?
    let number: String
    let paymentReference: String?
    let issueDate: String
    let creditNote: Bool
    let currencyCode: String
    let totalAmount: Decimal
    let totalExclVatAmount: Decimal
    let totalVatAmount: Decimal
    let originalAttachmentId: Int?
    let voucherId: Int?
    let automaticRemindersEnabled: Bool
}

private struct SalaryRun: Decodable {
    let id: Int
    let status: String
    let periodYear: Int
    let periodMonth: Int
    var period: String { String(format: "%04d-%02d", periodYear, periodMonth) }
}

private struct SalaryDetail: Decodable {
    struct Payee: Decodable {
        struct Spec: Decodable {
            let id: Int
            let specificationCode: String
            let quantity: Decimal
            let rate: Decimal
            let comment: String?
        }
        let employeeId: Int
        let wageSpecs: [Spec]
    }

    let id: Int
    let status: String
    let voucherId: Int?
    let imported: Bool
    let paymentDate: String?
    let employees: [Payee]
}

enum ImportScope: String, CaseIterable {
    case employees = "Employees"
    case fullSample = "Full Sample"
}

struct PreviewRow: Equatable, Identifiable {
    let id: String
    let group: String
    let title: String
    let detail: String
    let action: String
    var needsReview = false
    var candidateID: Int?
}

fileprivate struct FullSamplePreview: Equatable {
    let rows: [PreviewRow]
    let payrollPeriodOccupied: Bool
    let customer: Customer?
    let product: Product?
    let invoiceIDs: [String: Int]
    let salaryID: Int?
    let wageID: Int?
    let payrollCandidateID: Int?
}

struct ImportPreview: Equatable {
    let employeeRows: [PreviewRow]
    fileprivate let employees: [Int: Employee]
    fileprivate let fullSample: FullSamplePreview?

    var rows: [PreviewRow] { employeeRows + (fullSample?.rows ?? []) }
    var selectableEmployeeIDs: Set<Int> {
        Set(employeeRows.filter { !$0.needsReview }.compactMap(\.candidateID))
    }

    func includesDraftPayroll(selectedEmployeeIDs: Set<Int>) -> Bool {
        guard let fullSample, let candidateID = fullSample.payrollCandidateID else { return false }
        return !fullSample.payrollPeriodOccupied && fullSample.wageID == nil &&
            selectedEmployeeIDs.contains(candidateID)
    }
}

@MainActor
struct RecManImport {
    let api: ReAIAPI
    let token: String
    let tenant: Company
    let demo: Demo
    var journalDirectory: URL? = nil

    func preview(scope: ImportScope) async throws -> ImportPreview {
        try await prepare(scope: scope, journal: Journal(tenant: tenant, directory: journalDirectory))
    }

    func perform(_ reviewed: ImportPreview, selectedEmployeeIDs: Set<Int>) async throws {
        guard !selectedEmployeeIDs.isEmpty, selectedEmployeeIDs.isSubset(of: reviewed.selectableEmployeeIDs) else {
            throw appError("Select at least one employee who is ready to import.")
        }

        let journal = try Journal(tenant: tenant, directory: journalDirectory)
        let scope: ImportScope = reviewed.fullSample == nil ? .employees : .fullSample
        let current = try await prepare(scope: scope, journal: journal)
        guard current == reviewed else { throw appError("Local records changed. Load and review the sample again.") }

        var importedEmployeeIDs: [Int: Int] = [:]
        for candidate in demo.employees where selectedEmployeeIDs.contains(candidate.candidateId) {
            let employee = try await importEmployee(candidate, existing: current.employees[candidate.candidateId], journal: journal)
            importedEmployeeIDs[candidate.candidateId] = employee.id
        }

        guard let fullSample = current.fullSample else { return }
        let customer = try await importCustomer(existing: fullSample.customer, journal: journal)
        let product = try await importProduct(existing: fullSample.product, journal: journal)
        for document in demo.documents where fullSample.invoiceIDs[document.externalId] == nil {
            try await importDocument(document, customerID: customer.id, productID: product.id, journal: journal)
        }
        guard current.includesDraftPayroll(selectedEmployeeIDs: selectedEmployeeIDs),
              let wage = demo.wages.first, let employeeID = importedEmployeeIDs[wage.candidateId],
              let specification = wage.specification else { return }
        try await importPayroll(employeeID: employeeID, wage: wage, specification: specification,
                                current: fullSample, journal: journal)
    }

    private func prepare(scope: ImportScope, journal: Journal) async throws -> ImportPreview {
        guard tenant.currencyCode == "NOK" else { throw appError("Choose a disposable NOK company.") }
        let (employees, rows) = try await prepareEmployees(scope: scope, journal: journal)
        let fullSample = scope == .fullSample ? try await prepareFullSample(employees: employees, journal: journal) : nil
        return ImportPreview(employeeRows: rows, employees: employees, fullSample: fullSample)
    }

    private func prepareEmployees(scope: ImportScope, journal: Journal) async throws -> ([Int: Employee], [PreviewRow]) {
        let people: [EmployeeSummary] = try await read("/api/employees")
        var employees: [Int: Employee] = [:]
        var rows: [PreviewRow] = []
        for candidate in demo.employees {
            let matches = people.filter {
                $0.email.caseInsensitiveCompare(candidate.email) == .orderedSame ||
                $0.name.caseInsensitiveCompare(candidate.name) == .orderedSame
            }
            let key = employeeKey(candidate)
            let existing: Employee? = if matches.count == 1, let summary = matches.first {
                try await read("/api/employees/\(summary.id)")
            } else { nil }
            do {
                guard matches.count <= 1 else { throw appError("Multiple employees match this name or email.") }
                try checkReceipt(journal, key: key, existingID: existing?.id)
                var action = "Create employee and employment"
                if let existing {
                    try validateIdentity(existing, candidate: candidate)
                    if scope == .fullSample { try validateBank(existing, candidate: candidate) }
                    if existing.employmentRelations.isEmpty {
                        try checkReceipt(journal, key: "\(key)-employment", existingID: nil)
                        action = "Add employment"
                    } else {
                        try validateEmployment(existing, candidate: candidate)
                        try checkReceipt(journal, key: "\(key)-employment", existingID: existing.id)
                        action = "Match employee and employment"
                    }
                    employees[candidate.candidateId] = existing
                }
                rows.append(PreviewRow(id: key, group: "Employees", title: candidate.name,
                                       detail: "Employment starts \(demo.employmentStart)", action: action,
                                       candidateID: candidate.candidateId))
            } catch let error as AppError {
                rows.append(PreviewRow(id: key, group: "Employees", title: candidate.name,
                                       detail: error.message, action: "Review required", needsReview: true,
                                       candidateID: candidate.candidateId))
            }
        }
        return (employees, rows)
    }

    private func prepareFullSample(employees: [Int: Employee], journal: Journal) async throws -> FullSamplePreview {
        guard demo.issueDate >= demo.employmentStart else { throw appError("Choose a sample date in 2026 or later.") }

        let archivedFilter = [URLQueryItem(name: "archived", value: "true")]
        let activeCustomers: [Customer] = try await api.list("/api/customers", token: token, tenant: tenant.id)
        let archivedCustomers: [Customer] = try await api.list("/api/customers", token: token, tenant: tenant.id,
                                                              query: archivedFilter)
        let customers = activeCustomers + archivedCustomers
        let customerMatches = customers.filter { $0.number == demo.customerNumber || $0.name == demo.customerName }
        guard customerMatches.count <= 1 else { throw appError("Multiple customers match the synthetic name or customer number.") }
        let customer = customerMatches.first
        if let customer { try validateCustomer(customer) }
        try checkReceipt(journal, key: "customer", existingID: customer?.id)

        let activeProducts: [Product] = try await api.list("/api/products", token: token, tenant: tenant.id)
        let archivedProducts: [Product] = try await api.list("/api/products", token: token, tenant: tenant.id,
                                                            query: archivedFilter)
        let products = activeProducts + archivedProducts
        let productMatches = products.filter { $0.title == demo.productName || $0.variants.contains { $0.sku == demo.productSKU } }
        guard productMatches.count <= 1 else { throw appError("Multiple products match the synthetic name or SKU.") }
        let product = productMatches.first
        if let product { try validateProduct(product) }
        try checkReceipt(journal, key: "product", existingID: product?.id)

        var rows: [PreviewRow] = []
        rows.append(PreviewRow(id: "customer", group: "Invoicing", title: demo.customerName,
                               detail: "Customer number \(demo.customerNumber)", action: customer == nil ? "Create customer" : "Match customer"))
        rows.append(PreviewRow(id: "product", group: "Invoicing", title: demo.productName,
                               detail: "Revenue account 3000 · 25% VAT", action: product == nil ? "Create product" : "Match product"))
        var invoiceIDs: [String: Int] = [:]
        for document in demo.documents {
            let id = journal.result(for: document.externalId)
            if let id { try await verifyDocument(document, id: id) }
            invoiceIDs[document.externalId] = id
            rows.append(PreviewRow(id: document.externalId, group: "Invoicing",
                                   title: "\(document.isCredit ? "Credit note" : "Invoice") \(document.number)",
                                   detail: "NOK \(document.total) · VAT \(document.vat) · Original PDF",
                                   action: id == nil ? "Import and book" : "Imported"))
        }

        let runs: [SalaryRun] = try await api.request("/api/salary-payments", token: token, tenant: tenant.id, query: [
            URLQueryItem(name: "startDate", value: demo.issueDate),
            URLQueryItem(name: "endDate", value: demo.issueDate)
        ])
        let salaryID = journal.result(for: salaryKey)
        let payrollPeriodOccupied = runs.contains { $0.period == demo.period && $0.id != salaryID }
        let wageID = journal.result(for: wageKey)
        if let salaryID {
            guard let wage = demo.wages.first, let employee = employees[wage.candidateId] else {
                throw appError("The saved draft could not be matched to the sample employee.")
            }
            let salary: SalaryDetail = try await read("/api/salary-payments/\(salaryID)")
            try verifyPayroll(salary, employeeID: employee.id, wage: wage, wageID: wageID)
        }
        for employee in demo.employees {
            let wages = demo.wages.filter { $0.candidateId == employee.candidateId }
            let detail: String
            let action: String
            let needsReview: Bool
            if let review = demo.wageReview(for: employee.candidateId) {
                detail = "\(review) · \(wages.map(\.municipality).joined(separator: ", "))"
                action = "Hold for review"
                needsReview = true
            } else if payrollPeriodOccupied {
                detail = "\(demo.period) already has a salary payment. Choose a sample date in another month to test payroll."
                action = "Skip payroll"
                needsReview = true
            } else {
                detail = "\(demo.period) · \(wages.first?.hours ?? 0) h × NOK \(wages.first?.rate ?? 0) · Hourly salary"
                action = wageID == nil ? "Add to draft" : "Draft saved"
                needsReview = false
            }
            rows.append(PreviewRow(id: "payroll-\(employee.candidateId)", group: "Payroll", title: employee.name,
                                   detail: detail, action: action, needsReview: needsReview,
                                   candidateID: employee.candidateId))
        }
        let payrollCandidateID = demo.wages.first.flatMap { wage in
            demo.wageReview(for: wage.candidateId) == nil && wage.specification != nil ? wage.candidateId : nil
        }
        return FullSamplePreview(rows: rows, payrollPeriodOccupied: payrollPeriodOccupied, customer: customer,
                                 product: product, invoiceIDs: invoiceIDs, salaryID: salaryID, wageID: wageID,
                                 payrollCandidateID: payrollCandidateID)
    }

    private var salaryKey: String { "salary-\(demo.period)" }
    private var wageKey: String { "\(salaryKey)-wage-101" }

    private func employeeKey(_ candidate: Demo.Candidate) -> String { "employee-\(candidate.candidateId)" }

    private func checkReceipt(_ journal: Journal, key: String, existingID: Int?) throws {
        if let saved = journal.result(for: key), saved != existingID {
            throw appError("The saved receipt for \(key) differs from local ReAI. Reconcile before importing.")
        }
    }

    private func validateIdentity(_ employee: Employee, candidate: Demo.Candidate) throws {
        guard employee.email?.caseInsensitiveCompare(candidate.email) == .orderedSame,
              employee.name.caseInsensitiveCompare(candidate.name) == .orderedSame else {
            throw appError("The employee name and email disagree for \(candidate.name).")
        }
    }

    private func validateBank(_ employee: Employee, candidate: Demo.Candidate) throws {
        if employmentMunicipality(candidate) != nil,
           employee.bankAccount?.localNumber != demo.payrollBankAccount || employee.bankAccount?.countryCode != "NO" {
            throw appError("The matched sample employee requires the synthetic Norwegian bank account for draft payroll.")
        }
    }

    private func validateEmployment(_ employee: Employee, candidate: Demo.Candidate) throws {
        guard employee.employmentRelations.count == 1, let relation = employee.employmentRelations.first,
              relation.startDate == demo.employmentStart, relation.endDate == nil,
              relation.employmentLines.count == 1, let line = relation.employmentLines.first,
              line.startDate == demo.employmentStart, line.remunerationType == "hourly_wage",
              line.municipality == employmentMunicipality(candidate) else {
            throw appError("Review the existing employment details for \(candidate.name) in localhost ReAI.")
        }
    }

    private func employmentMunicipality(_ candidate: Demo.Candidate) -> String? {
        guard demo.wageReview(for: candidate.candidateId) == nil else { return nil }
        return demo.wages.first { $0.candidateId == candidate.candidateId }?.municipality
    }

    private func importEmployee(_ candidate: Demo.Candidate, existing: Employee?, journal: Journal) async throws -> Employee {
        var line: [String: Any] = [
            "startDate": demo.employmentStart, "remunerationType": "hourly_wage",
            "formOfEmployment": "temporary_hired_out", "percentage": 100
        ]
        if let municipality = employmentMunicipality(candidate) { line["municipality"] = municipality }
        let key = employeeKey(candidate)
        let employee: Employee
        if let existing {
            guard existing.employmentRelations.isEmpty else { return existing }
            employee = try await post("/api/employees/\(existing.id)/employment-relations",
                                      fields: ["startDate": demo.employmentStart, "employmentLines": [line]],
                                      key: "\(key)-employment", journal: journal)
            try validateEmployment(employee, candidate: candidate)
            try journal.complete("\(key)-employment", id: employee.id)
        } else {
            var fields: [String: Any] = [
                "name": candidate.name, "email": candidate.email,
                "dateOfEmployment": demo.employmentStart, "employmentLines": [line]
            ]
            if employmentMunicipality(candidate) != nil {
                fields["accountNumber"] = demo.payrollBankAccount
                fields["bankCountryCode"] = "NO"
            }
            employee = try await post("/api/employees", fields: fields, key: key, journal: journal)
            try validateIdentity(employee, candidate: candidate)
            try validateBank(employee, candidate: candidate)
            try validateEmployment(employee, candidate: candidate)
            try journal.complete(key, id: employee.id)
        }
        return employee
    }

    private func validateCustomer(_ customer: Customer) throws {
        guard customer.number == demo.customerNumber, customer.name == demo.customerName, !customer.archived else {
            throw appError("The synthetic customer number or name conflicts with a local customer.")
        }
    }

    private func importCustomer(existing: Customer?, journal: Journal) async throws -> Customer {
        if let existing { return existing }
        let customer: Customer = try await post("/api/customers", fields: [
            "name": demo.customerName, "number": demo.customerNumber, "skipRegistryLookup": true, "countryCode": "NO"
        ], key: "customer", journal: journal)
        try validateCustomer(customer)
        try journal.complete("customer", id: customer.id)
        return customer
    }

    private func validateProduct(_ product: Product) throws {
        guard product.title == demo.productName, product.variants.map(\.sku) == [demo.productSKU],
              product.revenueAccountCode == "3000", product.vatCode == "3", !product.archived, !product.stockItem else {
            throw appError("The synthetic product mapping differs from the local product. Review its SKU, revenue account and VAT.")
        }
    }

    private func importProduct(existing: Product?, journal: Journal) async throws -> Product {
        if let existing { return existing }
        let product: Product = try await post("/api/products", fields: [
            "title": demo.productName, "stockItem": false, "revenueAccountCode": "3000", "vatCode": "3",
            "variants": [["sku": demo.productSKU, "sellingPrice": 1000]]
        ], key: "product", journal: journal)
        try validateProduct(product)
        try journal.complete("product", id: product.id)
        return product
    }

    private func importDocument(_ document: Demo.Document, customerID: Int, productID: Int, journal: Journal) async throws {
        var fields: [String: Any] = [
            "source": "recman", "sourceInstance": "synthetic-poc", "externalId": document.externalId,
            "number": document.number, "issueDate": document.issueDate,
            "customerId": customerID, "accounting": "book", "automaticRemindersEnabled": false,
            "orderItems": [["productId": productID, "quantity": document.billedQuantity, "price": document.unitPrice, "currencyCode": "NOK"]],
            "originalPdf": ["filename": "\(document.number).pdf", "contentBase64": document.pdf.base64EncodedString()]
        ]
        if !document.isCredit { fields["dueDate"] = document.issueDate }
        if let reference = document.paymentReference { fields["paymentReference"] = reference }
        let invoice: ImportedInvoice = try await post("/api/invoices/import", fields: fields, key: document.externalId, journal: journal)
        try await verifyDocument(document, id: invoice.id)
        try journal.complete(document.externalId, id: invoice.id)
    }

    private func verifyDocument(_ document: Demo.Document, id: Int) async throws {
        let invoice: ImportedInvoice = try await read("/api/invoices/\(id)")
        guard invoice.externalId == document.externalId, invoice.importSource == "recman",
              invoice.importSourceInstance == "synthetic-poc", invoice.number == document.number, invoice.paymentReference == document.paymentReference,
              invoice.issueDate == document.issueDate, invoice.creditNote == document.isCredit,
              invoice.currencyCode == "NOK", invoice.voucherId != nil, !invoice.automaticRemindersEnabled,
              invoice.totalAmount == document.total, invoice.totalExclVatAmount == document.net,
              invoice.totalVatAmount == document.vat, invoice.originalAttachmentId != nil else {
            throw appError("The saved invoice differs from the reviewed sample. Check \(document.number) in localhost ReAI.")
        }
        let pdf = try await api.invoicePDF(id: id, token: token, tenant: tenant.id)
        guard pdf == document.pdf else { throw appError("The original PDF differs for \(document.number).") }
    }

    private func importPayroll(employeeID: Int, wage: Demo.Wage, specification: String,
                               current: FullSamplePreview, journal: Journal) async throws {
        let salaryID: Int
        if let id = current.salaryID {
            salaryID = id
        } else {
            let salary: SalaryRun = try await post("/api/salary-payments", fields: [
                "period": demo.period, "paymentDate": demo.paymentDate, "employeeIds": [employeeID]
            ], key: salaryKey, journal: journal)
            guard salary.period == demo.period else { throw appError("The draft payroll period differs from the preview.") }
            let detail: SalaryDetail = try await read("/api/salary-payments/\(salary.id)")
            try verifyPayroll(detail, employeeID: employeeID, wage: wage, wageID: nil)
            try journal.complete(salaryKey, id: salary.id)
            salaryID = salary.id
        }
        guard current.wageID == nil else { return }
        let salary: SalaryDetail = try await post("/api/salary-payments/\(salaryID)/wage-specs", fields: [
            "employeeId": employeeID, "specificationCode": specification, "quantity": wage.hours, "rate": wage.rate,
            "comment": wageKey
        ], key: wageKey, journal: journal)
        guard let spec = salary.employees.first?.wageSpecs.first(where: { $0.comment == wageKey }) else {
            throw appError("ReAI did not return the sample wage line.")
        }
        try verifyPayroll(salary, employeeID: employeeID, wage: wage, wageID: spec.id)
        try journal.complete(wageKey, id: spec.id)
    }

    private func verifyPayroll(_ salary: SalaryDetail, employeeID: Int, wage: Demo.Wage, wageID: Int?) throws {
        guard salary.status == "under_process", !salary.imported, salary.voucherId == nil, salary.paymentDate == demo.paymentDate,
              salary.employees.map(\.employeeId) == [employeeID] else {
            throw appError("The saved payroll differs from the reviewed draft. Check the local salary payment.")
        }
        let imported = salary.employees.flatMap(\.wageSpecs).filter { $0.comment == wageKey }
        guard let wageID else {
            if !imported.isEmpty { throw appError("A wage line exists without a local receipt. Reconcile before importing.") }
            return
        }
        guard imported.count == 1, let spec = imported.first, spec.id == wageID,
              spec.specificationCode == wage.specification, spec.quantity == Decimal(wage.hours),
              spec.rate == Decimal(wage.rate) else {
            throw appError("The saved wage line differs from the reviewed draft.")
        }
    }

    private func read<T: Decodable & Sendable>(_ path: String) async throws -> T {
        try await api.request(path, token: token, tenant: tenant.id)
    }

    private func post<T: Decodable & Sendable>(_ path: String, fields: [String: Any],
                                              key: String, journal: Journal) async throws -> T {
        try Task.checkCancellation()
        let data = try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys])
        try journal.begin(key, endpoint: path, body: data)
        return try await api.request(path, token: token, tenant: tenant.id, body: data)
    }
}
