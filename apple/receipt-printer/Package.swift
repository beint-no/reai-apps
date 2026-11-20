// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "ReAIReceiptPrinter",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "ReAIReceiptPrinter", targets: ["ReAIReceiptPrinter"])],
    // Sparkle supplies signed in-app updates and the privileged replacement/relaunch helpers.
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1"),
    ],
    targets: [.executableTarget(name: "ReAIReceiptPrinter", dependencies: ["Sparkle"],
                               linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])])],
    swiftLanguageModes: [.v6]
)
