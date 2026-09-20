// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "ReAIFinderVault",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "ReAIFinderVault", targets: ["ReAIFinderVault"])],
    targets: [.executableTarget(name: "ReAIFinderVault")],
    swiftLanguageModes: [.v6]
)
