// swift-tools-version: 6.4
import PackageDescription
let package = Package(name: "ReAIHybel", platforms: [.macOS(.v15)], products: [.executable(name: "ReAIHybel", targets: ["ReAIHybel"])], targets: [.executableTarget(name: "ReAIHybel")], swiftLanguageModes: [.v6])
