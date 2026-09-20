import Foundation

struct Company: Codable, Identifiable, Hashable, Sendable {
    let id: Int
    let companyName: String
}
struct Account: Decodable, Sendable { let email: String; let tenants: [Company] }
func appError(_ text: String, code: Int = 0) -> NSError {
    NSError(domain: "no.reai.import", code: code, userInfo: [NSLocalizedDescriptionKey: text])
}
enum AppEnvironment {
    static let origin = URL(string: "https://app.reai.no")!
    static let profile = URL(string: "https://app.reai.no/user/profile#user-access-tokens")!
}
enum ImportKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case products, customers, suppliers
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var singular: String { switch self { case .products: "product"; case .customers: "customer"; case .suppliers: "supplier" } }
    var symbol: String { switch self { case .products: "shippingbox"; case .customers: "person.2"; case .suppliers: "building.2" } }
}
struct Sheet: Sendable, Identifiable {
    var id: String { name }
    let name: String
    let rows: [[String]]
}
struct Field: Identifiable, Sendable {
    let id: String
    let title: String
    let aliases: [String]
    var required = false
    var type: FieldType = .text
}
enum FieldType: Sendable { case text, decimal, integer, boolean }
enum RowState: String, Codable, Sendable {
    case ready = "Ready", invalid = "Needs correction", skipped = "Skipped", sending = "Sending", created = "Created", uncertain = "Check ReAI", rejected = "Rejected"
}
struct ImportRow: Codable, Identifiable, Sendable {
    var id: Int { line }
    let line: Int
    let name: String
    let fields: [String: String]
    let payload: Data?
    var state: RowState
    var detail: String
    var remoteID: Int?
    func preview(kind: ImportKind) -> [PreviewValue] {
        guard let payload, var object = (try? JSONSerialization.jsonObject(with: payload)) as? [String: Any] else { return [] }
        if let variant = (object.removeValue(forKey: "variants") as? [[String: Any]])?.first { object.merge(variant) { _, new in new } }
        return Fields.forKind(kind).compactMap { field in
            guard let value = object[field.id] else { return nil }
            let text: String
            switch field.type {
            case .boolean: text = (value as? Bool) == true ? "Yes" : "No"
            default: text = (value as? String) ?? (value as? NSNumber)?.stringValue ?? ""
            }
            return PreviewValue(id: field.id, title: field.title, value: text)
        }
    }
}
struct PreviewValue: Identifiable { let id: String; let title: String; let value: String }
struct ImportBatch: Codable, Sendable {
    var id = UUID()
    let filename: String
    let kind: ImportKind
    let company: Company
    let email: String
    var rows: [ImportRow]
}
struct ExistingRecord: Decodable, Sendable {
    struct Variant: Decodable, Sendable { let sku: String }
    let id: Int
    let name: String?
    let title: String?
    let number: String?
    let email: String?
    let variants: [Variant]?
    var keys: Set<String> {
        var values = Set<String>()
        for (prefix, value) in [("name", name), ("number", number), ("email", email)] {
            if let value, !value.isEmpty { values.insert(prefix + ":" + value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) }
        }
        for variant in variants ?? [] { values.insert("sku:" + variant.sku.lowercased()) }
        return values
    }
}

struct ExistingSnapshot: Sendable { var keys = Set<String>(); var ids = Set<Int>() }
