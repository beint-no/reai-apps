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
    name: "ReAIPOSPrintBridge",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "ReAIPOSPrintBridge", targets: ["ReAIPOSPrintBridge"])],
    targets: [.executableTarget(name: "ReAIPOSPrintBridge", swiftSettings: swiftSettings)],
    swiftLanguageModes: [.v6]
)
