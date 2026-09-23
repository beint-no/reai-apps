import Foundation

actor ProviderAPI {
    private let session: URLSession
    init() {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 25; c.timeoutIntervalForResource = 45
        session = URLSession(configuration: c, delegate: RedirectBlocker(), delegateQueue: nil)
    }
    private struct Page: Decodable { let payouts: [Item]; let pagination: Pagination }
    private struct Pagination: Decodable { let total: Int?; let count: Int }
    private struct Item: Decodable {
        let payment_reference: String
        let payout_date: String
        let currency_code: String
        let totals: Totals
        let merchant_id: String?
    }
    private struct Totals: Decodable { let settlement_amount: Int64; let sale_amount: Int64?; let fee_amount: Int64?; let return_amount: Int64? }
    private func page(_ key: String, start: String?, end: String?, offset: Int) async throws -> Page {
        var query = [URLQueryItem(name: "size", value: "100"), URLQueryItem(name: "offset", value: String(offset))]
        if let start, let end {
            query += [URLQueryItem(name: "start_date", value: "\(start)T00:00:00Z"),
                      URLQueryItem(name: "end_date", value: "\(end)T00:00:00Z")]
        }
        let url = URL(string: "https://api.klarna.com/settlements/v1/payouts")!.appending(queryItems: query)
        var req = URLRequest(url: url)
        req.setValue("Basic \(key)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw appError("Invalid Klarna response.") }
        guard (200..<300).contains(http.statusCode) else {
            throw appError(http.statusCode == 401 || http.statusCode == 403 ? "Klarna rejected this API key or denied settlement access." : "Klarna returned HTTP \(http.statusCode).")
        }
        return try JSONDecoder().decode(Page.self, from: data)
    }
    func validate(_ fields: [String: String]) async throws {
        guard let key = fields["apiKey"], key.hasPrefix("klarna_live_api_") else {
            throw appError("Paste the Klarna API key from Merchant Portal (klarna_live_api_…).")
        }
        _ = try await page(key, start: nil, end: nil, offset: 0)
    }
    func payouts(_ fields: [String: String], start: String, end: String) async throws -> [Payout] {
        guard let key = fields["apiKey"] else { throw appError("Missing Klarna API key.") }
        var result: [Payout] = [], offset = 0
        repeat {
            let data = try await page(key, start: start, end: end, offset: offset)
            result += data.payouts.map { item in
                Payout(id: item.payment_reference, date: String(item.payout_date.prefix(10)), amountMinor: item.totals.settlement_amount,
                       currency: item.currency_code, reference: item.payment_reference,
                       detail: "Sales \(item.totals.sale_amount ?? 0), fees \(item.totals.fee_amount ?? 0), returns \(item.totals.return_amount ?? 0) minor units")
            }
            guard !data.payouts.isEmpty || offset >= (data.pagination.total ?? 0) else { throw appError("Klarna returned an incomplete payout page.") }
            offset += data.payouts.count
            if offset >= (data.pagination.total ?? Int.max) || data.payouts.count < 100 { break }
            if result.count > 5000 { throw appError("More than 5,000 payouts. Choose a smaller period.") }
        } while true
        return result
    }
}
