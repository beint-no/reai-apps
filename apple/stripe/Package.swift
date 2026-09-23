// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "ReAIStripeImport",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "ReAIStripeImport", targets: ["ReAIStripeImport"])],
    targets: [.executableTarget(name: "ReAIStripeImport")],
    swiftLanguageModes: [.v6]
)
