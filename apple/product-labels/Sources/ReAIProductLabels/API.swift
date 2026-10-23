import Foundation

func t(_ key: String) -> String { NSLocalizedString(key, bundle: .module, comment: "") }
func appError(_ text: String) -> NSError {
    NSError(domain: "no.reai.productlabels", code: 0, userInfo: [NSLocalizedDescriptionKey: t(text)])
}
enum AppEnvironment { static let origin = URL(string: "https://app.reai.no")! }
final class RedirectBlocker: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
struct Company: Decodable, Sendable { let id: Int; let companyName: String; let currencyCode: String }
struct Product: Decodable, Sendable {
    let id: Int; let title: String; let material: String?; let vatCode: String?; let brand: String?; let variants: [Variant]
}
struct Variant: Decodable, Sendable {
    let variantId: Int; let productVariantId: UUID; let sku: String; let barcode: String?; let countryOfOriginCode: String?
    let sellingPrice: Decimal; let options: [String: String]
}
struct CatalogItem: Identifiable, Sendable {
    let id: Int; let variantUUID: UUID; let title: String; let sku: String; let barcode: String; let origin: String; let details: String; let price: Decimal; let vatCode: String?
    init(product: Product, variant: Variant) {
        id = variant.variantId; variantUUID = variant.productVariantId; title = product.title; sku = variant.sku; barcode = variant.barcode ?? ""
        origin = variant.countryOfOriginCode ?? ""
        details = ([product.brand, product.material].compactMap { $0 } + variant.options.sorted { $0.key < $1.key }.map { "\($0.key): \($0.value)" }).filter { !$0.isEmpty }.joined(separator: " · ")
        vatCode = product.vatCode; price = variant.sellingPrice
    }
}
struct PriceList: Decodable, Identifiable, Sendable { let id: UUID; let name: String; let currency: String }
struct VatCode: Decodable, Sendable { let code: String; let rate: Decimal }
struct VariantPrice: Decodable, Sendable { let productVariantId: UUID; let sellingPrice: Decimal }
struct PriceSource: Identifiable {
    let id: String; let name: String; let currency: String
}
actor ReAIAPI {
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30; config.timeoutIntervalForResource = 60
        return URLSession(configuration: config, delegate: RedirectBlocker(), delegateQueue: nil)
    }()
    func account(token: String) async throws -> Company {
        struct Account: Decodable { let tenants: [Company] }
        let account: Account = try await get("api/me", token: token)
        guard account.tenants.count == 1, let company = account.tenants.first else { throw appError("Connect again and choose one company in ReAI.") }
        return company
    }
    func products(token: String, company: Int) async throws -> [CatalogItem] {
        let products: [Product] = try await get("api/products", token: token, company: company)
        return products.flatMap { p in p.variants.map { CatalogItem(product: p, variant: $0) } }
    }
    func priceLists(token: String, company: Int) async throws -> [PriceList] {
        try await get("api/product-price-lists", token: token, company: company)
    }
    func prices(token: String, company: Int, list: UUID) async throws -> [VariantPrice] {
        try await get("api/product-price-lists/\(list.uuidString)/prices", token: token, company: company)
    }
    func vatCodes(token: String, company: Int, salesOnly: Bool = false) async throws -> [VatCode] {
        try await get("api/vat-codes", token: token, company: company,
                      query: salesOnly ? [URLQueryItem(name: "usage", value: "customer-invoice")] : [])
    }
    private func get<T: Decodable>(_ path: String, token: String, company: Int? = nil, query: [URLQueryItem] = []) async throws -> T {
        var request = URLRequest(url: AppEnvironment.origin.appending(path: path).appending(queryItems: query))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(Locale.preferredLanguages.first ?? "en", forHTTPHeaderField: "Accept-Language")
        if let company { request.setValue(String(company), forHTTPHeaderField: "X-Tenant-Id") }
        let (data, raw) = try await session.data(for: request)
        guard let response = raw as? HTTPURLResponse else { throw appError("ReAI returned an invalid response.") }
        guard response.statusCode == 200 else {
            switch response.statusCode {
            case 401: throw appError("Your connection has expired. Disconnect and connect to ReAI again.")
            case 403: throw appError("You need permission to read products in this company.")
            default: throw appError("Could not load products from ReAI. Try refreshing.")
            }
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
