import Foundation

@main struct AuthPolicyChecks {
    static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else { fatalError("FAIL: \(name)") }
        print("PASS: \(name)")
    }
    static func decision(_ text: String, main: Bool? = true, source: String? = "auth.openai.com",
                         scheme: String? = "https", top: String = "https://auth.openai.com/log-in",
                         clicked: Bool = false) -> NativeAuthPolicy.Decision {
        NativeAuthPolicy.decide(URL(string: text), mainFrame: main, clickedLink: clicked,
                                sourceHost: source, sourceScheme: scheme, topURL: URL(string: top))
    }
    static func main() {
        let privateURL = NativeAuthPolicy.workspace
        let browser = NativeAuthPolicy.browserURL(current: URL(string: privateURL.absoluteString + "?native=1&view=memory&state=opaque#token"), fallback: "now")
        check(browser.absoluteString == privateURL.absoluteString + "?view=memory", "browser URL strips every field except known view")
        check(NativeAuthPolicy.browserURL(current: URL(string: "https://evil.example/?view=map"), fallback: "bad").absoluteString == privateURL.absoluteString + "?view=now", "browser root cannot be substituted")
        check(decision("https://accounts.google.com/o/oauth2/auth") == .googleGate, "Google main frame gates")
        check(decision("https://accounts.google.com/o/oauth2/auth", main: nil) == .googleGate, "Google script popup gates")
        check(decision("https://auth.openai.com/authorize?connection=google-oauth2", main: nil) == .googleGate, "Google provider request gates before redirect")
        check(decision("https://accounts.google.com.evil.example/") == .cancel && decision("https://auth.openai.com@evil.example/") == .cancel, "lookalike and userinfo hosts rejected")
        check(["http://auth.openai.com/log-in", "file:///tmp/login", "javascript:alert(1)", "https://auth.openai.com:8443/log-in"].allSatisfy { decision($0) == .cancel }, "unsafe protocols and authority rejected")
        check(decision("https://sentinel.openai.com/backend-api/sentinel/frame.html", main: false) == .allow, "Sentinel allowed only as login subframe")
        check(decision("https://sentinel.openai.com/frame", main: false, source: "", scheme: "about") == .allow && decision("https://sentinel.openai.com/frame", main: false, source: "sentinel.openai.com") == .allow, "opaque initial frame and Sentinel redirect supported")
        check(decision("https://sentinel.openai.com/frame") == .cancel && decision("https://sentinel.openai.com/frame", main: nil) == .cancel && decision("https://sentinel.openai.com/frame", main: false, top: privateURL.absoluteString) == .cancel && decision("https://sentinel.openai.com/frame", main: false, source: "evil.example") == .cancel, "Sentinel root popup wrong-top and untrusted-source rejected")
        check(decision("https://auth.openai.com/log-in", main: nil) == .unsupportedPopup && decision("https://auth.openai.com/log-in") == .allow, "trusted popup is explained while normal provider page remains usable")
        check(decision("https://sentinel.openai.com/frame", main: false, top: "https://auth.openai.com/log-in/password") == .allow, "Sentinel remains available through later login steps")
        check(decision("https://openai.com/policies/privacy-policy", clicked: true) == .externalBrowser && decision("https://evil.example/", clicked: false) == .cancel, "explicit provider links open externally without allowing scripted redirects")
        var gate = NativeAuthGate()
        gate.loginFinished(); let initialGate = gate.reason == .login
        gate.tryAlternative(); gate.loginFinished(); let alternative = gate.reason == nil
        gate.googleRequested(); let googleCannotBypass = gate.reason == .google
        gate.workspaceLoaded(); let recovered = gate.reason == nil && !gate.permitsAlternative
        check(initialGate && alternative && googleCannotBypass && recovered, "gate recovery never bypasses Google restriction")
        print("14 auth policy checks passed. No HTTP, credentials or UI.")
    }
}
