import Foundation

actor ImportValidator {
    func prepare(rows: [[String]], headerRow: Int, mapping: [String], kind: ImportKind, decimalComma: Bool,
                 privatePeople: Bool, existing: Set<String>) throws -> [ImportRow] {
        let fields = Fields.forKind(kind)
        let assigned = mapping.filter { !$0.isEmpty }
        guard Set(assigned).count == assigned.count else { throw appError("A ReAI field is mapped more than once. Choose one source column for each field.") }
        let missing = fields.filter { $0.required && !assigned.contains($0.id) }
        guard missing.isEmpty else { throw appError("Map these required fields: " + missing.map(\.title).joined(separator: ", ") + ".") }
        guard rows.indices.contains(headerRow), rows.count > headerRow + 1 else { throw appError("The selected header row has no data below it.") }
        var seen = existing
        var result: [ImportRow] = []
        for index in (headerRow + 1)..<rows.count {
            let cells = rows[index]
            if cells.allSatisfy({ $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) { continue }
            var values: [String: String] = [:]
            for (column, field) in mapping.enumerated() where !field.isEmpty {
                values[field] = column < cells.count ? cells[column].trimmingCharacters(in: .whitespacesAndNewlines) : ""
            }
            let name = values[kind == .products ? "title" : "name"] ?? ""
            var messages: [String] = []
            if cells.count > mapping.count, cells.dropFirst(mapping.count).contains(where: { !$0.isEmpty }) {
                messages.append("More values than header columns. Check the file delimiter or header row.")
            }
            var payload: [String: Any] = [:]
            for field in fields {
                let value = values[field.id] ?? ""
                if value.isEmpty {
                    if field.required { messages.append("\(field.title) is required.") }
                    continue
                }
                switch field.type {
                case .text: payload[field.id] = value
                case .decimal:
                    if let number = Self.decimal(value, comma: decimalComma), number >= 0 {
                        payload[field.id] = NSDecimalNumber(decimal: number)
                    } else { messages.append("\(field.title): use a non-negative number with a \(decimalComma ? "comma" : "dot") decimal separator.") }
                case .integer:
                    if let number = Int(value), (0...3000).contains(number) { payload[field.id] = number }
                    else { messages.append("\(field.title): use a whole number between 0 and 3000.") }
                case .boolean:
                    if let boolean = Self.boolean(value) { payload[field.id] = boolean }
                    else { messages.append("\(field.title): use yes/no, true/false or 1/0.") }
                }
            }
            if kind == .products {
                if let brand = values["brand"], brand.count > 255 { messages.append("Brand exceeds 255 characters.") }
                if let account = values["revenueAccountCode"], !account.isEmpty, account.range(of: "^3[0-9]{3}$", options: .regularExpression) == nil {
                    messages.append("Revenue account must be a four-digit 3xxx account.")
                }
                if let vat = values["vatCode"], !vat.isEmpty, vat.range(of: "^[0-9]+$", options: .regularExpression) == nil {
                    messages.append("Use a ReAI VAT code, not a percentage.")
                }
                payload["stockItem"] = payload["stockItem"] ?? true
                var variant: [String: Any] = [:]
                for key in ["sku", "sellingPrice", "costPrice", "barcode"] { variant[key] = payload.removeValue(forKey: key) }
                payload["variants"] = [variant]
            } else {
                let country = (values["countryCode"].flatMap { $0.isEmpty ? nil : $0 } ?? "NO").uppercased()
                payload["countryCode"] = country; values["countryCode"] = country
                let privateContact = payload["privateContact"] as? Bool ?? privatePeople
                payload["privateContact"] = privateContact
                payload["skipRegistryLookup"] = true
                if name.count > 75 { messages.append("Name exceeds 75 characters.") }
                if (values["number"]?.count ?? 0) > 50 { messages.append("Contact number exceeds 50 characters.") }
                if country.range(of: "^[A-Z]{2}$", options: .regularExpression) == nil { messages.append("Country must be a two-letter code, such as NO or SE.") }
                let organization = (values["organizationNumber"] ?? "").replacingOccurrences(of: " ", with: "")
                if !privateContact && country == "NO" && !Self.norwegianOrganization(organization) { messages.append("Norwegian companies require a valid nine-digit organization number. For people, map Private person or change the default.") }
                if !organization.isEmpty { payload["organizationNumber"] = organization }
                if privateContact && !organization.isEmpty { messages.append("Private people must not have an organization number.") }
                if organization.count > 36 { messages.append("Organization number exceeds 36 characters.") }
                for key in ["email", "invoiceEmail"] {
                    if let email = values[key], !email.isEmpty, email.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) == nil { messages.append("\(key): enter a valid email address.") }
                }
                if let phone = values["phone"], !phone.isEmpty {
                    let normalized = phone.filter { !" ()-".contains($0) }
                    if normalized.range(of: "^\\+[1-9][0-9]{6,14}$", options: .regularExpression) == nil { messages.append("Phone requires +country code, for example +4799999999.") }
                    else { payload["phone"] = normalized }
                }
                let addressKeys = ["addressPart1", "addressPart2", "city", "postalCode", "province"]
                if addressKeys.contains(where: { !(values[$0] ?? "").isEmpty }), (values["addressPart1"] ?? "").isEmpty || (values["city"] ?? "").isEmpty {
                    messages.append("An address requires both address line 1 and city.")
                }
            }
            let keys = Self.keys(values, kind: kind)
            let duplicate = !keys.isDisjoint(with: seen)
            if messages.isEmpty { seen.formUnion(keys) }
            let state: RowState = !messages.isEmpty ? .invalid : duplicate ? .skipped : .ready
            let detail = !messages.isEmpty ? messages.joined(separator: " ") : duplicate ? "Matches an existing record or an earlier row by SKU, contact number, name or email." : "Will create a new record."
            result.append(ImportRow(line: index + 1, name: name, fields: values, payload: messages.isEmpty ? try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) : nil, state: state, detail: detail))
        }
        guard !result.isEmpty else { throw appError("There are no data rows to import.") }
        return result
    }

    static func keys(_ values: [String: String], kind: ImportKind) -> Set<String> {
        Set((kind == .products ? ["sku"] : ["number", "name", "email"]).compactMap { key in
            guard let value = values[key], !value.isEmpty else { return nil }
            return key + ":" + value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        })
    }
    static func boolean(_ value: String) -> Bool? {
        switch value.lowercased() {
        case "true", "yes", "ja", "1": true
        case "false", "no", "nei", "0": false
        default: nil
        }
    }
    static func decimal(_ value: String, comma: Bool) -> Decimal? {
        let text = value.replacingOccurrences(of: "\u{00a0}", with: " ").replacingOccurrences(of: "\u{202f}", with: " ")
        let fraction = comma ? "," : "\\."
        let grouping = comma ? "\\." : ","
        let pattern = "^[+-]?(?:[0-9]+|[0-9]{1,3}(?:" + grouping + "[0-9]{3})+|[0-9]{1,3}(?: [0-9]{3})+)(?:" + fraction + "[0-9]{1,8})?$"
        guard text.range(of: pattern, options: .regularExpression) != nil else { return nil }
        let normalized = text.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: comma ? "." : ",", with: "").replacingOccurrences(of: ",", with: ".")
        guard let result = Decimal(string: normalized, locale: Locale(identifier: "en_US_POSIX")), !result.isNaN else { return nil }
        return result
    }
    static func norwegianOrganization(_ value: String) -> Bool {
        guard value.count == 9, value.allSatisfy({ $0.isASCII && $0.isNumber }) else { return false }
        let digits = value.compactMap(\.wholeNumberValue)
        let sum = zip(digits.prefix(8), [3, 2, 7, 6, 5, 4, 3, 2]).map(*).reduce(0, +)
        let check = (11 - sum % 11) % 11
        return check < 10 && check == digits[8] && digits.contains(where: { $0 != 0 })
    }
}
