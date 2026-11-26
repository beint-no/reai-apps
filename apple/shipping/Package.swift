// swift-tools-version: 6.4
import PackageDescription

let swiftSettings: [SwiftSetting] = [
    .enableUpcomingFeature("MemberImportVisibility"),
    .enableUpcomingFeature("InternalImportsByDefault"),
    .enableUpcomingFeature("ImmutableWeakCaptures"),
    .enableUpcomingFeature("ExistentialAny"),
    .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
    .enableUpcomingFeature("InferIsolatedConformances"),
    .treatWarning("MemberImportVisibility", as: .error),
    .treatWarning("ExistentialAny", as: .error),
    .treatWarning("NonisolatedNonsendingByDefault", as: .error),
    .treatWarning("IsolatedConformances", as: .error),
    .treatWarning("SendableMetatypes", as: .error),
    .treatWarning("SendableClosureCaptures", as: .error),
    .treatWarning("ActorIsolatedCall", as: .error),
    .treatWarning("MutableGlobalVariable", as: .error),
    .treatWarning("PreconcurrencyImport", as: .error),
]

let package = Package(
    name: "ReAIShipping",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "ReAIShipping", targets: ["ReAIShipping"])],
    // Sparkle supplies signed in-app updates and the privileged replacement/relaunch helpers.
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1"),
        .package(url: "https://github.com/swiftlang/swift-subprocess", exact: "1.0.2"),
    ],
    targets: [.executableTarget(name: "ReAIShipping", dependencies: ["Sparkle", .product(name: "Subprocess", package: "swift-subprocess")],
                               swiftSettings: swiftSettings,
                               linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])])],
    swiftLanguageModes: [.v6]
)
