import Foundation

actor ProviderAPI {
    private let session: URLSession
    init() {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 25
        c.timeoutIntervalForResource = 45
        session = URLSession(configuration: c, delegate: RedirectBlocker(), delegateQueue: nil)
    }

    private struct Token: Decodable { let access_token: String }
    private struct Page: Decodable { let items: [Item]; let last_evaluated_key: Cursor? }
    private struct Cursor: Decodable { let id: String; let settled_at: String? }
    private struct Item: Decodable {
        let id: String
        let settled_at: String?
        let provider: String?
        let payment_status: String?
        let amounts: [Amount]
    }
    private struct Amount: Decodable {
        let amount: Int64
        let capture: Int64?
        let refund: Int64?
        let fee: Int64
        let currency: String
    }

    private func token(_ fields: [String: String]) async throws -> String {
        guard let account = fields["accountID"], account.range(of: "^[PT][0-9]{8}$", options: .regularExpression) != nil,
              let client = fields["clientID"], !client.isEmpty,
              let secret = fields["clientSecret"], !secret.isEmpty else {
            throw appError("Enter the Dintero account ID, client ID, and client secret from Backoffice.")
        }
        let base = "https://api.dintero.com/v1/accounts/\(account)"
        var req = URLRequest(url: URL(string: base + "/auth/token")!)
        req.httpMethod = "POST"
        req.setValue("Basic \(Data("\(client):\(secret)".utf8).base64EncodedString())", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["grant_type": "client_credentials", "audience": base])
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw appError("Invalid Dintero response.") }
        guard (200..<300).contains(http.statusCode) else {
            throw appError(http.statusCode == 401 || http.statusCode == 403 ? "Dintero rejected these credentials. Check the API client's settlement report permissions." : "Dintero returned HTTP \(http.statusCode) during sign-in.")
        }
        return try JSONDecoder().decode(Token.self, from: data).access_token
    }

    func validate(_ fields: [String: String]) async throws { _ = try await token(fields) }

    func settlements(_ fields: [String: String], start: String, end: String) async throws -> [Payout] {
        let access = try await token(fields)
        let account = fields["accountID"]!
        var result: [Payout] = []
        var cursor: Cursor?
        var seen: Set<String> = []
        repeat {
            var query = [URLQueryItem(name: "limit", value: "100"),
                         URLQueryItem(name: "created_at.gte", value: start),
                         URLQueryItem(name: "created_at.lte", value: end)]
            if let cursor {
                guard let date = cursor.settled_at else { throw appError("Dintero omitted a pagination date. Review a shorter period.") }
                query += [URLQueryItem(name: "starting_after_id", value: cursor.id),
                          URLQueryItem(name: "starting_after_date", value: date)]
            }
            let url = URL(string: "https://api.dintero.com/v1/accounts/\(account)/settlements")!.appending(queryItems: query)
            var req = URLRequest(url: url)
            req.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            let (data, response) = try await session.data(for: req)
            guard let http = response as? HTTPURLResponse else { throw appError("Invalid Dintero settlement response.") }
            guard (200..<300).contains(http.statusCode) else { throw appError("Dintero settlements returned HTTP \(http.statusCode). Check settlement report permissions.") }
            let page = try JSONDecoder().decode(Page.self, from: data)
            for item in page.items {
                guard seen.insert(item.id).inserted else { throw appError("Dintero repeated a settlement page. Try again later.") }
                guard item.payment_status?.lowercased() == "paid", let day = item.settled_at.map({ String($0.prefix(10)) }), day >= start, day < end else { continue }
                for (index, amount) in item.amounts.enumerated() {
                    result.append(Payout(id: "\(item.id):\(index)", date: day, amountMinor: amount.amount,
                                         currency: amount.currency, feeMinor: amount.fee,
                                         reference: item.id, detail: "\(item.provider ?? "Dintero") · captured \(amount.capture ?? 0), refunds \(amount.refund ?? 0) minor units"))
                }
            }
            if result.count > 5000 { throw appError("More than 5,000 settlement amounts. Choose a smaller period.") }
            cursor = page.last_evaluated_key
            if page.items.isEmpty && cursor != nil { throw appError("Dintero returned an incomplete settlement page.") }
        } while cursor != nil
        return result
    }
}
