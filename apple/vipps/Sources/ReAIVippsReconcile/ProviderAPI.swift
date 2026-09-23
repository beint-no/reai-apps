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
    private struct LedgerPage: Decodable { let items: [Ledger]; let cursor: String? }
    private struct Ledger: Decodable { let ledgerId: String; let currency: String }
    private struct EntryPage: Decodable { let items: [Entry]; let cursor: String?; let hasMore: Bool? }
    private struct Entry: Decodable {
        let pspReference: String?; let ledgerDate: String; let entryType: String
        let reference: String?; let currency: String; let amount: Int64
    }
    private func send(_ path: String, fields: [String: String], token: String? = nil, query: [URLQueryItem] = []) async throws -> (Data, Int) {
        let url = URL(string: "https://api.vipps.no")!.appending(path: path).appending(queryItems: query)
        var req = URLRequest(url: url)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("reai-apps", forHTTPHeaderField: "Vipps-System-Name")
        req.setValue("0.1.0", forHTTPHeaderField: "Vipps-System-Version")
        req.setValue(fields["subscriptionKey"], forHTTPHeaderField: "Ocp-Apim-Subscription-Key")
        req.setValue(fields["msn"], forHTTPHeaderField: "Merchant-Serial-Number")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        else {
            req.httpMethod = "POST"; req.httpBody = Data()
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue(fields["clientId"], forHTTPHeaderField: "client_id")
            req.setValue(fields["clientSecret"], forHTTPHeaderField: "client_secret")
        }
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw appError("Invalid Vipps response.") }
        guard (200..<300).contains(http.statusCode) || http.statusCode == 404 else {
            throw appError(http.statusCode == 401 || http.statusCode == 403 ? "Vipps rejected these credentials or Report API access." : "Vipps returned HTTP \(http.statusCode).")
        }
        return (data, http.statusCode)
    }
    private func access(_ fields: [String: String]) async throws -> String {
        let (data, status) = try await send("accesstoken/get", fields: fields)
        guard status == 200 else { throw appError("Vipps token endpoint was unavailable.") }
        return try JSONDecoder().decode(Token.self, from: data).access_token
    }
    private func ledgers(_ fields: [String: String], token: String) async throws -> [Ledger] {
        var all: [Ledger] = [], cursor: String?
        repeat {
            let (data, _) = try await send("settlement/v1/ledgers", fields: fields, token: token,
                query: cursor.map { [URLQueryItem(name: "cursor", value: $0)] } ?? [])
            let page = try JSONDecoder().decode(LedgerPage.self, from: data)
            all += page.items
            cursor = page.cursor.flatMap { $0.isEmpty ? nil : $0 }
            if all.count > 100 { throw appError("More than 100 Vipps ledgers. Narrow this integration to one sales unit.") }
        } while cursor != nil
        guard !all.isEmpty else { throw appError("No Vipps Report API ledgers are available for this sales unit.") }
        return all
    }
    func validate(_ fields: [String: String]) async throws {
        let token = try await access(fields)
        _ = try await ledgers(fields, token: token)
    }
    func payouts(_ fields: [String: String], start: String, end: String) async throws -> [Payout] {
        let token = try await access(fields)
        let accounts = try await ledgers(fields, token: token)
        var result: [Payout] = []
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"; formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.locale = Locale(identifier: "en_US_POSIX")
        var date = formatter.date(from: start)!
        let limit = formatter.date(from: end)!
        while date < limit {
            let day = formatter.string(from: date)
            for ledger in accounts {
                var cursor: String?
                repeat {
                    let (data, status) = try await send("report/v2/ledgers/\(ledger.ledgerId)/funds/dates/\(day)", fields: fields, token: token,
                        query: cursor.map { [URLQueryItem(name: "cursor", value: $0)] } ?? [])
                    if status == 404 { break }
                    let page = try JSONDecoder().decode(EntryPage.self, from: data)
                    result += page.items.filter { $0.entryType == "payout-scheduled" && $0.amount < 0 }.map { row in
                        Payout(id: "\(ledger.ledgerId):\(row.pspReference ?? row.ledgerDate + String(row.amount))", date: row.ledgerDate,
                               amountMinor: -row.amount, currency: row.currency, reference: row.reference ?? row.pspReference ?? "",
                               detail: "Ledger \(ledger.ledgerId) · scheduled payout")
                    }
                    cursor = page.hasMore == true ? page.cursor : nil
                    if page.hasMore == true && (cursor == nil || page.items.isEmpty) { throw appError("Vipps returned an incomplete report page.") }
                    if result.count > 5000 { throw appError("More than 5,000 payouts. Choose a smaller period.") }
                } while cursor != nil
            }
            date = Calendar(identifier: .gregorian).date(byAdding: .day, value: 1, to: date)!
        }
        return result
    }
}
