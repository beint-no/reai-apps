// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "ReAIDocumentScanner",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "ReAIDocumentScanner", targets: ["ReAIDocumentScanner"])],
    targets: [.executableTarget(name: "ReAIDocumentScanner")],
    swiftLanguageModes: [.v6]
)
