import Foundation

struct Company: Codable, Identifiable, Hashable, Sendable {
    let id: Int
    let companyName: String
    let slug: String
}

struct Account: Decodable, Sendable {
    let email: String
    let tenants: [Company]
}

enum Destination: String, Codable, CaseIterable, Identifiable, Sendable {
    case documents = "Documents"
    case invoices = "Supplier invoices"
    case income = "Income reception"
    case receipts = "Receipt reception"
    var id: String { rawValue }
    var endpoint: String {
        switch self {
        case .documents: "api/documents"
        case .invoices: "api/invoice-reception-documents"
        case .income: "api/income-reception-documents"
        case .receipts: "api/receipt-reception-documents"
        }
    }
    var explanation: String {
        switch self {
        case .documents: "Save files to your company’s document center."
        case .invoices: "ReAI will analyze supplier invoices for review."
        case .income: "ReAI will analyze income documents for review in Income reception."
        case .receipts: "ReAI will analyze purchase receipts for review in Receipt reception."
        }
    }
}

struct Transfer: Codable, Identifiable, Sendable {
    var id = UUID()
    let company: Company
    let destination: Destination
    let filename: String
    let fingerprint: String
    let file: URL
    var created = Date()
    var status = "Queued"
    var detail = ""
    var remoteID: Int?
}

func vaultError(_ message: String) -> NSError {
    NSError(domain: "no.reai.findervault", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}
