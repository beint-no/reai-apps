import Foundation

@MainActor
struct AccountingTarget {
    let api: ReAIAPI
    let tenant: Company
    let token: String

    func read<T: Decodable & Sendable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try await api.request(path, token: token, tenant: tenant.id, query: query)
    }

    func list<T: Decodable & Sendable>(_ path: String, archived: Bool = false) async throws -> [T] {
        try await api.list(path, token: token, tenant: tenant.id, query: [
            URLQueryItem(name: "archived", value: String(archived))
        ])
    }

    func journal() throws -> Journal { try Journal(server: api.server, tenant: tenant) }

    func write<T: Decodable & Sendable>(_ path: String, fields: [String: Any], key: String,
                                        journal: Journal) async throws -> T {
        try Task.checkCancellation()
        let body = try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys])
        try journal.begin(key, endpoint: path, body: body)
        return try await api.request(path, token: token, tenant: tenant.id, body: body)
    }
}

struct AccountingRow: Identifiable, Sendable {
    let id: String
    let title: String
    let detail: String
    let requirements: [String]
    let problem: String?
    let lineDetails: [String]
}
