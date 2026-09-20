import Foundation

enum Fields {
    static func forKind(_ kind: ImportKind) -> [Field] {
        if kind == .products {
            return [
                Field(id: "title", title: "Product name", aliases: ["name", "title", "product", "produktnavn", "varenavn", "navn", "beskrivelse kort"], required: true),
                Field(id: "sku", title: "SKU / product number", aliases: ["sku", "product number", "product code", "item number", "varenummer", "artikkelnummer", "produktnummer", "vare nr", "art nr"], required: true),
                Field(id: "sellingPrice", title: "Selling price (excluding VAT)", aliases: ["price", "selling price", "unit price", "pris", "salgspris", "enhetspris", "pris eks mva"], required: true, type: .decimal),
                Field(id: "costPrice", title: "Cost price", aliases: ["cost", "cost price", "kostpris", "innkjopspris"], type: .decimal),
                Field(id: "description", title: "Description", aliases: ["description", "beskrivelse", "produktbeskrivelse"]),
                Field(id: "brand", title: "Brand", aliases: ["brand", "merke", "merkevare"]),
                Field(id: "barcode", title: "Barcode", aliases: ["barcode", "ean", "gtin", "strekkode"]),
                Field(id: "stockItem", title: "Stock item", aliases: ["stock item", "stockitem", "lagervare"], type: .boolean),
                Field(id: "vatCode", title: "ReAI VAT code", aliases: ["vat code", "vatcode", "mva kode", "mvakode"]),
                Field(id: "revenueAccountCode", title: "Revenue account", aliases: ["revenue account", "revenueaccountcode", "inntektskonto", "salgskonto"])
            ]
        }
        var fields = [
            Field(id: "name", title: "Name", aliases: ["name", "company name", "customer name", "supplier name", "navn", "firmanavn", "kundenavn", "leverandornavn"], required: true),
            Field(id: "number", title: kind == .customers ? "Customer number" : "Supplier number", aliases: ["number", "customer number", "supplier number", "kundenummer", "leverandornummer", "kunde nr", "leverandor nr"]),
            Field(id: "organizationNumber", title: "Organization number", aliases: ["organization number", "organisation number", "organizationnumber", "company number", "org nr", "orgnr", "organisasjonsnummer"]),
            Field(id: "privateContact", title: "Private person", aliases: ["private contact", "privatecontact", "private person", "privatperson", "privatkunde"], type: .boolean),
            Field(id: "email", title: "Email", aliases: ["email", "e mail", "epost", "e post", "email address"]),
            Field(id: "phone", title: "Phone (+country code)", aliases: ["phone", "telephone", "mobile", "telefon", "mobil", "telefonnummer"]),
            Field(id: "countryCode", title: "Country code", aliases: ["country code", "countrycode", "landkode", "country", "land"]),
            Field(id: "addressPart1", title: "Address line 1", aliases: ["address", "address 1", "address line 1", "addresspart1", "street", "adresse", "adresse 1", "gateadresse"]),
            Field(id: "addressPart2", title: "Address line 2", aliases: ["address 2", "address line 2", "addresspart2", "adresse 2"]),
            Field(id: "postalCode", title: "Postal code", aliases: ["postal code", "postalcode", "zip", "zip code", "postnummer", "postnr"]),
            Field(id: "city", title: "City", aliases: ["city", "town", "poststed", "by"]),
            Field(id: "province", title: "Province / region", aliases: ["province", "region", "state", "fylke"]),
            Field(id: "bankAccountNumber", title: "Bank account number", aliases: ["bank account", "bankaccountnumber", "bank account number", "kontonummer", "bankkonto"]),
            Field(id: "iban", title: "IBAN", aliases: ["iban"]),
            Field(id: "swiftCode", title: "SWIFT / BIC", aliases: ["swift", "swiftcode", "bic", "swift bic"])
        ]
        if kind == .customers {
            fields += [
                Field(id: "invoiceEmail", title: "Invoice email", aliases: ["invoice email", "invoiceemail", "faktura epost", "fakturaepost"]),
                Field(id: "daysUntilDue", title: "Payment terms (days)", aliases: ["daysuntildue", "payment terms days", "payment days", "betalingsfrist", "kredittdager"], type: .integer),
                Field(id: "invoiceInEnglish", title: "Invoices in English", aliases: ["invoiceinenglish", "invoice in english", "engelsk faktura"], type: .boolean)
            ]
        }
        return fields
    }

    static func normalize(_ value: String) -> String {
        value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .replacingOccurrences(of: "ø", with: "o").replacingOccurrences(of: "æ", with: "ae")
            .filter { $0.isLetter || $0.isNumber }
    }

    static func match(_ headers: [String], kind: ImportKind) -> [String] {
        let fields = forKind(kind)
        return headers.map { header in
            let key = normalize(header)
            guard !key.isEmpty, key.count <= 200 else { return "" }
            let exact = fields.filter { field in ([field.id, field.title] + field.aliases).contains { normalize($0) == key } }
            if exact.count == 1 { return exact[0].id }
            guard exact.isEmpty, key.count >= 6 else { return "" }
            let near = fields.filter { field in
                field.aliases.contains { alias in
                    let candidate = normalize(alias)
                    return candidate.count >= 6 && distance(key, candidate) == 1
                }
            }
            return near.count == 1 ? near[0].id : ""
        }
    }

    private static func distance(_ a: String, _ b: String) -> Int {
        let x = Array(a), y = Array(b)
        var previous = Array(0...y.count)
        for (i, left) in x.enumerated() {
            var row = [i + 1]
            for (j, right) in y.enumerated() {
                row.append(min(row[j] + 1, previous[j + 1] + 1, previous[j] + (left == right ? 0 : 1)))
            }
            previous = row
        }
        return previous[y.count]
    }
}
