// swift-tools-version: 6.4
import PackageDescription
let package = Package(name: "ReAIRecMan", platforms: [.macOS(.v15)], products: [.executable(name: "ReAIRecMan", targets: ["ReAIRecMan"])], targets: [.executableTarget(name: "ReAIRecMan")], swiftLanguageModes: [.v6])
