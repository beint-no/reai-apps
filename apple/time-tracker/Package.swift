// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "ReAITimeTracker",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "ReAITimeTracker", targets: ["ReAITimeTracker"])],
    targets: [.executableTarget(name: "ReAITimeTracker")],
    swiftLanguageModes: [.v6]
)
