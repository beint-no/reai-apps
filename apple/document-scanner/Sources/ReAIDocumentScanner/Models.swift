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

/// File types the ReAI upload endpoints accept, and image types the app converts to JPEG first.
enum FileTypes {
    static let accepted: Set<String> = ["pdf", "png", "jpg", "jpeg", "avif", "bmp", "gif"]
    static let converted: Set<String> = ["heic", "heif", "tif", "tiff", "webp"]
    static func supported(_ url: URL) -> Bool {
        let ext = url.pathExtension.lowercased()
        return accepted.contains(ext) || converted.contains(ext)
    }
    static let unsupportedMessage = "ReAI accepts PDF and images (PNG, JPEG, HEIC, TIFF, AVIF, BMP, GIF)."
}

struct Transfer: Codable, Identifiable, Sendable {
    var id = UUID()
    let company: Company
    let destination: Destination
    let filename: String
    let fingerprint: String
    var file: URL
    var created = Date()
    var status = "Queued"
    var detail = ""
    var remoteID: Int?
}

enum TransferStatus {
    static let queued = "Queued"
    static let uploading = "Uploading"
    static let uploaded = "Uploaded"
    /// The outcome is unknown: ReAI may have received the file.
    static let checkReAI = "Check ReAI"
    /// ReAI answered that it did not accept the file.
    static let rejected = "Not uploaded"
    static let duplicate = "Duplicate skipped"
}

func appError(_ message: String) -> NSError {
    NSError(domain: "no.reai.documentscanner", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}
