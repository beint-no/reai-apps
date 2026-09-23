import Foundation
struct CredentialField { let key: String; let label: String; let secret: Bool }
enum AppInfo {
    static let slug = "dintero"
    static let bundle = "no.reai.dinterofees"
    static let brand = "Dintero"
    static let helpURL = URL(string: "https://support.dintero.com/en/knowledge-base/create-api-keys-1")!
    static let fields: [CredentialField] = [
        CredentialField(key: "accountID", label: "Dintero account ID (P/T + 8 digits)", secret: false),
        CredentialField(key: "clientID", label: "Client ID", secret: false),
        CredentialField(key: "clientSecret", label: "Client secret", secret: true)
    ]
    static let credentialHint = "Use Advanced setup in Dintero Backoffice with read access to settlements. Paste the account ID, client ID and secret; no browser OAuth."
}
