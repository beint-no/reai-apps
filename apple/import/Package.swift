// swift-tools-version: 6.4
import PackageDescription
let package = Package(
    name: "ReAIImport",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "ReAIImport", targets: ["ReAIImport"])],
    dependencies: [.package(url: "https://github.com/weichsel/ZIPFoundation.git", exact: "0.9.20")],
    targets: [.executableTarget(name: "ReAIImport", dependencies: [.product(name: "ZIPFoundation", package: "ZIPFoundation")])],
    swiftLanguageModes: [.v6]
)
