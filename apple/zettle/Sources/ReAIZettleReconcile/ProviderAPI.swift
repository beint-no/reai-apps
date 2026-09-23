import Foundation

actor ProviderAPI {
    private let session: URLSession
    init() {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 25; c.timeoutIntervalForResource = 45
        session = URLSession(configuration: c, delegate: RedirectBlocker(), delegateQueue: nil)
    }
    private struct Token: Decodable { let access_token: String }
    private struct Balance: Decodable { let data: Value; struct Value: Decodable { let currencyId: String } }
    private struct Page: Decodable { let data: [Entry] }
    private struct Entry: Decodable { let timestamp: String; let amount: Int64; let originatorTransactionType: String; let originatingTransactionUuid: String }
    private func access(_ fields: [String: String]) async throws -> String {
        guard let key = fields["apiKey"], let client = fields["clientId"] else { throw appError("Missing Zettle credentials.") }
        var req = URLRequest(url: URL(string: "https://oauth.zettle.com/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let form = [URLQueryItem(name: "grant_type", value: "urn:ietf:params:oauth:grant-type:jwt-bearer"), URLQueryItem(name: "client_id", value: client), URLQueryItem(name: "assertion", value: key)]
        var components = URLComponents(); components.queryItems = form
        req.httpBody = Data((components.percentEncodedQuery ?? "").utf8)
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw appError("Invalid Zettle token response.") }
        guard http.statusCode == 200 else { throw appError(http.statusCode == 400 || http.statusCode == 401 ? "Zettle rejected the API key or client ID." : "Zettle returned HTTP \(http.statusCode).") }
        return try JSONDecoder().decode(Token.self, from: data).access_token
    }
    private func get(_ path: String, token: String, query: [URLQueryItem] = []) async throws -> Data {
        let url = URL(string: "https://finance.izettle.com")!.appending(path: path).appending(queryItems: query)
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw appError("Invalid Zettle finance response.") }
        guard (200..<300).contains(http.statusCode) else { throw appError(http.statusCode == 403 ? "This Zettle key needs READ:FINANCE scope." : "Zettle Finance returned HTTP \(http.statusCode).") }
        return data
    }
    func validate(_ fields: [String: String]) async throws {
        let token = try await access(fields)
        let data = try await get("v2/accounts/liquid/balance", token: token)
        _ = try JSONDecoder().decode(Balance.self, from: data)
    }
    func payouts(_ fields: [String: String], start: String, end: String) async throws -> [Payout] {
        let token = try await access(fields)
        let balanceData = try await get("v2/accounts/liquid/balance", token: token)
        let balance = try JSONDecoder().decode(Balance.self, from: balanceData)
        var result: [Payout] = [], offset = 0
        repeat {
            let data = try await get("v2/accounts/liquid/transactions", token: token, query: [
                URLQueryItem(name: "start", value: "\(start)T00:00:00Z"),
                URLQueryItem(name: "end", value: "\(end)T00:00:00Z"),
                URLQueryItem(name: "includeTransactionType", value: "PAYOUT"),
                URLQueryItem(name: "limit", value: "100"), URLQueryItem(name: "offset", value: String(offset))])
            let page = try JSONDecoder().decode(Page.self, from: data)
            result += page.data.filter { $0.originatorTransactionType == "PAYOUT" && $0.amount < 0 }.map { row in
                Payout(id: row.originatingTransactionUuid, date: String(row.timestamp.prefix(10)), amountMinor: -row.amount,
                       currency: balance.data.currencyId, reference: row.originatingTransactionUuid, detail: "Zettle liquid account payout")
            }
            if page.data.count < 100 { break }
            offset += page.data.count
            if offset >= 5000 { throw appError("More than 5,000 Zettle transactions. Choose a smaller period.") }
        } while true
        return result
    }
}
