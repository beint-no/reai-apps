// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "ReAIShipping",
    defaultLocalization: "en",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "ReAIShipping", targets: ["ReAIShipping"])],
    targets: [.executableTarget(name: "ReAIShipping", resources: [.process("Resources")])],
    swiftLanguageModes: [.v6]
)
