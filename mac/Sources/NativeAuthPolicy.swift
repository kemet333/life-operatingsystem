import Foundation

enum NativeAuthPolicy {
    static let workspace = URL(string: "https://localhost/")!
    static let views: Set<String> = ["now", "map", "projects", "activity", "memory", "trends"]
    static let authHosts: Set<String> = ["chatgpt.com", "chat.openai.com", "auth.openai.com", "auth0.openai.com",
        "appleid.apple.com", "login.microsoftonline.com", "login.live.com"]
    enum Decision: Equatable { case allow, googleGate, unsupportedPopup, externalBrowser, cancel }

    static func https(_ url: URL, host: String) -> Bool {
        url.scheme?.lowercased() == "https" && url.host?.lowercased() == host &&
        (url.port == nil || url.port == 443) && url.user == nil && url.password == nil
    }
    static func loginPage(_ url: URL) -> Bool {
        guard https(url, host: "auth.openai.com") else { return false }
        return ["/log-in", "/login", "/sign-in", "/u/login", "/u/login/identifier", "/u/login/password"].contains(url.path)
    }
    static func google(_ url: URL) -> Bool {
        if https(url, host: "accounts.google.com") { return true }
        guard let host = url.host?.lowercased(), authHosts.contains(host), https(url, host: host),
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return false }
        return items.contains { item in
            ["connection", "provider", "identity_provider", "idp"].contains(item.name.lowercased()) &&
            ["google", "google-oauth2"].contains(item.value?.lowercased() ?? "")
        }
    }
    static func decide(_ url: URL?, mainFrame: Bool?, clickedLink: Bool,
                       sourceHost: String?, sourceScheme: String?, topURL: URL?) -> Decision {
        guard let url else { return mainFrame == nil ? .unsupportedPopup : .cancel }
        if google(url) { return .googleGate }
        let popup = mainFrame == nil
        if https(url, host: "sentinel.openai.com") {
            guard mainFrame == false, let topURL, https(topURL, host: "auth.openai.com") else { return .cancel }
            let host = sourceHost?.lowercased() ?? "", scheme = sourceScheme?.lowercased() ?? ""
            // Initial blank frames can have an opaque origin. Subsequent challenge
            // navigation can originate in Sentinel itself. Both remain inside an
            // existing subframe under the exact OpenAI authentication origin, never a popup.
            let sourceOK = (["auth.openai.com", "sentinel.openai.com"].contains(host) && scheme == "https") ||
                (host.isEmpty && ["", "about", "https"].contains(scheme))
            return sourceOK ? .allow : .cancel
        }
        if url.scheme == "about", url.path == "blank", !popup { return .allow }
        guard let host = url.host?.lowercased(), https(url, host: host) else { return .cancel }
        if host == workspace.host || authHosts.contains(host) { return popup ? .unsupportedPopup : .allow }
        if clickedLink, let sourceHost = sourceHost?.lowercased(), sourceScheme == "https",
           sourceHost == workspace.host || authHosts.contains(sourceHost) { return .externalBrowser }
        return .cancel
    }
    static func browserURL(current: URL?, fallback: String) -> URL {
        var view = views.contains(fallback) ? fallback : "now"
        if let current, https(current, host: workspace.host!), current.path == "/",
           let candidate = URLComponents(url: current, resolvingAgainstBaseURL: false)?.queryItems?
            .first(where: { $0.name == "view" })?.value, views.contains(candidate) { view = candidate }
        var result = URLComponents(url: workspace, resolvingAgainstBaseURL: false)!
        result.queryItems = [URLQueryItem(name: "view", value: view)]
        return result.url!
    }
}

enum NativeAuthGateReason: Equatable { case login, google, unsupportedPopup }
struct NativeAuthGate {
    private(set) var reason: NativeAuthGateReason?
    private(set) var permitsAlternative = false
    mutating func loginFinished() { if !permitsAlternative && reason == nil { reason = .login } }
    mutating func googleRequested() { reason = .google }
    mutating func popupUnsupported() { reason = .unsupportedPopup }
    mutating func tryAlternative() { reason = nil; permitsAlternative = true }
    mutating func workspaceLoaded() { reason = nil; permitsAlternative = false }
}
