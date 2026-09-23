// swift-tools-version: 6.4
import PackageDescription
let package = Package(name: "ReAIZettleReconcile", platforms: [.macOS(.v15)], products: [.executable(name: "ReAIZettleReconcile", targets: ["ReAIZettleReconcile"])], targets: [.executableTarget(name: "ReAIZettleReconcile")], swiftLanguageModes: [.v6])
