import Foundation

// MARK: Receipt snapshot from GET /api/kassasystem/sales

/// One fiscal receipt exactly as ReAI's public API returns it. Amounts are positive snapshots;
/// the receipt type decides the printed sign. Nothing here is recalculated.
struct Sale: Codable, Equatable, Identifiable, Sendable {
    let id: Int64
    let cashPointId: Int
    let sequenceNumber: Int64
    let receiptNumber: String
    let type: String
    let occurredAt: String
    let currencyCode: String?
    let netAmount: Decimal
    let vatAmount: Decimal
    let grossAmount: Decimal
    let discountAmount: Decimal
    let lines: [SaleLine]
    let payments: [SalePayment]
}

struct SaleLine: Codable, Equatable, Sendable {
    let rowNumber: Int
    let productText: String
    let vatCode: String
    let quantity: Decimal
    let netAmount: Decimal
    let vatAmount: Decimal
    let grossAmount: Decimal
    let discountAmount: Decimal
}

struct SalePayment: Codable, Equatable, Sendable {
    let method: String
    let amount: Decimal
    let reference: String?
}

/// Seller details from GET /api/company-settings.
struct Merchant: Codable, Equatable, Sendable {
    let name: String
    let organizationNumber: String?
    let vatRegistered: Bool
    /// AS, ASA and NUF must show «Foretaksregisteret» and their head office address (bokføringsforskriften § 5-1-2).
    let companyTypeCode: String?
    let address: [String]
}

struct ReceiptContext: Sendable {
    let tenantId: Int
    let merchant: Merchant
    /// Company currency from GET /api/me, used only when an older receipt has no snapshotted currency.
    let companyCurrency: String
    /// VAT code to display rate in percent, from GET /api/vat-codes.
    let vatRates: [String: Decimal]
    let columns: Int
    let printQRCode: Bool
}

enum ReceiptError: LocalizedError, Equatable {
    case unsupported(String)
    var errorDescription: String? {
        switch self { case .unsupported(let text): text }
    }
}

// MARK: Layout

enum Align: UInt8, Sendable { case left = 0, center = 1, right = 2 }

enum ReceiptElement: Equatable, Sendable {
    case text(String, align: Align = .left, bold: Bool = false, size: TextSize = .normal)
    case pair(String, String, bold: Bool = false)
    /// Right-aligned table row; the first column is left-aligned.
    case row([String], bold: Bool = false)
    case rule
    case feed
    case qr(String)
}

enum TextSize: UInt8, Sendable {
    case normal = 0x00
    case tall = 0x01
    /// Double width and height.
    case large = 0x11
    var widthFactor: Int { self == .large ? 2 : 1 }
}

enum ReceiptRenderer {
    static let oslo = TimeZone(identifier: "Europe/Oslo")!

    /// Statutory headings stay Norwegian (kassasystemforskriften § 2-8-4 and § 2-8-5). Other labels mirror ReAI's receipt PDF.
    static func title(_ type: String) -> String? {
        ["sale": "Salgskvittering", "return_receipt": "Returkvittering", "correction": "Korreksjonskvittering",
         "correction_reversal": "Reversering av korreksjon", "invoice_payment": "Fakturabetaling",
         "invoice_payment_reversal": "Reversering av fakturabetaling"][type]
    }

    static func sign(_ type: String) -> Decimal {
        ["return_receipt", "correction", "invoice_payment_reversal"].contains(type) ? -1 : 1
    }

    static func paymentMethod(_ method: String) -> String {
        ["payment_link": "Online payment", "card": "Card", "vipps": "Vipps", "cash": "Cash", "gift_card": "Gift card",
         "invoice_transfer": "Invoice transfer", "manual_correction": "Manual correction"][method] ?? method
    }

    static func hasCash(_ sale: Sale) -> Bool { sale.payments.contains { $0.method == "cash" } }

    /// Lays out one receipt in the content and order of ReAI's fiscal receipt PDF.
    static func render(_ sale: Sale, context: ReceiptContext) throws(ReceiptError) -> [ReceiptElement] {
        guard let title = title(sale.type) else { throw .unsupported("Receipt type \(sale.type) is not supported. Print it from ReAI.") }
        guard let date = parseInstant(sale.occurredAt) else { throw .unsupported("Receipt \(sale.receiptNumber) has an unreadable date.") }
        let merchant = context.merchant
        guard !merchant.name.trimmingCharacters(in: .whitespaces).isEmpty else {
            throw .unsupported("ReAI has no company name for this company.")
        }
        guard let organization = merchant.organizationNumber?.trimmingCharacters(in: .whitespaces), !organization.isEmpty else {
            throw .unsupported("ReAI has no organization number for this company.")
        }
        let invoicePayment = sale.type == "invoice_payment" || sale.type == "invoice_payment_reversal"
        var rates: [String: String] = [:]
        if !invoicePayment {
            for code in Set(sale.lines.map(\.vatCode)) {
                guard let rate = context.vatRates[code] else {
                    throw .unsupported("VAT code \(code) on receipt \(sale.receiptNumber) has no rate in ReAI's VAT code list.")
                }
                rates[code] = plain(rate) + "%"
            }
        }
        let currency = sale.currencyCode ?? context.companyCurrency
        let sign = sign(sale.type)
        func signed(_ amount: Decimal) -> String { money(amount * sign) }

        var out: [ReceiptElement] = []
        out.append(.text(title, align: .center, bold: true, size: .tall))
        out.append(.feed)

        out.append(.text(merchant.name, align: .center, bold: true))
        for line in merchant.address where !line.isEmpty { out.append(.text(line, align: .center)) }
        out.append(.text("Org. no. \(organization)" + (merchant.vatRegistered ? " MVA" : ""), align: .center))
        if let type = merchant.companyTypeCode?.uppercased(), ["AS", "ASA", "NUF"].contains(type) {
            out.append(.text("Foretaksregisteret", align: .center))
        }
        out.append(.feed)

        out.append(.pair("Receipt", sale.receiptNumber))
        out.append(.pair("Date/time", dateTime(date)))
        out.append(.feed)

        if sale.lines.isEmpty {
            out.append(.text("Control receipt without items or payment.", align: .center))
        } else {
            out.append(.pair("Item", "Amount", bold: true))
            out.append(.rule)
            for line in sale.lines {
                out.append(.text(line.productText))
                let vat = invoicePayment ? "-" : rates[line.vatCode]!
                out.append(.pair("  Qty \(plain(line.quantity)), VAT \(vat)", signed(line.grossAmount + line.discountAmount)))
                if line.discountAmount > 0 { out.append(.pair("  Discount", signed(-line.discountAmount))) }
            }
            out.append(.rule)
        }
        if sale.discountAmount > 0 { out.append(.pair("Total discount", signed(-sale.discountAmount), bold: true)) }
        if !invoicePayment {
            out.append(.pair("Subtotal excl. VAT", signed(sale.netAmount), bold: true))
            out.append(.pair("VAT", signed(sale.vatAmount), bold: true))
        }
        out.append(.pair("TOTAL \(currency)", signed(sale.grossAmount), bold: true))
        out.append(.feed)

        if !sale.payments.isEmpty {
            let returned = sale.type == "return_receipt"
            for payment in sale.payments {
                out.append(.pair("Payment method", paymentMethod(payment.method)))
                out.append(.pair(returned ? "Refunded" : "Paid", "\(currency) " + (returned ? money(payment.amount) : signed(payment.amount))))
                if let reference = payment.reference, !reference.isEmpty { out.append(.pair("Transaction ID", reference)) }
            }
            out.append(.feed)
        }

        if !sale.lines.isEmpty && !invoicePayment {
            out.append(.row(["VAT", "Net amount", "VAT amount"], bold: true))
            var groups: [(String, Decimal, Decimal)] = []
            for line in sale.lines {
                if let index = groups.firstIndex(where: { $0.0 == line.vatCode }) {
                    groups[index].1 += line.netAmount; groups[index].2 += line.vatAmount
                } else { groups.append((line.vatCode, line.netAmount, line.vatAmount)) }
            }
            for (code, net, vat) in groups {
                out.append(.row([rates[code]!, signed(net), signed(vat)]))
            }
            out.append(.feed)
        }

        out.append(.pair("Cash point ID", String(sale.cashPointId)))
        if sale.grossAmount == 0 {
            out.append(.feed)
            out.append(.text("Zero-amount receipt recorded in the electronic journal.", align: .center))
        }
        if context.printQRCode {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = oslo
            let day = calendar.dateComponents([.year, .month, .day], from: date)
            let osloDate = String(format: "%04d-%02d-%02d", day.year!, day.month!, day.day!)
            out.append(.feed)
            out.append(.qr("reai:receipt:\(context.tenantId):\(sale.cashPointId):\(osloDate):\(sale.receiptNumber)"))
            out.append(.text("Scan in ReAI Orders to find this receipt", align: .center))
        }
        return out
    }

    /// A printer check that is clearly not a receipt.
    static func testPage(columns: Int, printer: String) -> [ReceiptElement] {
        [.text("PRINTER TEST", align: .center, bold: true, size: .large),
         .text("Not a receipt", align: .center), .feed,
         .text("ReAI POS Print Bridge", align: .center, bold: true),
         .text(printer, align: .center), .feed,
         .text("Norwegian letters: Æ Ø Å æ ø å"),
         .pair("Paper width", columns >= 48 ? "80 mm" : "58 mm"),
         .rule,
         .text(String((0..<columns).map { Character(String($0 % 10)) })),
         .pair("Left", "Right", bold: true)]
    }

    // MARK: Formatting

    static func money(_ value: Decimal) -> String {
        var input = value, rounded = Decimal()
        NSDecimalRound(&rounded, &input, 2, .plain)
        let negative = rounded < 0
        let text = plain(negative ? -rounded : rounded)
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        var whole = String(parts[0])
        var fraction = parts.count > 1 ? String(parts[1]) : ""
        while fraction.count < 2 { fraction += "0" }
        var grouped = ""
        for (index, character) in whole.reversed().enumerated() {
            if index > 0 && index % 3 == 0 { grouped.append(",") }
            grouped.append(character)
        }
        whole = String(grouped.reversed())
        return (negative ? "-" : "") + whole + "." + fraction
    }

    /// Decimal without exponent or trailing zeros, for example 2, 1.5 or 11.11.
    static func plain(_ value: Decimal) -> String {
        var text = NSDecimalNumber(decimal: value).stringValue
        if text.contains(".") {
            while text.hasSuffix("0") { text.removeLast() }
            if text.hasSuffix(".") { text.removeLast() }
        }
        return text
    }

    static func dateTime(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = oslo
        let c = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        return String(format: "%02d.%02d.%04d %02d:%02d:%02d", c.day!, c.month!, c.year!, c.hour!, c.minute!, c.second!)
    }

    /// Parses ReAI's UTC instants with or without fractional seconds.
    static func parseInstant(_ text: String) -> Date? {
        guard let match = text.wholeMatch(of: #/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})/#) else { return nil }
        let formatter = ISO8601DateFormatter()
        guard let base = formatter.date(from: String(match.1) + String(match.3)) else { return nil }
        return base.addingTimeInterval(match.2.flatMap { Double("0" + $0) } ?? 0)
    }

    static func columns(_ values: [String], width: Int) -> String {
        let first = max(6, width / 4)
        let rest = (width - first) / (values.count - 1)
        var line = values[0].padding(toLength: first, withPad: " ", startingAt: 0)
        for value in values.dropFirst() { line += String(repeating: " ", count: max(1, rest - value.count)) + value }
        return String(line.prefix(width))
    }
}

// MARK: ESC/POS

/// Encodes receipt elements as ESC/POS for Epson TM and Star printers in ESC/POS mode.
/// Text uses code page PC865 (Nordic, ESC t 5), which has Æ Ø Å æ ø å on every Epson TM model.
enum EscPos {
    static let initialize: [UInt8] = [0x1B, 0x40, 0x1B, 0x74, 0x05, 0x1B, 0x52, 0x00]
    /// ESC p 0: pulse drawer pin 2 for 50 ms, then wait 500 ms.
    static let drawerKick: [UInt8] = [0x1B, 0x70, 0x00, 0x19, 0xFA]
    /// GS V B 3: feed to the cutter and partial cut.
    static let cut: [UInt8] = [0x1D, 0x56, 0x42, 0x03]

    static func encode(_ elements: [ReceiptElement], columns: Int, openDrawer: Bool) -> Data {
        var out = initialize
        for element in elements {
            switch element {
            case let .text(text, align, bold, size):
                let width = columns / size.widthFactor
                out += [0x1B, 0x61, align.rawValue, 0x1B, 0x45, bold ? 1 : 0, 0x1D, 0x21, size.rawValue]
                for line in wrap(sanitize(text), width: width) { out += encodeText(line) + [0x0A] }
                out += [0x1D, 0x21, 0x00, 0x1B, 0x45, 0x00, 0x1B, 0x61, 0x00]
            case let .pair(left, right, bold):
                out += [0x1B, 0x45, bold ? 1 : 0]
                for line in pair(sanitize(left), sanitize(right), width: columns) { out += encodeText(line) + [0x0A] }
                out += [0x1B, 0x45, 0x00]
            case let .row(values, bold):
                out += [0x1B, 0x45, bold ? 1 : 0] + encodeText(ReceiptRenderer.columns(values.map(sanitize), width: columns)) + [0x0A, 0x1B, 0x45, 0x00]
            case .rule:
                out += encodeText(String(repeating: "-", count: columns)) + [0x0A]
            case .feed:
                out += [0x0A]
            case let .qr(payload):
                out += qr(Array(payload.utf8), moduleSize: columns >= 48 ? 6 : 4)
            }
        }
        out += [0x0A, 0x0A] + cut
        if openDrawer { out += drawerKick }
        return Data(out)
    }

    static func drawerOnly() -> Data { Data(initialize + drawerKick) }

    /// GS ( k: QR model 2, error correction M, centred.
    static func qr(_ data: [UInt8], moduleSize: UInt8) -> [UInt8] {
        let length = data.count + 3
        return [0x1B, 0x61, 0x01,
                0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,
                0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, moduleSize,
                0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31,
                0x1D, 0x28, 0x6B, UInt8(length & 0xFF), UInt8(length >> 8), 0x31, 0x50, 0x30] + data +
               [0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30, 0x0A, 0x1B, 0x61, 0x00]
    }

    /// Characters 0x80-0xFF of code page 865.
    static let cp865 = Array("ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø₧ƒáíóúñÑªº¿⌐¬½¼¡«¤░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u{00A0}")
    static let table: [Character: UInt8] = Dictionary(uniqueKeysWithValues: cp865.enumerated().map { ($1, UInt8(0x80 + $0)) })

    /// Replaces characters the printer cannot show, so every remaining character takes one column.
    static func sanitize(_ text: String) -> String {
        let replacements: [Character: String] = ["€": "EUR", "–": "-", "—": "-", "‘": "'", "’": "'", "“": "\"", "”": "\"",
                                                 "…": "...", "×": "x", "\u{00A0}": " ", "\t": " "]
        var result = ""
        for character in text {
            if let ascii = character.asciiValue {
                if ascii >= 0x20 && ascii < 0x7F { result.append(character) } else if ascii == 0x0A || ascii == 0x0D { result.append(" ") }
            } else if table[character] != nil {
                result.append(character)
            } else if let replacement = replacements[character] {
                result += replacement
            } else {
                let folded = String(character).folding(options: [.diacriticInsensitive, .widthInsensitive], locale: nil)
                result += folded.allSatisfy({ $0.asciiValue.map { $0 >= 0x20 && $0 < 0x7F } ?? (table[$0] != nil) }) && !folded.isEmpty ? folded : "?"
            }
        }
        return result
    }

    static func encodeText(_ text: String) -> [UInt8] {
        text.map { character in character.asciiValue ?? table[character] ?? 0x3F }
    }

    static func wrap(_ text: String, width: Int) -> [String] {
        var lines: [String] = [], current = ""
        for word in text.split(separator: " ", omittingEmptySubsequences: true).map(String.init) {
            var word = word
            while word.count > width {
                if !current.isEmpty { lines.append(current); current = "" }
                lines.append(String(word.prefix(width))); word = String(word.dropFirst(width))
            }
            if current.isEmpty { current = word } else if current.count + 1 + word.count <= width { current += " " + word } else { lines.append(current); current = word }
        }
        if !current.isEmpty || lines.isEmpty { lines.append(current) }
        return lines
    }

    /// Label left, value right. Long values continue right-aligned on the next lines.
    static func pair(_ left: String, _ right: String, width: Int) -> [String] {
        if left.count + 1 + right.count <= width {
            return [left + String(repeating: " ", count: width - left.count - right.count) + right]
        }
        let labels = wrap(left, width: width)
        var values = wrap(right, width: width)
        if let last = labels.last, last.count + 1 + (values.first?.count ?? 0) <= width {
            let first = values.removeFirst()
            return Array(labels.dropLast()) + [last + String(repeating: " ", count: width - last.count - first.count) + first] +
                values.map { String(repeating: " ", count: width - $0.count) + $0 }
        }
        return labels + values.map { String(repeating: " ", count: width - $0.count) + $0 }
    }

    /// Plain-text rendering of the same layout, for previews and diagnostics.
    static func preview(_ elements: [ReceiptElement], columns: Int) -> String {
        var lines: [String] = []
        for element in elements {
            switch element {
            case let .text(text, align, _, size):
                let width = columns / size.widthFactor
                for line in wrap(sanitize(text), width: width) {
                    let shown = size == .large ? line.map { String($0) }.joined(separator: " ") : line
                    let padding = max(0, columns - shown.count)
                    lines.append(align == .center ? String(repeating: " ", count: padding / 2) + shown : align == .right ? String(repeating: " ", count: padding) + shown : shown)
                }
            case let .pair(left, right, _): lines += pair(sanitize(left), sanitize(right), width: columns)
            case let .row(values, _): lines.append(ReceiptRenderer.columns(values.map(sanitize), width: columns))
            case .rule: lines.append(String(repeating: "-", count: columns))
            case .feed: lines.append("")
            case let .qr(payload): lines.append(String(repeating: " ", count: max(0, (columns - 9) / 2)) + "[QR code]"); _ = payload
            }
        }
        return lines.joined(separator: "\n")
    }
}
