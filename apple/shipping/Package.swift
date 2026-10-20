// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "ReAIShipping",
    defaultLocalization: "en",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "ReAIShipping", targets: ["ReAIShipping"])],
    // Sparkle supplies signed in-app updates and the privileged replacement/relaunch helpers.
    dependencies: [.package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.0")],
    targets: [.executableTarget(name: "ReAIShipping", dependencies: ["Sparkle"],
                               resources: [.process("Resources")],
                               linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])])],
    swiftLanguageModes: [.v6]
)
