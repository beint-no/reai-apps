import Foundation
struct CredentialField { let key: String; let label: String; let secret: Bool }
enum AppInfo {
    static let slug = "vipps"
    static let bundle = "no.reai.vippsreconcile"
    static let brand = "Vipps"
    static let helpURL = URL(string: "https://developer.vippsmobilepay.com/docs/APIs/report-api/report-api-quick-start/")!
    static let fields: [CredentialField] = [CredentialField(key: "clientId", label: "Client ID", secret: false), CredentialField(key: "clientSecret", label: "Client secret", secret: true), CredentialField(key: "subscriptionKey", label: "Subscription key", secret: true), CredentialField(key: "msn", label: "Merchant serial number", secret: false)]
    static let credentialHint = "Use production API keys for a Vipps sales unit with Report API access. Four values are required; no app registration here."
}
