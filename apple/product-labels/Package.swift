// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "ReAIProductLabels",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "ReAIProductLabels", targets: ["ReAIProductLabels"])],
    // Sparkle supplies signed in-app updates and the privileged replacement/relaunch helpers.
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1"),
        .package(url: "https://github.com/swiftlang/swift-subprocess", exact: "1.0.2"),
    ],
    targets: [.executableTarget(name: "ReAIProductLabels", dependencies: ["Sparkle", .product(name: "Subprocess", package: "swift-subprocess")],
                               linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])])],
    swiftLanguageModes: [.v6]
)
