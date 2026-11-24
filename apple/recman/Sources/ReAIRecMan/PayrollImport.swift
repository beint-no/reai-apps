import Foundation

private struct PayrollEmployeeSummary: Decodable, Sendable {
    let id: Int
    let name: String
    let email: String?
}

private struct PayrollEmployee: Decodable, Equatable, Sendable {
    struct Bank: Decodable, Equatable, Sendable {
        let accountNumber: String
    }
    struct Employment: Decodable, Equatable, Sendable {
        struct Line: Decodable, Equatable, Sendable {
            let startDate: String
            let municipality: String?
        }
        let startDate: String
        let endDate: String?
        let employmentLines: [Line]
    }

    let id: Int
    let name: String
    let email: String?
    let bankAccount: Bank?
    let employmentRelations: [Employment]

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

private struct PayrollRunSummary: Decodable, Sendable {
    let id: Int
    let status: String
    let periodYear: Int
    let periodMonth: Int
}

private struct PayrollDraft: Decodable, Sendable {
    struct Payee: Decodable, Sendable {
        struct Wage: Decodable, Sendable {
            let id: Int
            let specificationCode: String
            let comment: String?
            let quantity: Decimal
            let rate: Decimal
        }
        let employeeId: Int
        let wageSpecs: [Wage]
    }
    let id: Int
    let status: String
    let voucherId: Int?
    let paymentDate: String?
    let imported: Bool
    let employees: [Payee]
}

private struct PayrollEntry: Sendable {
    let check: RecManPaycheck
    let employee: PayrollEmployee
    let municipality: String
}

struct PayrollBatch {
    let rows: [AccountingRow]
    let mappings: [AccountingMapping]
    fileprivate let entries: [String: PayrollEntry]
    fileprivate let checks: [RecManPaycheck]
    fileprivate let period: String
    fileprivate let paymentDate: String
}

@MainActor
struct PayrollImport {
    let source: RecManAPI
    let key: String
    let target: AccountingTarget

    // Keep these in step with the regular wage-spec endpoint. Each source article requires an explicit choice.
    static let wageCodes = [
        "hourly_salary", "hourly_salary_adjustment", "fixed_salary", "overtime_salary",
        "overtime_premium", "overtime_adjustment", "bonus", "commission", "commission_adjustment",
        "holiday_allowance", "vacation_deduction", "taxable_equipment_rent", "taxable_insurance_benefit",
        "electronic_communication_benefit", "debt_to_employees_expense", "employees_travel_expense",
        "taxable_travel_meals", "tax_free_travel_meals_day", "tax_free_travel_meals_hotel",
        "tax_free_travel_meals_no_kitchen", "tax_free_travel_meals_with_kitchen", "tax_free_mileage_allowance",
        "travel_expense_mileage", "travel_expense_taxable_mileage", "other_reportable_expense_allowance"
    ]

    func load(periodDate: String, paymentDate: String) async throws -> PayrollBatch {
        guard accountingDate(periodDate), accountingDate(paymentDate), target.tenant.currencyCode == "NOK" else {
            throw appError("Choose a valid payroll month, payment date, and an NOK ReAI company.")
        }
        let period = String(periodDate.prefix(7))
        let journal = try target.journal()
        let minID = journal.result(for: checkpoint(period))
        var parameters = ["exported": "0"]
        if let minID { parameters["minPaycheckId"] = String(minID) }
        let loaded: [RecManPaycheck] = try await source.fetchAll("paycheck", key: key, parameters: parameters)
        let checks = loaded.filter { $0.paycheckId > (minID ?? 0) }
        guard checks.allSatisfy({ $0.paycheckId > 0 }), Set(checks.map(\.paycheckId)).count == checks.count else {
            throw appError("RecMan returned conflicting paycheck IDs.")
        }
        let pending = checks.filter { relevant($0, period: period) && journal.result(for: receipt($0)) == nil }
        guard !pending.isEmpty else {
            return PayrollBatch(rows: [], mappings: [], entries: [:], checks: checks, period: period, paymentDate: paymentDate)
        }

        let candidates = try await source.employees(key: key)
        let existing: [PayrollEmployeeSummary] = try await target.read("/api/employees")
        let workplaces = try await loadWorkplaces(for: pending)
        let runs = try await salaryRuns(period: period)
        let knownDraft = journal.result(for: draftKey(period))
        let occupied = runs.contains { $0.id != knownDraft }
        var entries: [String: PayrollEntry] = [:]
        var mappings: [String: AccountingMapping] = [:]
        var rows: [AccountingRow] = []
        var employeeDetails: [Int: PayrollEmployee] = [:]
        for check in pending.sorted(by: { $0.paycheckId < $1.paycheckId }) {
            let rowID = receipt(check)
            let candidate = candidates.first { $0.candidateId.positiveID == check.candidateId }
            let title = candidate?.name ?? "Unmatched employee"
            let locations = workplaceLabels(check, workplaces: workplaces)
            var requirements: [String] = []
            var problem: String?
            do {
                guard !occupied else { throw appError("Another ReAI salary payment already exists for this month.") }
                try validateSource(check, period: period)
                guard let candidate, let email = candidate.contactEmail, !title.isEmpty else {
                    throw appError("The RecMan employee has no usable identity.")
                }
                let matches = existing.filter {
                    $0.name.caseInsensitiveCompare(title) == .orderedSame ||
                        $0.email?.caseInsensitiveCompare(email) == .orderedSame
                }
                guard matches.count == 1, let match = matches.first,
                      match.name.caseInsensitiveCompare(title) == .orderedSame,
                      match.email?.caseInsensitiveCompare(email) == .orderedSame else {
                    throw appError("Match this employee in ReAI through the Employees view.")
                }
                let employee: PayrollEmployee
                if let saved = employeeDetails[match.id] {
                    employee = saved
                } else {
                    employee = try await target.read("/api/employees/\(match.id)")
                    employeeDetails[match.id] = employee
                }
                guard normalizedIdentity(employee.bankAccount?.accountNumber) != nil else {
                    throw appError("This employee needs verified bank details in ReAI.")
                }
                let lines = check.lines.values
                guard let start = lines.map(\.startDate).min(), let end = lines.map(\.endDate).max(),
                      let municipality = employee.municipality(on: start, through: end) else {
                    throw appError("Verify the workplace and set the municipality on the ReAI employment relation.")
                }
                let locationMapping = "municipality-\(rowID)"
                requirements.append(locationMapping)
                mappings[locationMapping] = AccountingMapping(
                    id: locationMapping, label: "\(title) · paycheck \(check.paycheckId)\n\(locations)",
                    options: [AccountingOption(id: municipality, label: "All work verified in municipality \(municipality)")],
                    suggestion: nil
                )
                for line in lines {
                    let article = articleKey(line)
                    requirements.append(article)
                    if mappings[article] == nil {
                        mappings[article] = AccountingMapping(id: article,
                            label: "\(line.articleName) · \(line.articleType) · article \(line.articleId)",
                            options: Self.wageCodes.sorted().map {
                                AccountingOption(id: $0, label: $0.replacingOccurrences(of: "_", with: " ").capitalized)
                            }, suggestion: nil)
                    }
                }
                entries[rowID] = PayrollEntry(check: check, employee: employee, municipality: municipality)
            } catch let error as AppError {
                problem = error.message
            }
            let total = check.lines.values.reduce(Decimal(0)) { $0 + $1.total }
            rows.append(AccountingRow(id: rowID, title: title,
                                      detail: "Paycheck \(check.paycheckId) · \(check.lines.values.count) wage lines · NOK \(total)\n\(locations)",
                                      requirements: Array(Set(requirements)).sorted(), problem: problem,
                                      lineDetails: check.lines.values.map {
                                          "\($0.articleName) · \($0.startDate) to \($0.endDate) · \($0.qty) × NOK \($0.amount)"
                                      }))
        }
        return PayrollBatch(rows: rows, mappings: mappings.values.sorted { $0.label < $1.label }, entries: entries,
                            checks: checks, period: period, paymentDate: paymentDate)
    }

    func perform(_ batch: PayrollBatch, selection: Set<String>, choices: [String: String]) async throws -> String {
        let journal = try target.journal()
        let rows = batch.rows.filter { selection.contains($0.id) }
        guard !rows.isEmpty, rows.count == selection.count else { throw appError("Select the paychecks to import.") }
        try validateChoices(rows, mappings: batch.mappings, choices: choices)
        let entries = rows.compactMap { batch.entries[$0.id] }
        guard entries.count == rows.count else { throw appError("The selected payroll rows are no longer valid.") }

        var verifiedEmployees = Set<Int>()
        for entry in entries {
            guard journal.result(for: receipt(entry.check)) == nil else { throw appError("A paycheck was already imported.") }
            if verifiedEmployees.insert(entry.employee.id).inserted {
                let live: PayrollEmployee = try await target.read("/api/employees/\(entry.employee.id)")
                guard live == entry.employee else { throw appError("Employee details changed in ReAI. Reload the preview.") }
            }
        }

        let knownDraft = journal.result(for: draftKey(batch.period))
        let runs = try await salaryRuns(period: batch.period)
        guard !runs.contains(where: { $0.id != knownDraft }) else {
            throw appError("Another ReAI salary payment already exists for this month.")
        }
        let selectedEmployeeIDs = Set(entries.map(\.employee.id))
        let employeeIDs: Set<Int>
        var currentDraft: PayrollDraft
        if let knownDraft {
            currentDraft = try await target.read("/api/salary-payments/\(knownDraft)")
            employeeIDs = Set(currentDraft.employees.map(\.employeeId))
            guard selectedEmployeeIDs.isSubset(of: employeeIDs) else {
                throw appError("The draft does not contain all selected employees. Add them in ReAI before importing.")
            }
            try validateDraft(currentDraft, employees: employeeIDs, paymentDate: batch.paymentDate, journal: journal)
        } else {
            employeeIDs = selectedEmployeeIDs
            let key = draftKey(batch.period)
            let created: PayrollRunSummary = try await target.write("/api/salary-payments", fields: [
                "period": batch.period, "paymentDate": batch.paymentDate, "employeeIds": employeeIDs.sorted()
            ], key: key, journal: journal)
            currentDraft = try await target.read("/api/salary-payments/\(created.id)")
            try validateDraft(currentDraft, employees: employeeIDs, paymentDate: batch.paymentDate, journal: journal)
            try journal.complete(key, id: currentDraft.id)
        }

        let salaryID = currentDraft.id
        var importedLines = 0
        for entry in entries {
            for line in entry.check.lines.values {
                guard let code = choices[articleKey(line)] else { throw appError("A wage type is missing.") }
                let key = "\(receipt(entry.check))-line-\(line.paycheckLineId)"
                if let priorID = journal.result(for: key) {
                    guard let payee = currentDraft.employees.first(where: { $0.employeeId == entry.employee.id }),
                          payee.wageSpecs.contains(where: {
                              $0.id == priorID && $0.comment == key && $0.specificationCode == code &&
                                  $0.quantity == line.qty && $0.rate == line.amount
                          }) else {
                        throw appError("A previously imported wage line differs from the reviewed draft.")
                    }
                    continue
                }
                let draft: PayrollDraft = try await target.write("/api/salary-payments/\(salaryID)/wage-specs", fields: [
                    "employeeId": entry.employee.id, "specificationCode": code, "quantity": decimalJSON(line.qty),
                    "rate": decimalJSON(line.amount), "comment": key
                ], key: key, journal: journal)
                try validateDraft(draft, employees: employeeIDs, paymentDate: batch.paymentDate, journal: journal, adding: key)
                let wages = draft.employees.first { $0.employeeId == entry.employee.id }?.wageSpecs ?? []
                let matches = wages.filter { $0.comment == key && $0.specificationCode == code &&
                    $0.quantity == line.qty && $0.rate == line.amount }
                guard matches.count == 1, let wage = matches.first else {
                    throw appError("ReAI did not return the reviewed wage line.")
                }
                try journal.complete(key, id: wage.id)
                currentDraft = draft
                importedLines += 1
            }
            try journal.advanceCheckpoint(receipt(entry.check), through: salaryID)
        }

        let contiguous = batch.checks.sorted { $0.paycheckId < $1.paycheckId }.prefix {
            !relevant($0, period: batch.period) || journal.result(for: receipt($0)) != nil
        }
        if let last = contiguous.last { try journal.advanceCheckpoint(checkpoint(batch.period), through: last.paycheckId) }
        return "Added \(importedLines) wage lines to ReAI draft payroll for \(batch.period)."
    }

    private struct Workplace {
        let candidateID: Int
        let label: String
    }

    private func loadWorkplaces(for checks: [RecManPaycheck]) async throws -> [Int: Workplace] {
        let workIDs = Set(checks.flatMap { $0.lines.values.compactMap(\.workId).filter { $0 > 0 } }).sorted()
        guard !workIDs.isEmpty else { return [:] }
        guard workIDs.count <= 1_500 else { throw appError("Too many linked work entries for one payroll preview.") }
        let projects = try await source.projects(key: key)
        let companies = try await source.companies(key: key)
        var result: [Int: Workplace] = [:]
        for offset in stride(from: 0, to: workIDs.count, by: 100) {
            let ids = workIDs[offset..<min(workIDs.count, offset + 100)]
            let rows: [RecManWork] = try await source.fetchAll("work", key: key, parameters: [
                "workIds": ids.map(String.init).joined(separator: ",")
            ], maxPages: 2)
            for work in rows where ids.contains(work.workId) {
                let project = projects.first { $0.projectId == work.projectId }
                let company = companies.first { Int($0.companyId) == project?.companyId }
                let projectName = project?.name ?? (work.projectId > 0 ? "Project \(work.projectId)" : "Job \(work.jobId)")
                let address = normalizedIdentity(company?.visitAddress?.label)
                let parts = [projectName, company?.name, address].compactMap(normalizedIdentity)
                result[work.workId] = Workplace(candidateID: work.candidateId, label: parts.joined(separator: " · "))
            }
        }
        return result
    }

    private func workplaceLabels(_ check: RecManPaycheck, workplaces: [Int: Workplace]) -> String {
        let ids = Set(check.lines.values.compactMap(\.workId).filter { $0 > 0 })
        let resolved = ids.compactMap { workplaces[$0] }.filter { $0.candidateID == check.candidateId }
        let locations = Set(resolved.map(\.label)).sorted()
        let details = locations.prefix(3).joined(separator: "\n")
        if locations.isEmpty { return "No linked workplace resolved. Verify the workplace in RecMan." }
        if locations.count > 3 || resolved.count < ids.count {
            return "\(details)\nAdditional or unresolved workplaces. Check RecMan before confirming."
        }
        return details
    }

    private func salaryRuns(period: String) async throws -> [PayrollRunSummary] {
        try await target.read("/api/salary-payments", query: [
            URLQueryItem(name: "startDate", value: period + "-01"), URLQueryItem(name: "endDate", value: period + "-01")
        ])
    }

    private func relevant(_ check: RecManPaycheck, period: String) -> Bool {
        check.lines.values.contains { line in
            let start = String(line.startDate.prefix(7))
            let end = String(line.endDate.prefix(7))
            return start == period || end == period || (start < period && end > period)
        }
    }

    private func validateSource(_ check: RecManPaycheck, period: String) throws {
        let lines = check.lines.values
        guard !lines.isEmpty, Set(lines.map(\.paycheckLineId)).count == lines.count,
              Set(lines.map(\.employmentId)).count == 1 else {
            throw appError("Multiple employments or repeated lines require manual review.")
        }
        for line in lines {
            guard line.paycheckLineId > 0, line.articleId > 0, line.employmentId > 0,
                  accountingDate(line.startDate), accountingDate(line.endDate),
                  line.startDate <= line.endDate, line.startDate.hasPrefix(period), line.endDate.hasPrefix(period),
                  line.qty > 0, line.amount >= 0, roundedMoney(line.qty * line.amount) == line.total else {
                throw appError("A wage line has unsupported dates or amounts. Review it in RecMan.")
            }
        }
    }

    private func validateDraft(_ draft: PayrollDraft, employees: Set<Int>, paymentDate: String,
                               journal: Journal, adding key: String? = nil) throws {
        guard draft.status == "under_process", !draft.imported, draft.voucherId == nil,
              draft.paymentDate == paymentDate, Set(draft.employees.map(\.employeeId)) == employees else {
            throw appError("ReAI payroll no longer matches the selected draft and employees.")
        }
        for payee in draft.employees {
            for wage in payee.wageSpecs {
                guard let comment = wage.comment, comment == key || journal.result(for: comment) == wage.id else {
                    throw appError("The draft contains a wage line outside this import. Review it in ReAI.")
                }
            }
        }
    }

    private func checkpoint(_ period: String) -> String {
        "checkpoint-\(RecManState.fingerprint(key))-paycheck-\(period)"
    }
    private func draftKey(_ period: String) -> String { "payroll-draft-\(period)" }
    private func receipt(_ check: RecManPaycheck) -> String { "paycheck-\(check.departmentId)-\(check.paycheckId)" }
    private func articleKey(_ line: RecManPaycheck.Line) -> String { "wage-\(line.articleType)-\(line.articleId)" }
}
