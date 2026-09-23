import Foundation
struct CredentialField { let key: String; let label: String; let secret: Bool }
enum AppInfo {
    static let slug = "klarna"
    static let bundle = "no.reai.klarnareconcile"
    static let brand = "Klarna"
    static let helpURL = URL(string: "https://docs.klarna.com/acquirer/klarna/get-started/integration-resilience/authentication/")!
    static let fields: [CredentialField] = [CredentialField(key: "apiKey", label: "Klarna API key", secret: true)]
    static let credentialHint = "Create an API key in Klarna Merchant Portal with settlement report access. Paste the key only; no OAuth setup."
}
