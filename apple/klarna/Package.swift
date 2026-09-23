// swift-tools-version: 6.4
import PackageDescription
let package = Package(name: "ReAIKlarnaReconcile", platforms: [.macOS(.v15)], products: [.executable(name: "ReAIKlarnaReconcile", targets: ["ReAIKlarnaReconcile"])], targets: [.executableTarget(name: "ReAIKlarnaReconcile")], swiftLanguageModes: [.v6])
