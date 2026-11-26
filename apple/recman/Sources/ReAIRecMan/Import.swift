import Foundation

private struct EmployeeSummary: Decodable {
    let id: Int
    let name: String
    let email: String?
}

struct Employee: Decodable, Equatable {
    struct Bank: Decodable, Equatable {
        let accountNumber: String
        let bankCode: String?
        let countryCode: String?

        func matchesNorwegianAccount(_ expected: String) -> Bool {
            countryCode == "NO" &&
                [accountNumber, (bankCode ?? "") + accountNumber].compactMap(verifiedNorwegianAccount).contains(expected)
        }
    }

    struct Relation: Decodable, Equatable {
        struct Line: Codable, Equatable {
            let id: Int?
            let startDate: String
            var municipality: String?
            let employmentType: String?
            let formOfEmployment: String?
            let workingHoursScheme: String?
            let remunerationType: String?
            let occupationCode: String?
            let percentage: Decimal?
            let lastSalaryChangeDate: String?
            let lastPositionPercentageChangeDate: String?
            let annualSalary: Decimal?
            let hourlyWage: Decimal?
            let fullTimeHoursPerWeek: Decimal?
        }
        let startDate: String
        let endDate: String?
        let employmentLines: [Line]
    }
    let id: Int
    let name: String
    let email: String?
    let employmentRelations: [Relation]
    let bankAccount: Bank?

    var hasBankAccount: Bool {
        normalizedIdentity(bankAccount?.accountNumber) != nil
    }

    var lineMissingMunicipality: Relation.Line? {
        guard employmentRelations.count == 1, let lines = employmentRelations.first?.employmentLines,
              lines.count == 1, let line = lines.first, line.id != nil,
              normalizedIdentity(line.municipality) == nil else { return nil }
        return line
    }

    func municipality(on start: String, through end: String) -> String? {
        let eligible = employmentRelations.filter {
            $0.startDate <= start && ($0.endDate.map { $0 >= end } ?? true)
        }
        guard eligible.count == 1, let relation = eligible.first else { return nil }
        let first = relation.employmentLines.filter { $0.startDate <= start }.max { $0.startDate < $1.startDate }
        guard let code = normalizedIdentity(first?.municipality),
              !relation.employmentLines.contains(where: {
                  $0.startDate > start && $0.startDate <= end && $0.municipality != code
              }) else { return nil }
        return code
    }
}

struct PreviewRow: Equatable, Identifiable {
    let id: Int
    let title: String
    let detail: String
    let action: String
    var needsReview = false
}

struct EmployeePlan: Equatable {
    let receiptKey: String
    let replacesMissingEmployee: Bool
    let name: String
    let email: String
    let startDate: String
    let endDate: String?
    let percentage: Decimal
    let existing: Employee?
    let bankToImport: String?
    let bankIssue: String?

    var displayEmployment: String {
        let end = endDate.map { " to \($0)" } ?? ""
        let bank = bankToImport.map { " · Add RecMan bank ending \($0.suffix(4))" } ?? ""
        return "\(startDate)\(end) · \(percentage)% · \(email)\(bank)"
    }
}

struct ImportPreview: Equatable {
    let source: [RecManEmployee]
    let employeeRows: [PreviewRow]
    let plans: [Int: EmployeePlan]

    var selectableEmployeeIDs: Set<Int> { Set(plans.keys) }
}

struct EmployeeImportResult {
    var added: [String] = []
    var employmentAdded: [String] = []
    var alreadyMatched: [String] = []
    var bankAdded: [String] = []
    var municipalityAdded: [String] = []
    var employees: [Int: Employee] = [:]

    var message: String {
        var lines: [String] = []
        if !added.isEmpty { lines.append("Added \(added.joined(separator: ", ")).") }
        if !employmentAdded.isEmpty {
            lines.append("Added employment for \(employmentAdded.joined(separator: ", ")).")
        }
        if !alreadyMatched.isEmpty {
            lines.append("Matched existing records for \(alreadyMatched.joined(separator: ", ")).")
        }
        if !bankAdded.isEmpty { lines.append("Added bank details for \(bankAdded.joined(separator: ", ")).") }
        if !municipalityAdded.isEmpty { lines.append("Saved workplace municipalities for \(municipalityAdded.joined(separator: ", ")).") }
        return lines.joined(separator: "\n")
    }
}

struct EmployeePayrollSetup: Equatable {
    let municipality: String
}

@MainActor
struct RecManImport {
    let api: ReAIAPI
    let token: String
    let tenant: Company
    var journalDirectory: URL? = nil

    func preview(employees: [RecManEmployee]) async throws -> ImportPreview {
        try await prepare(employees: employees, journal: Journal(server: api.server, tenant: tenant, directory: journalDirectory))
    }

    func perform(_ reviewed: ImportPreview, selectedEmployeeIDs: Set<Int>,
                 payrollSetup: [Int: EmployeePayrollSetup] = [:]) async throws -> EmployeeImportResult {
        guard !selectedEmployeeIDs.isEmpty, selectedEmployeeIDs.isSubset(of: reviewed.selectableEmployeeIDs) else {
            throw appError("Select at least one employee who is ready to import.")
        }
        let journal = try Journal(server: api.server, tenant: tenant, directory: journalDirectory)
        let current = try await prepare(employees: reviewed.source, journal: journal)
        let orderedIDs = reviewed.employeeRows.map(\.id).filter { selectedEmployeeIDs.contains($0) }
        guard selectedEmployeeIDs.allSatisfy({ reviewed.plans[$0] == current.plans[$0] }) else {
            throw appError("The selected employees changed in ReAI. Reload and review them before importing.")
        }

        var result = EmployeeImportResult()
        for id in orderedIDs {
            guard let plan = reviewed.plans[id] else { throw appError("An employee preview is missing.") }
            do {
                result.employees[id] = try await importEmployee(plan, setup: payrollSetup[id], journal: journal)
            } catch {
                let failure = "Could not complete the import for \(plan.name). \(error.localizedDescription)"
                let details = [failure, result.message].filter { !$0.isEmpty }
                throw appError(details.joined(separator: "\n\n"))
            }
            if plan.bankToImport != nil { result.bankAdded.append(plan.name) }
            if payrollSetup[id] != nil { result.municipalityAdded.append(plan.name) }
            if let existing = plan.existing {
                if existing.employmentRelations.isEmpty {
                    result.employmentAdded.append(plan.name)
                } else {
                    result.alreadyMatched.append(plan.name)
                }
            } else {
                result.added.append(plan.name)
            }
        }
        return result
    }

    private func prepare(employees: [RecManEmployee], journal: Journal) async throws -> ImportPreview {
        guard tenant.currencyCode == "NOK" else { throw appError("Choose a ReAI company using NOK.") }
        let people: [EmployeeSummary] = try await api.request("/api/employees", token: token, tenant: tenant.id)
        let currentEmployeeIDs = Set(people.map(\.id))
        let sourceEmails = Dictionary(grouping: employees.compactMap(\.contactEmail), by: { $0.lowercased() })
        let sourceNames = Dictionary(grouping: employees.map(\.name), by: { $0.lowercased() })
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]

        var rows: [PreviewRow] = []
        var plans: [Int: EmployeePlan] = [:]
        for candidate in employees {
            guard let id = candidate.candidateId.positiveID else {
                throw appError("RecMan returned an invalid candidate ID.")
            }
            let name = candidate.name
            let email = candidate.contactEmail
            let matches = people.filter {
                (!name.isEmpty && $0.name.caseInsensitiveCompare(name) == .orderedSame) ||
                    (email != nil && $0.email?.caseInsensitiveCompare(email ?? "") == .orderedSame)
            }
            let existing: Employee? = if matches.count == 1, let summary = matches.first {
                try await api.request("/api/employees/\(summary.id)", token: token, tenant: tenant.id)
            } else { nil }
            do {
                guard matches.count <= 1 else { throw appError("Multiple ReAI employees match this name or email.") }
                guard let email, sourceEmails[email.lowercased()]?.count == 1 else {
                    throw appError("A unique employee email is required.")
                }
                guard sourceNames[name.lowercased()]?.count == 1 else {
                    throw appError("Multiple RecMan employees have this name.")
                }
                guard let corporation = candidate.corporationId?.positiveID else {
                    throw appError("Missing RecMan corporation ID.")
                }
                let originalKey = "recman-\(corporation)-employee-\(id)"
                let receiptKey = try employeeReceiptKey(originalKey, existingID: existing?.id,
                                                        currentEmployeeIDs: currentEmployeeIDs, journal: journal)
                let plan = try makePlan(candidate, email: email, existing: existing, formatter: formatter,
                                        receiptKey: receiptKey,
                                        replacesMissingEmployee: existing == nil && receiptKey != originalKey)
                if let existing {
                    try validateIdentity(existing, plan: plan)
                    if !existing.employmentRelations.isEmpty { try validateEmployment(existing, plan: plan) }
                }
                try checkReceipt(journal, key: plan.receiptKey, existingID: existing?.id)
                try checkReceipt(journal, key: "\(plan.receiptKey)-employment",
                                 existingID: existing?.employmentRelations.isEmpty == false ? existing?.id : nil)
                let action: String
                if let existing {
                    action = existing.employmentRelations.isEmpty ? "Add employment" : "Match employee and employment"
                } else {
                    action = plan.replacesMissingEmployee ? "Recreate missing employee" : "Create employee and employment"
                }
                plans[id] = plan
                rows.append(PreviewRow(id: id, title: plan.name, detail: plan.displayEmployment, action: action))
            } catch let error as AppError {
                rows.append(PreviewRow(id: id, title: name.isEmpty ? "Unnamed employee" : name,
                                       detail: error.message, action: "Review required", needsReview: true))
            }
        }
        return ImportPreview(source: employees, employeeRows: rows, plans: plans)
    }

    private func makePlan(_ candidate: RecManEmployee, email: String, existing: Employee?,
                          formatter: ISO8601DateFormatter, receiptKey: String,
                          replacesMissingEmployee: Bool) throws -> EmployeePlan {
        guard !candidate.name.isEmpty, candidate.name.count <= 75,
              email.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil else {
            throw appError("A valid name and email are required.")
        }
        guard let relations = candidate.employment, relations.count == 1, let relation = relations.first else {
            throw appError("Exactly one RecMan employment relation is required.")
        }
        guard let start = relation.startDate, isDate(start, formatter: formatter) else {
            throw appError("Missing or invalid employment start date.")
        }
        let rawEnd = relation.endDate?.trimmingCharacters(in: .whitespacesAndNewlines)
        let end = if let rawEnd, !rawEnd.isEmpty, rawEnd != "ongoing" { rawEnd } else { nil as String? }
        if let end, !isDate(end, formatter: formatter) || end < start {
            throw appError("Invalid employment end date.")
        }
        guard let percentage = relation.positionPercent?.value, (0...100).contains(percentage) else {
            throw appError("Missing or invalid employment percentage.")
        }
        let bankToImport = existing?.hasBankAccount == true ? nil :
            verifiedNorwegianAccount(relation.bankAccount) ?? verifiedNorwegianIBAN(relation.iban)
        let bankIssue: String?
        if existing?.hasBankAccount == true || bankToImport != nil {
            bankIssue = nil
        } else if normalizedIdentity(relation.bankAccount) == nil && normalizedIdentity(relation.iban) == nil {
            bankIssue = "RecMan has no bank details. Add a verified account in RecMan or ReAI."
        } else {
            bankIssue = "RecMan bank details are invalid or unsupported. Add corrected details in RecMan or ReAI."
        }
        return EmployeePlan(receiptKey: receiptKey, replacesMissingEmployee: replacesMissingEmployee,
                            name: candidate.name, email: email, startDate: start, endDate: end, percentage: percentage, existing: existing,
                            bankToImport: bankToImport, bankIssue: bankIssue)
    }

    private func isDate(_ text: String, formatter: ISO8601DateFormatter) -> Bool {
        guard let date = formatter.date(from: text) else { return false }
        return formatter.string(from: date) == text
    }

    private func employeeReceiptKey(_ originalKey: String, existingID: Int?, currentEmployeeIDs: Set<Int>,
                                    journal: Journal) throws -> String {
        var key = originalKey
        var previousIDs = Set<Int>()
        let operationSuffixes = ["", "-employment", "-bank", "-municipality", "-bank-municipality"]
        while true {
            let recordedIDs = Set(operationSuffixes.compactMap { journal.result(for: key + $0) })
            guard recordedIDs.count <= 1 else {
                throw appError("Employee import receipts disagree. Reconcile before importing.")
            }
            guard let recorded = recordedIDs.first else {
                if key != originalKey, existingID != nil {
                    throw appError("The existing employee differs from the saved import receipt. Reconcile before importing.")
                }
                return key
            }
            if recorded == existingID { return key }
            guard !currentEmployeeIDs.contains(recorded), previousIDs.insert(recorded).inserted else {
                throw appError("The saved import receipt differs from ReAI. Reconcile before importing.")
            }
            key = "\(originalKey)-after-\(recorded)"
        }
    }

    private func checkReceipt(_ journal: Journal, key: String, existingID: Int?) throws {
        if let saved = journal.result(for: key), saved != existingID {
            throw appError("The saved import receipt differs from ReAI. Reconcile before importing.")
        }
    }

    private func validateIdentity(_ employee: Employee, plan: EmployeePlan) throws {
        guard employee.email?.caseInsensitiveCompare(plan.email) == .orderedSame,
              employee.name.caseInsensitiveCompare(plan.name) == .orderedSame else {
            throw appError("The employee name and email do not both match ReAI.")
        }
    }

    private func validateEmployment(_ employee: Employee, plan: EmployeePlan) throws {
        guard employee.employmentRelations.count == 1, let relation = employee.employmentRelations.first,
              relation.startDate == plan.startDate, relation.endDate == plan.endDate,
              relation.employmentLines.count == 1, let line = relation.employmentLines.first,
              line.startDate == plan.startDate, line.percentage == plan.percentage else {
            throw appError("Review the existing employment dates and percentage in ReAI.")
        }
    }

    private func importEmployee(_ plan: EmployeePlan, setup: EmployeePayrollSetup?, journal: Journal) async throws -> Employee {
        var employmentLine: [String: Any] = [
            "startDate": plan.startDate, "percentage": NSDecimalNumber(decimal: plan.percentage)
        ]
        if let setup { employmentLine["municipality"] = setup.municipality }
        var fields: [String: Any] = ["employmentLines": [employmentLine]]
        let endpoint: String
        let key: String
        if let existing = plan.existing {
            let employeePath = "/api/employees/\(existing.id)"
            if !existing.employmentRelations.isEmpty {
                return try await updateEmployee(existing, plan: plan, setup: setup, journal: journal)
            }
            endpoint = "\(employeePath)/employment-relations"
            key = "\(plan.receiptKey)-employment"
            fields["startDate"] = plan.startDate
            if let end = plan.endDate { fields["endDate"] = end }
        } else {
            endpoint = "/api/employees"
            key = plan.receiptKey
            fields["name"] = plan.name
            fields["email"] = plan.email
            fields["dateOfEmployment"] = plan.startDate
            if let end = plan.endDate { fields["endDateOfEmployment"] = end }
            if let bank = plan.bankToImport {
                fields["accountNumber"] = bank
                fields["bankCountryCode"] = "NO"
            }
        }

        let target = AccountingTarget(api: api, tenant: tenant, token: token)
        let employee: Employee = try await target.write(endpoint, fields: fields, key: key, journal: journal)
        try validateIdentity(employee, plan: plan)
        try validateEmployment(employee, plan: plan)
        if let setup, employee.employmentRelations.first?.employmentLines.first?.municipality != setup.municipality {
            throw appError("ReAI did not return the reviewed municipality.")
        }
        if plan.existing == nil, let bank = plan.bankToImport, employee.bankAccount?.matchesNorwegianAccount(bank) != true {
            throw appError("ReAI did not return the reviewed bank account.")
        }
        try journal.complete(key, id: employee.id)
        if plan.existing != nil {
            return try await updateEmployee(employee, plan: plan, setup: nil, journal: journal)
        }
        return employee
    }

    private func updateEmployee(_ employee: Employee, plan: EmployeePlan, setup: EmployeePayrollSetup?,
                                journal: Journal) async throws -> Employee {
        var fields: [String: Any] = [:]
        var updatedLine: Employee.Relation.Line?
        if let setup, var line = employee.lineMissingMunicipality {
            line.municipality = setup.municipality
            fields["employmentLines"] = [try JSONSerialization.jsonObject(with: JSONEncoder().encode(line))]
            updatedLine = line
        }
        if let bank = plan.bankToImport, !employee.hasBankAccount {
            fields["accountNumber"] = bank
            fields["bankCountryCode"] = "NO"
        }
        guard !fields.isEmpty else { return employee }

        let endpoint = "/api/employees/\(employee.id)"
        let change = fields["accountNumber"] == nil ? "municipality" : (updatedLine == nil ? "bank" : "bank-municipality")
        let key = "\(plan.receiptKey)-\(change)"
        let target = AccountingTarget(api: api, tenant: tenant, token: token)
        let saved: Employee = try await target.write(endpoint, fields: fields, key: key, journal: journal, method: "PATCH")
        try validateIdentity(saved, plan: plan)
        try validateEmployment(saved, plan: plan)
        guard saved.id == employee.id,
              plan.bankToImport.map({ saved.bankAccount?.matchesNorwegianAccount($0) == true }) ?? true,
              updatedLine.map({ saved.employmentRelations.first?.employmentLines == [$0] }) ??
                  (saved.employmentRelations == employee.employmentRelations) else {
            throw appError("ReAI did not return the reviewed employee details.")
        }
        try journal.complete(key, id: saved.id)
        return saved
    }
}
