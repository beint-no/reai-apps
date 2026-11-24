import Foundation

private struct EmployeeSummary: Decodable {
    let id: Int
    let name: String
    let email: String?
}

private struct Employee: Decodable, Equatable {
    struct Relation: Decodable, Equatable {
        struct Line: Decodable, Equatable {
            let startDate: String
            let percentage: Decimal?
        }
        let startDate: String
        let endDate: String?
        let employmentLines: [Line]
    }
    let id: Int
    let name: String
    let email: String?
    let employmentRelations: [Relation]
}

struct PreviewRow: Equatable, Identifiable {
    let id: Int
    let title: String
    let detail: String
    let action: String
    var needsReview = false
}

fileprivate struct EmployeePlan: Equatable {
    let receiptKey: String
    let name: String
    let email: String
    let startDate: String
    let endDate: String?
    let percentage: Decimal
    let existing: Employee?

    var displayEmployment: String {
        let end = endDate.map { " to \($0)" } ?? ""
        return "\(startDate)\(end) · \(percentage)% · \(email)"
    }
}

struct ImportPreview: Equatable {
    let source: [RecManEmployee]
    let employeeRows: [PreviewRow]
    fileprivate let plans: [Int: EmployeePlan]

    var selectableEmployeeIDs: Set<Int> { Set(plans.keys) }
}

struct EmployeeImportResult {
    var added: [String] = []
    var employmentAdded: [String] = []
    var alreadyMatched: [String] = []

    var message: String {
        var lines: [String] = []
        if !added.isEmpty { lines.append("Added \(added.joined(separator: ", ")).") }
        if !employmentAdded.isEmpty {
            lines.append("Added employment for \(employmentAdded.joined(separator: ", ")).")
        }
        if !alreadyMatched.isEmpty {
            lines.append("Matched existing records for \(alreadyMatched.joined(separator: ", ")).")
        }
        return lines.joined(separator: "\n")
    }
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

    func perform(_ reviewed: ImportPreview, selectedEmployeeIDs: Set<Int>) async throws -> EmployeeImportResult {
        guard !selectedEmployeeIDs.isEmpty, selectedEmployeeIDs.isSubset(of: reviewed.selectableEmployeeIDs) else {
            throw appError("Select at least one employee who is ready to import.")
        }
        let journal = try Journal(server: api.server, tenant: tenant, directory: journalDirectory)
        let current = try await prepare(employees: reviewed.source, journal: journal)
        let plans = reviewed.employeeRows.filter { selectedEmployeeIDs.contains($0.id) }.compactMap { row in
            reviewed.plans[row.id]
        }
        guard selectedEmployeeIDs.allSatisfy({ reviewed.plans[$0] == current.plans[$0] }) else {
            throw appError("The selected employees changed in ReAI. Reload and review them before importing.")
        }

        var result = EmployeeImportResult()
        for plan in plans {
            do {
                try await importEmployee(plan, journal: journal)
            } catch {
                let failure = "Could not complete the import for \(plan.name). \(error.localizedDescription)"
                let details = [failure, result.message].filter { !$0.isEmpty }
                throw appError(details.joined(separator: "\n\n"))
            }
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
                let plan = try makePlan(candidate, id: id, email: email, existing: existing, formatter: formatter)
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
                    action = "Create employee and employment"
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

    private func makePlan(_ candidate: RecManEmployee, id: Int, email: String, existing: Employee?,
                          formatter: ISO8601DateFormatter) throws -> EmployeePlan {
        guard let corporation = candidate.corporationId?.positiveID else {
            throw appError("Missing RecMan corporation ID.")
        }
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
        return EmployeePlan(receiptKey: "recman-\(corporation)-employee-\(id)", name: candidate.name,
                            email: email, startDate: start, endDate: end, percentage: percentage, existing: existing)
    }

    private func isDate(_ text: String, formatter: ISO8601DateFormatter) -> Bool {
        guard let date = formatter.date(from: text) else { return false }
        return formatter.string(from: date) == text
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

    private func importEmployee(_ plan: EmployeePlan, journal: Journal) async throws {
        let employmentLine: [String: Any] = [
            "startDate": plan.startDate, "percentage": NSDecimalNumber(decimal: plan.percentage)
        ]
        var fields: [String: Any] = ["employmentLines": [employmentLine]]
        let endpoint: String
        let key: String
        if let existing = plan.existing {
            guard existing.employmentRelations.isEmpty else { return }
            endpoint = "/api/employees/\(existing.id)/employment-relations"
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
        }

        try Task.checkCancellation()
        let body = try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys])
        try journal.begin(key, endpoint: endpoint, body: body)
        let employee: Employee = try await api.request(endpoint, token: token, tenant: tenant.id, body: body)
        try validateIdentity(employee, plan: plan)
        try validateEmployment(employee, plan: plan)
        try journal.complete(key, id: employee.id)
    }
}
