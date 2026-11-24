import Foundation

private struct PayrollRunSummary: Decodable, Sendable {
    let id: Int
    let status: String
    let periodYear: Int
    let periodMonth: Int

    var period: String { String(format: "%04d-%02d", periodYear, periodMonth) }
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

private struct PayrollEntry {
    let check: RecManPaycheck
    let period: String
    let paymentDate: String
    let municipalityMapping: String
    let bankToImport: String?
}

struct PayrollImportApproval {
    let rows: [AccountingRow]
    let employeeSetup: [Int: EmployeePayrollSetup]
    let heldCount: Int
}

struct PayrollBatch {
    let rows: [AccountingRow]
    let mappings: [AccountingMapping]
    fileprivate let entries: [String: PayrollEntry]
    fileprivate let checks: [RecManPaycheck]
    fileprivate let municipalityMappingIDs: [Int: String]

    func approval(choices: [String: String], confirmedNOK: Bool) -> PayrollImportApproval {
        let mappingsByID = Dictionary(uniqueKeysWithValues: mappings.map { ($0.id, $0) })
        let ready = confirmedNOK ? rows.filter { row in
            row.problem == nil && row.requirements.allSatisfy { mappingsByID[$0]?.accepts(choices[$0]) == true }
        } : []
        var setup: [Int: EmployeePayrollSetup] = [:]
        for (id, mappingID) in municipalityMappingIDs {
            guard let code = choices[mappingID], mappingsByID[mappingID]?.accepts(code) == true else { continue }
            setup[id] = EmployeePayrollSetup(municipality: code)
        }
        return PayrollImportApproval(rows: ready, employeeSetup: setup, heldCount: rows.count - ready.count)
    }
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

    func load(employeePreview: ImportPreview, selection: Set<Int>) async throws -> PayrollBatch {
        guard !selection.isEmpty, selection.isSubset(of: employeePreview.selectableEmployeeIDs),
              target.tenant.currencyCode == "NOK" else {
            throw appError("Select employees for an NOK ReAI company.")
        }
        let journal = try target.journal()
        let minID = journal.result(for: checkpoint)
        var parameters = ["exported": "0"]
        if let minID { parameters["minPaycheckId"] = String(minID) }
        let loaded: [RecManPaycheck] = try await source.fetchAll("paycheck", key: key, parameters: parameters)
        let checks = loaded.filter { $0.paycheckId > (minID ?? 0) }
        guard checks.allSatisfy({ $0.paycheckId > 0 }), Set(checks.map(\.paycheckId)).count == checks.count else {
            throw appError("RecMan returned conflicting paycheck IDs.")
        }
        let pending = checks.filter { selection.contains($0.candidateId) && journal.result(for: receipt($0)) == nil }
        guard !pending.isEmpty else {
            return PayrollBatch(rows: [], mappings: [], entries: [:], checks: checks, municipalityMappingIDs: [:])
        }

        struct SalarySettings: Decodable { let payoutDayOfMonth: Int? }
        let settings: SalarySettings = try await target.read("/api/salary-settings")
        let periods = Set(pending.compactMap { payrollPeriod($0) }).sorted()
        let runs = try await salaryRuns(periods: periods)
        let runsByPeriod = Dictionary(grouping: runs, by: \.period)
        let workplaces = try await loadWorkplaces(for: pending)
        let municipalityMatches = await workplaceMunicipalities(for: pending, workplaces: workplaces)
        let candidates = Dictionary(uniqueKeysWithValues: employeePreview.source.compactMap { candidate in
            candidate.candidateId.positiveID.map { ($0, candidate) }
        })
        var entries: [String: PayrollEntry] = [:]
        var mappings: [String: AccountingMapping] = [:]
        var municipalityMappingIDs: [Int: String] = [:]
        var rows: [AccountingRow] = []
        var drafts: [Int: PayrollDraft] = [:]
        for check in pending.sorted(by: { $0.paycheckId < $1.paycheckId }) {
            guard let plan = employeePreview.plans[check.candidateId] else { continue }
            let rowID = receipt(check)
            let locations = workplaceLabels(check, workplaces: workplaces)
            let period = payrollPeriod(check)
            var paymentDate: String?
            var requirements: [String] = []
            var problem: String?
            do {
                guard let period else { throw appError("The wage lines do not identify a single payroll month.") }
                let knownID = journal.result(for: draftKey(period))
                let monthRuns = runsByPeriod[period] ?? []
                guard !monthRuns.contains(where: { $0.id != knownID || $0.status != "under_process" }) else {
                    throw appError("A separate or finalized ReAI salary payment already exists for \(period).")
                }
                try validateSource(check, period: period)
                if let knownID {
                    let draft: PayrollDraft
                    if let cached = drafts[knownID] {
                        draft = cached
                    } else {
                        draft = try await target.read("/api/salary-payments/\(knownID)")
                        drafts[knownID] = draft
                    }
                    guard let employee = plan.existing, draft.employees.contains(where: { $0.employeeId == employee.id }),
                          let date = draft.paymentDate else {
                        throw appError("The existing ReAI draft must already include this employee and have a payment date.")
                    }
                    try validateDraft(draft, employees: Set(draft.employees.map(\.employeeId)), paymentDate: date, journal: journal)
                    paymentDate = date
                } else {
                    paymentDate = try draftPaymentDate(period: period, payoutDay: settings.payoutDayOfMonth)
                }
                guard let paymentDate else { throw appError("The draft payment date could not be determined.") }

                let lines = check.lines.values
                guard let start = lines.map(\.startDate).min(), let end = lines.map(\.endDate).max(),
                      plan.startDate <= start, plan.endDate.map({ $0 >= end }) ?? true,
                      let employment = candidates[check.candidateId]?.employment?.first,
                      employment.employmentId?.positiveID == lines.first?.employmentId else {
                    throw appError("The wage dates or employment ID do not match the selected employee.")
                }

                let needsMunicipality = plan.existing?.employmentRelations.isEmpty != false ||
                    plan.existing?.lineMissingMunicipality != nil
                let matches = municipalityMatches[check.candidateId] ?? []
                let locationMapping: String
                if needsMunicipality {
                    if matches.count > 1 {
                        let places = matches.map(\.label).joined(separator: ", ")
                        let blockers = [
                            plan.bankIssue,
                            "Workplace addresses span \(places). Verify the applicable employment municipality in ReAI."
                        ].compactMap { $0 }
                        throw appError(blockers.joined(separator: "\n"))
                    }
                    locationMapping = "municipality-employee-\(check.candidateId)"
                    municipalityMappingIDs[check.candidateId] = locationMapping
                    mappings[locationMapping] = AccountingMapping(
                        id: locationMapping,
                        label: "\(plan.name) · Confirm the workplace municipality",
                        options: [], suggestion: nil, municipalityInput: true,
                        municipalitySuggestion: matches.first
                    )
                } else {
                    guard let municipality = plan.existing?.municipality(on: start, through: end) else {
                        throw appError("Verify the workplace and set the municipality on the ReAI employment relation.")
                    }
                    locationMapping = "municipality-\(rowID)"
                    let verified = matches.count == 1 && matches.first?.id == municipality
                    let label = verified ? "Saved municipality matches workplace" : "All work verified in municipality \(municipality)"
                    mappings[locationMapping] = AccountingMapping(
                        id: locationMapping, label: "\(plan.name) · Paycheck \(check.paycheckId) · \(period)",
                        options: [AccountingOption(id: municipality, label: label)],
                        suggestion: verified ? municipality : nil
                    )
                }
                let unsupported = Set(lines.filter(isWorkedTimeSupplement).map(\.articleName)).sorted()
                var blockers = [plan.bankIssue].compactMap { $0 }
                if !unsupported.isEmpty {
                    let articles = unsupported.joined(separator: ", ")
                    blockers.append("ReAI has no wage type for these shift additions (\(articles)). This paycheck needs ReAI support for irregular supplements for time worked.")
                }
                if !blockers.isEmpty { throw appError(blockers.joined(separator: "\n")) }
                requirements.append(locationMapping)
                for line in lines {
                    let article = articleKey(line)
                    requirements.append(article)
                    if mappings[article] == nil {
                        mappings[article] = AccountingMapping(id: article,
                            label: "\(line.articleName) · \(line.articleType) · Article \(line.articleId)",
                            options: Self.wageCodes.sorted().map {
                                AccountingOption(id: $0, label: $0.replacingOccurrences(of: "_", with: " ").capitalized)
                            }, suggestion: suggestedWageCode(for: line))
                    }
                }
                entries[rowID] = PayrollEntry(check: check, period: period, paymentDate: paymentDate,
                                              municipalityMapping: locationMapping, bankToImport: plan.bankToImport)
            } catch let error as AppError {
                problem = error.message
            }
            let total = check.lines.values.reduce(Decimal(0)) { $0 + $1.total }
            let dateDetails = paymentDate.map { " · Draft payment date \($0)" } ?? ""
            rows.append(AccountingRow(id: rowID, title: plan.name,
                                      detail: "\(period ?? "Unknown payroll month") · Paycheck \(check.paycheckId) · NOK \(total)\(dateDetails)\n\(locations)",
                                      requirements: Array(Set(requirements)).sorted(), problem: problem,
                                      lineDetails: check.lines.values.map {
                                          "\($0.articleName) · \($0.startDate) to \($0.endDate) · \($0.qty) × NOK \($0.amount)"
                                      }))
        }
        return PayrollBatch(rows: rows, mappings: mappings.values.sorted { $0.label < $1.label }, entries: entries,
                            checks: checks, municipalityMappingIDs: municipalityMappingIDs)
    }

    func perform(_ batch: PayrollBatch, approval: PayrollImportApproval, choices: [String: String],
                 employees: [Int: Employee]) async throws -> String {
        let journal = try target.journal()
        try validateChoices(approval.rows, mappings: batch.mappings, choices: choices)
        let entries = approval.rows.compactMap { batch.entries[$0.id] }
        guard entries.count == approval.rows.count else { throw appError("A selected payroll preview is missing.") }

        var verifiedEmployees: [Int: Employee] = [:]
        for entry in entries {
            let id = entry.check.candidateId
            guard let imported = employees[id], journal.result(for: receipt(entry.check)) == nil else {
                throw appError("An employee or paycheck changed. Reload the preview.")
            }
            let live: Employee
            if let saved = verifiedEmployees[id] {
                live = saved
            } else {
                live = try await target.read("/api/employees/\(imported.id)")
                guard live == imported else { throw appError("Employee details changed after the employee import.") }
                verifiedEmployees[id] = live
            }
            let lines = entry.check.lines.values
            guard let start = lines.map(\.startDate).min(), let end = lines.map(\.endDate).max(),
                  let municipality = choices[entry.municipalityMapping],
                  live.municipality(on: start, through: end) == municipality,
                  live.hasBankAccount else {
                throw appError("ReAI did not verify the bank details and municipality for \(live.name).")
            }
            if let expected = entry.bankToImport, live.bankAccount?.matchesNorwegianAccount(expected) != true {
                throw appError("ReAI did not verify the reviewed bank account for \(live.name).")
            }
        }

        let byPeriod = Dictionary(grouping: entries, by: \.period)
        var completed: [String] = []
        for period in byPeriod.keys.sorted() {
            guard let month = byPeriod[period], let paymentDate = month.first?.paymentDate,
                  month.allSatisfy({ $0.paymentDate == paymentDate }) else { throw appError("Draft payment dates conflict.") }
            do {
                let count = try await writeMonth(month, period: period, paymentDate: paymentDate, choices: choices,
                                                 employees: verifiedEmployees, journal: journal)
                completed.append("\(period) · \(count) wage lines")
            } catch {
                throw appError(([error.localizedDescription] + completed).joined(separator: "\n"))
            }
        }
        let contiguous = batch.checks.sorted { $0.paycheckId < $1.paycheckId }.prefix {
            journal.result(for: receipt($0)) != nil
        }
        if let last = contiguous.last { try journal.advanceCheckpoint(checkpoint, through: last.paycheckId) }
        if completed.isEmpty { return "" }
        return "Draft payroll updated in ReAI.\n" + completed.joined(separator: "\n")
    }

    private func writeMonth(_ entries: [PayrollEntry], period: String, paymentDate: String,
                            choices: [String: String], employees: [Int: Employee], journal: Journal) async throws -> Int {
        let knownDraft = journal.result(for: draftKey(period))
        let runs = try await salaryRuns(periods: [period])
        guard !runs.contains(where: { $0.id != knownDraft }) else {
            throw appError("Another ReAI salary payment already exists for this month.")
        }
        let selectedEmployeeIDs = Set(entries.compactMap { employees[$0.check.candidateId]?.id })
        let employeeIDs: Set<Int>
        var currentDraft: PayrollDraft
        if let knownDraft {
            currentDraft = try await target.read("/api/salary-payments/\(knownDraft)")
            employeeIDs = Set(currentDraft.employees.map(\.employeeId))
            guard selectedEmployeeIDs.isSubset(of: employeeIDs) else {
                throw appError("The draft does not contain all selected employees. Add them in ReAI before importing.")
            }
            try validateDraft(currentDraft, employees: employeeIDs, paymentDate: paymentDate, journal: journal)
        } else {
            employeeIDs = selectedEmployeeIDs
            let key = draftKey(period)
            let created: PayrollRunSummary = try await target.write("/api/salary-payments", fields: [
                "period": period, "paymentDate": paymentDate, "employeeIds": employeeIDs.sorted()
            ], key: key, journal: journal)
            currentDraft = try await target.read("/api/salary-payments/\(created.id)")
            try validateDraft(currentDraft, employees: employeeIDs, paymentDate: paymentDate, journal: journal)
            try journal.complete(key, id: currentDraft.id)
        }

        let salaryID = currentDraft.id
        var importedLines = 0
        for entry in entries {
            guard let employee = employees[entry.check.candidateId] else { throw appError("An employee match is missing.") }
            for line in entry.check.lines.values {
                guard let code = choices[articleKey(line)] else { throw appError("A wage type is missing.") }
                let key = "\(receipt(entry.check))-line-\(line.paycheckLineId)"
                if let priorID = journal.result(for: key) {
                    guard let payee = currentDraft.employees.first(where: { $0.employeeId == employee.id }),
                          payee.wageSpecs.contains(where: {
                              $0.id == priorID && $0.comment == key && $0.specificationCode == code &&
                                  $0.quantity == line.qty && $0.rate == line.amount
                          }) else {
                        throw appError("A previously imported wage line differs from the reviewed draft.")
                    }
                    continue
                }
                let draft: PayrollDraft = try await target.write("/api/salary-payments/\(salaryID)/wage-specs", fields: [
                    "employeeId": employee.id, "specificationCode": code, "quantity": decimalJSON(line.qty),
                    "rate": decimalJSON(line.amount), "comment": key
                ], key: key, journal: journal)
                try validateDraft(draft, employees: employeeIDs, paymentDate: paymentDate, journal: journal, adding: key)
                let wages = draft.employees.first { $0.employeeId == employee.id }?.wageSpecs ?? []
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

        return importedLines
    }

    private struct Workplace {
        let candidateID: Int
        let label: String
        let address: RecManCompany.Address?
    }

    private func workplaceMunicipalities(for checks: [RecManPaycheck],
                                        workplaces: [Int: Workplace]) async -> [Int: [AccountingOption]] {
        let addressesByEmployee = Dictionary(grouping: checks, by: \.candidateId).mapValues { paychecks in
            paychecks.map { check in
                let workIDs = Set(check.lines.values.compactMap(\.workId).filter { $0 > 0 })
                return workIDs.map { id in
                    guard let workplace = workplaces[id], workplace.candidateID == check.candidateId else { return nil as RecManCompany.Address? }
                    return workplace.address
                }
            }
        }
        let addresses = Set(addressesByEmployee.values.flatMap { $0.flatMap { $0.compactMap(\.self) } })
            .sorted { $0.label < $1.label }
        guard !addresses.isEmpty else { return [:] }
        let resolved = await WorkplaceMunicipalities.lookup(addresses)
        return addressesByEmployee.mapValues { paychecks in
            let matches = paychecks.flatMap { $0.compactMap { $0.flatMap { resolved[$0] } } }
            let distinct = Dictionary(grouping: matches, by: \.id).values.compactMap(\.first).sorted { $0.id < $1.id }
            if distinct.count > 1 { return distinct }
            let complete = paychecks.allSatisfy { !$0.isEmpty } && matches.count == paychecks.reduce(0) { $0 + $1.count }
            return complete ? distinct : []
        }
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
                result[work.workId] = Workplace(candidateID: work.candidateId,
                                                label: parts.joined(separator: " · "), address: company?.visitAddress)
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

    private func salaryRuns(periods: [String]) async throws -> [PayrollRunSummary] {
        guard let start = periods.first, let end = periods.last else { return [] }
        return try await target.read("/api/salary-payments", query: [
            URLQueryItem(name: "startDate", value: start + "-01"), URLQueryItem(name: "endDate", value: end + "-01")
        ])
    }

    private func payrollPeriod(_ check: RecManPaycheck) -> String? {
        let dates = check.lines.values.flatMap { [$0.startDate, $0.endDate] }
        guard !dates.isEmpty, dates.allSatisfy(accountingDate) else { return nil }
        let months = Set(dates.map { String($0.prefix(7)) })
        return months.count == 1 ? months.first : nil
    }

    private func suggestedWageCode(for line: RecManPaycheck.Line) -> String? {
        let name = line.articleName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard line.articleType.caseInsensitiveCompare("hour") == .orderedSame,
              ["timelønn", "hourly salary"].contains(name) else { return nil }
        return "hourly_salary"
    }

    private func isWorkedTimeSupplement(_ line: RecManPaycheck.Line) -> Bool {
        guard line.articleType.caseInsensitiveCompare("hourAddition") == .orderedSame else { return false }
        let name = line.articleName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return ["kveldstillegg", "nattillegg", "helgetillegg"].contains(name)
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

    private var checkpoint: String { "checkpoint-\(RecManState.fingerprint(key))-selected-paychecks" }
    private func draftKey(_ period: String) -> String { "payroll-draft-\(period)" }
    private func receipt(_ check: RecManPaycheck) -> String { "paycheck-\(check.departmentId)-\(check.paycheckId)" }
    private func articleKey(_ line: RecManPaycheck.Line) -> String { "wage-\(line.articleType)-\(line.articleId)" }
}

func verifiedNorwegianAccount(_ value: String?) -> String? {
    guard let value else { return nil }
    let account = value.filter { $0 != "." && !$0.isWhitespace }
    guard account.range(of: #"^[0-9]{11}$"#, options: .regularExpression) != nil,
          account.contains(where: { $0 != "0" }) else { return nil }
    let digits = account.compactMap(\.wholeNumberValue)
    let sum = zip(digits, [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]).reduce(0) { $0 + $1.0 * $1.1 }
    return digits.last == (11 - sum % 11) % 11 ? account : nil
}

func verifiedNorwegianIBAN(_ value: String?) -> String? {
    guard let value else { return nil }
    let iban = value.filter { !$0.isWhitespace }.uppercased()
    guard iban.range(of: #"^NO[0-9]{13}$"#, options: .regularExpression) != nil else { return nil }
    let digits = String(iban.dropFirst(4)) + "2324" + String(iban.dropFirst(2).prefix(2))
    let remainder = digits.compactMap(\.wholeNumberValue).reduce(0) { ($0 * 10 + $1) % 97 }
    guard remainder == 1 else { return nil }
    return verifiedNorwegianAccount(String(iban.dropFirst(4)))
}

private func draftPaymentDate(period: String, payoutDay: Int?) throws -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Oslo")!
    let parts = period.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2, let month = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: 1)) else {
        throw appError("The payroll month is invalid.")
    }
    let preferred = payoutDay ?? 31
    guard (1...31).contains(preferred),
          let payoutMonth = calendar.date(byAdding: .month, value: preferred <= 10 ? 1 : 0, to: month),
          let days = calendar.range(of: .day, in: .month, for: payoutMonth),
          let date = calendar.date(byAdding: .day, value: min(preferred, days.count) - 1, to: payoutMonth) else {
        throw appError("The ReAI payout schedule is invalid.")
    }
    guard payoutDay == 31 else { return osloDate(date) }
    let easter = norwegianEaster(year: calendar.component(.year, from: date), calendar: calendar)
    let holidays = Set([-3, -2, 1, 39, 50].compactMap { offset in
        easter.flatMap { calendar.date(byAdding: .day, value: offset, to: $0) }
    })
    var candidate = date
    while calendar.isDateInWeekend(candidate) || holidays.contains(candidate) ||
            ["01-01", "05-01", "05-17", "12-24", "12-25", "12-26"].contains(String(osloDate(candidate).suffix(5))) {
        guard let previous = calendar.date(byAdding: .day, value: -1, to: candidate) else {
            throw appError("The draft payment date could not be determined.")
        }
        candidate = previous
    }
    return osloDate(candidate)
}

private func norwegianEaster(year: Int, calendar: Calendar) -> Date? {
    let goldenNumber = year % 19
    let century = year / 100
    let yearWithinCentury = year % 100
    let solarCorrection = (century + 8) / 25
    let lunarCorrection = (century - solarCorrection + 1) / 3
    let epact = (19 * goldenNumber + century - century / 4 - lunarCorrection + 15) % 30
    let weekday = (32 + 2 * (century % 4) + 2 * (yearWithinCentury / 4) - epact - yearWithinCentury % 4) % 7
    let correction = (goldenNumber + 11 * epact + 22 * weekday) / 451
    let date = epact + weekday - 7 * correction + 114
    return calendar.date(from: DateComponents(year: year, month: date / 31, day: date % 31 + 1))
}
