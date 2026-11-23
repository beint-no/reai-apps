import Foundation

// The fixture is a normalized projection of the documented RecMan scopes.
// Workplaces and wage line associations are deliberate synthetic assumptions.
struct Demo {
    struct Candidate {
        let candidateId: Int
        let firstName: String
        let lastName: String
        let isEmployee: Bool
        var name: String { "\(firstName) \(lastName)" }
        var email: String { "recman-demo-\(candidateId)@example.invalid" }
    }

    struct Document {
        let externalId: String
        let number: String
        let quantity: Int
        let paymentReference: String?
        let productName: String
        let issueDate: String
        var isCredit: Bool { quantity < 0 }
        var unitPrice: Int { isCredit ? -1000 : 1000 }
        var billedQuantity: Int { abs(quantity) }
        var net: Decimal { Decimal(billedQuantity * unitPrice) }
        var vat: Decimal { net / 4 }
        var total: Decimal { net + vat }

        // Stable bytes keep the ReAI invoice idempotency fingerprint stable.
        var pdf: Data {
            let label = isCredit ? "Credit note" : "Invoice"
            let text = """
                BT /F1 20 Tf 54 730 Td (Synthetic RecMan \(label.lowercased()) \(number)) Tj
                /F1 12 Tf 0 -32 Td (Issued \(issueDate) | RecMan Demo Customer) Tj
                0 -20 Td (\(productName) | Quantity \(billedQuantity) | Unit NOK \(unitPrice)) Tj
                0 -20 Td (Net NOK \(net) | VAT NOK \(vat) | Total NOK \(total)) Tj
                \(paymentReference.map { "0 -20 Td (KID \($0)) Tj" } ?? "") ET
                """
            let objects = [
                "<< /Type /Catalog /Pages 2 0 R >>",
                "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
                "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
                "<< /Length \(text.utf8.count) >>\nstream\n\(text)\nendstream"
            ]
            var bytes = Data("%PDF-1.4\n".utf8)
            var offsets: [Int] = []
            for (index, object) in objects.enumerated() {
                offsets.append(bytes.count)
                bytes.append(Data("\(index + 1) 0 obj\n\(object)\nendobj\n".utf8))
            }
            let xref = bytes.count
            bytes.append(Data("xref\n0 6\n0000000000 65535 f \n".utf8))
            for offset in offsets {
                bytes.append(Data(String(format: "%010d 00000 n \n", offset).utf8))
            }
            bytes.append(Data("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n\(xref)\n%%EOF\n".utf8))
            return bytes
        }
    }

    struct Wage {
        let candidateId: Int
        let articleCode: String
        let municipality: String
        let hours: Int
        let rate: Int
        var specification: String? { articleCode == "DEMO-HOURS" ? "hourly_salary" : nil }
    }

    let issueDate: String
    let period: String
    var paymentDate: String { period + "-28" }
    // ReAI requires an account for draft payroll. This all-zero fixture is for local use only.
    let payrollBankAccount = "00000000000"
    let employmentStart = "2026-01-01"
    let customerName = "RecMan Demo Customer"
    let customerNumber = "7654321"
    let productName = "RecMan Demo Staffing"
    let productSKU = "RECMAN-DEMO-STAFFING"
    let candidates = [
        Candidate(candidateId: 101, firstName: "Robin", lastName: "Example", isEmployee: true),
        Candidate(candidateId: 102, firstName: "Alex", lastName: "Example", isEmployee: true),
        Candidate(candidateId: 103, firstName: "Sam", lastName: "Example", isEmployee: false)
    ]
    let wages = [
        Wage(candidateId: 101, articleCode: "DEMO-HOURS", municipality: "0301", hours: 8, rate: 250),
        Wage(candidateId: 102, articleCode: "DEMO-HOURS", municipality: "0301", hours: 4, rate: 250),
        Wage(candidateId: 102, articleCode: "DEMO-HOURS", municipality: "2020", hours: 4, rate: 250)
    ]

    var employees: [Candidate] { candidates.filter(\.isEmployee) }

    var documents: [Document] {
        let suffix = issueDate.replacingOccurrences(of: "-", with: "")
        return [
            Document(externalId: "invoice-\(suffix)", number: "RM-\(suffix)-1", quantity: 2,
                     paymentReference: "76543216", productName: productName, issueDate: issueDate),
            Document(externalId: "credit-note-\(suffix)", number: "RM-\(suffix)-2", quantity: -1,
                     paymentReference: nil, productName: productName, issueDate: issueDate)
        ]
    }

    init(date: Date) {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(identifier: "Europe/Oslo")
        formatter.dateFormat = "yyyy-MM-dd"
        issueDate = formatter.string(from: date)
        period = String(issueDate.prefix(7))
    }

    func wageReview(for candidateId: Int) -> String? {
        let lines = wages.filter { $0.candidateId == candidateId }
        if lines.contains(where: { $0.specification == nil }) { return "Unmapped wage code" }
        if Set(lines.map(\.municipality)).count > 1 { return "Multiple municipalities require manual AGA review" }
        return nil
    }
}
