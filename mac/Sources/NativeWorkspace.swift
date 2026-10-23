import AppKit
import Combine
import WebKit

enum WorkspaceSection: String, CaseIterable, Identifiable {
    case now, map, projects, activity, memory, trends, ritual
    var id: String { rawValue }
}

@MainActor
private final class NativeSpeechRelay: NSObject, WKScriptMessageHandler {
    weak var workspace: NativeWorkspace?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        workspace?.receiveSpeech(message)
    }
}

@MainActor
private final class NativeVoiceActivityRelay: NSObject, WKScriptMessageHandler {
    weak var workspace: NativeWorkspace?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        workspace?.receiveVoiceActivity(message)
    }
}

@MainActor
private final class NativeDictationRelay: NSObject, WKScriptMessageHandler {
    weak var workspace: NativeWorkspace?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        workspace?.receiveDictation(message)
    }
}

@MainActor
final class NativeWorkspace: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    private static let webCopy = URL(string: "https://localhost/")!
    let webView: WKWebView
    let server = LocalWorkspaceServer()
    @Published var isLoading = true
    @Published var lastError: String?
    @Published private(set) var selected: WorkspaceSection = .now
    @Published private(set) var browserMessage: String?
    private var lastWorkspaceOrigin: URL?
    private let speechRelay: NativeSpeechRelay
    private let dictationRelay: NativeDictationRelay
    private let activityRelay: NativeVoiceActivityRelay
    let dictation = NativeDictation()
    private weak var audio: RitualController?
    var blocksWorkspace: Bool { server.state != .ready || lastError != nil }

    override init() {
        let relay = NativeSpeechRelay()
        speechRelay = relay
        let micRelay = NativeDictationRelay()
        dictationRelay = micRelay
        let voiceActivity = NativeVoiceActivityRelay()
        activityRelay = voiceActivity
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.userContentController.add(relay, name: "nativeSpeech")
        configuration.userContentController.add(micRelay, name: "nativeDictation")
        configuration.userContentController.add(voiceActivity, name: "nativeVoiceActivity")
        // Alfred's neural voice plays from the page as soon as a reply streams in.
        configuration.mediaTypesRequiringUserActionForPlayback = []
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        relay.workspace = self
        micRelay.workspace = self
        voiceActivity.workspace = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.appearance = NSAppearance(named: .darkAqua)
        webView.underPageBackgroundColor = NSColor(calibratedRed: 9/255, green: 10/255, blue: 12/255, alpha: 1)
        // The page paints its own (translucent) tint over the window glass, so the web view draws no background.
        webView.setValue(false, forKey: "drawsBackground")
        server.onReady = { [weak self] in
            guard let self else { return }
            self.rememberDisplayedView()
            self.lastWorkspaceOrigin = self.server.origin
            self.loadInitial()
        }
        server.onFailure = { [weak self] message in
            self?.audio?.stopConversation()
            self?.isLoading = false
            self?.lastError = message
        }
        loadInitial()
    }

    func loadInitial() {
        rememberDisplayedView()
        lastError = nil
        browserMessage = nil
        isLoading = true
        if server.state == .ready, let request = server.startupRequest(view: selected.rawValue) {
            webView.load(request)
        } else if server.state != .starting {
            server.start()
        }
    }

    func stop() { dictation.cancel(); audio?.stopConversation(); webView.stopLoading(); server.stop() }

    func connectSpeech(to controller: RitualController) {
        audio = controller
        controller.onNativeSpeechEvent = { [weak self] event in self?.dispatchSpeech(event) }
        controller.neuralGreeting = { [weak self] text, done in
            guard let self else { done(false); return }
            self.speakRitualGreeting(text, done: done)
        }
        dictation.willStart = { [weak controller] in controller?.beginDictation() }
        dictation.didFinish = { [weak controller] in controller?.endDictation() }
        dictation.onEvent = { [weak self] state, text, reason in self?.dispatchDictation(state, text: text, reason: reason) }
        dictation.onLevel = { [weak self] level in self?.dispatchMicLevel(level) }
    }

    fileprivate func receiveVoiceActivity(_ message: WKScriptMessage) {
        let source = message.frameInfo.securityOrigin
        guard message.webView === webView,
              NativeSpeechRequest.trusted(mainFrame: message.frameInfo.isMainFrame,
                scheme: source.protocol, host: source.host, port: source.port,
                currentURL: webView.url, origin: server.origin),
              let body = message.body as? [String: Any], Set(body.keys) == ["active"],
              let active = body["active"] as? Bool else { return }
        audio?.setExternalSpeech(active)
    }

    fileprivate func receiveDictation(_ message: WKScriptMessage) {
        let source = message.frameInfo.securityOrigin
        guard message.webView === webView,
              NativeSpeechRequest.trusted(mainFrame: message.frameInfo.isMainFrame,
                scheme: source.protocol, host: source.host, port: source.port,
                currentURL: webView.url, origin: server.origin),
              let request = NativeDictationRequest.parse(message.body) else { return }
        switch request.action {
        case .start: dictation.start()
        case .stop: dictation.stop()
        case .cancel: dictation.cancel()
        }
    }

    private func dispatchMicLevel(_ level: Float) {
        guard let current = webView.url, isLocal(current), let origin = server.origin,
              let originJSON = jsonString(origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))) else { return }
        let value = String(format: "%.4f", min(1, max(0, level)))
        webView.evaluateJavaScript("if (location.origin === \(originJSON)) { window.dispatchEvent(new CustomEvent('alfred:native-mic', {detail: {level: \(value)}})); }")
    }

    private func dispatchDictation(_ state: NativeDictation.State, text: String?, reason: String?) {
        var detail = ["state": state.rawValue]
        if let text { detail["text"] = text }
        if let reason { detail["reason"] = reason }
        guard let current = webView.url, isLocal(current), let origin = server.origin,
              let originJSON = jsonString(origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))),
              let data = try? JSONSerialization.data(withJSONObject: detail),
              let detailJSON = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("if (location.origin === \(originJSON)) { window.dispatchEvent(new CustomEvent('alfred:native-dictation', {detail: \(detailJSON)})); }")
    }

    fileprivate func receiveSpeech(_ message: WKScriptMessage) {
        let source = message.frameInfo.securityOrigin
        guard message.webView === webView,
              NativeSpeechRequest.trusted(mainFrame: message.frameInfo.isMainFrame,
                scheme: source.protocol, host: source.host, port: source.port,
                currentURL: webView.url, origin: server.origin) else { return }
        guard let request = NativeSpeechRequest.parse(message.body) else {
            if let value = message.body as? [String: Any], let id = value["id"] as? String,
               NativeSpeechRequest.validID(id) {
                dispatchSpeech(NativeSpeechEvent(state: .unavailable, id: id, reason: "invalid-request"))
            }
            return
        }
        guard let audio else {
            dispatchSpeech(NativeSpeechEvent(state: .unavailable, id: request.id, reason: "audio-not-ready"))
            return
        }
        switch request.action {
        case .speak: audio.speakConversation(text: request.text!, id: request.id)
        case .stop: audio.stopConversation(id: request.id)
        }
    }

    /// The page plays the ritual greeting with the ElevenLabs voice when it can (true); otherwise the Mac speaks it.
    /// Right after launch the page may still be loading: wait for it up to six seconds before giving up.
    private func speakRitualGreeting(_ text: String, done: @escaping (Bool) -> Void, until deadline: Date? = nil) {
        let deadline = deadline ?? Date().addingTimeInterval(6)
        let retry = { [weak self] in
            guard let self, Date() < deadline else { done(false); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.speakRitualGreeting(text, done: done, until: deadline) }
        }
        guard let textJSON = jsonString(text) else { done(false); return }
        guard let current = webView.url, isLocal(current), let origin = server.origin,
              let originJSON = jsonString(origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))) else { retry(); return }
        let script = "(location.origin === \(originJSON) && typeof window.alfredRitual === 'function') ? (window.alfredRitual(\(textJSON)) === true ? 'ok' : 'no') : 'wait'"
        webView.evaluateJavaScript(script) { result, _ in
            switch result as? String {
            case "ok": done(true)
            case "no": done(false)
            default: retry()
            }
        }
    }

    private func dispatchSpeech(_ event: NativeSpeechEvent) {
        guard let current = webView.url, isLocal(current), let origin = server.origin,
              let originJSON = jsonString(origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))),
              let data = try? JSONSerialization.data(withJSONObject: event.dictionary),
              let detailJSON = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("if (location.origin === \(originJSON)) { window.dispatchEvent(new CustomEvent('alfred:native-speech', {detail: \(detailJSON)})); }")
    }

    func select(_ section: WorkspaceSection) {
        guard section != .ritual else { return }
        selected = section
        guard let current = webView.url, isLocal(current), current.path == "/" else {
            if server.state == .ready { loadInitial() }
            return
        }
        navigateWithinWorkspace()
    }

    private func navigateWithinWorkspace() {
        guard let origin = server.origin,
              let originJSON = jsonString(origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))),
              let viewJSON = jsonString(selected.rawValue) else { return }
        let script = """
        (() => {
          if (location.origin !== \(originJSON)) return false;
          const view = \(viewJSON), url = new URL(location.href);
          url.searchParams.set('native', '1'); url.searchParams.set('view', view);
          history.pushState({}, '', url.href);
          dispatchEvent(new PopStateEvent('popstate'));
          dispatchEvent(new CustomEvent('alfred:native-view', {detail:{view}}));
          return true;
        })()
        """
        webView.evaluateJavaScript(script) { [weak self] _, error in
            if error != nil { self?.lastError = "No se ha podido cambiar de vista. Vuelve a intentarlo." }
        }
    }

    private func jsonString(_ value: String) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func isLocal(_ url: URL) -> Bool {
        matches(url, origin: server.origin)
    }

    private func matches(_ url: URL, origin: URL?) -> Bool {
        guard let origin else { return false }
        return url.scheme == "http" && url.host == "127.0.0.1" && url.port == origin.port &&
            url.user == nil && url.password == nil
    }

    private func rememberDisplayedView() {
        guard let current = webView.url, matches(current, origin: lastWorkspaceOrigin), current.path == "/",
              let components = URLComponents(url: current, resolvingAgainstBaseURL: false),
              let value = components.queryItems?.first(where: { $0.name == "view" })?.value,
              let section = WorkspaceSection(rawValue: value), section != .ritual else { return }
        selected = section
    }

    /// The separately hosted copy has its own session and data; it is never a fallback.
    func openInBrowser() {
        rememberDisplayedView()
        var target = URLComponents(url: Self.webCopy, resolvingAgainstBaseURL: false)!
        target.queryItems = [URLQueryItem(name: "view", value: selected.rawValue)]
        browserMessage = NSWorkspace.shared.open(target.url!)
            ? "La copia web se ha abierto en el navegador. Tiene su propia sesión y datos."
            : "No se ha podido abrir la copia web."
    }

    func reload() {
        audio?.stopConversation()
        rememberDisplayedView()
        lastError = nil
        if server.state == .ready, let current = webView.url, isLocal(current) {
            isLoading = true
            webView.reload()
        } else { loadInitial() }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        audio?.stopConversation()
        isLoading = true; lastError = nil
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isLoading = false
        if let current = webView.url, isLocal(current), current.path == "/" { rememberDisplayedView() }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { report(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { report(error) }
    private func report(_ error: Error) {
        isLoading = false
        if (error as NSError).code != NSURLErrorCancelled {
            lastError = "No se ha podido cargar tu espacio en este Mac. Tus datos siguen en la carpeta local."
        }
    }

    private func opensExternalLink(_ action: WKNavigationAction) -> Bool {
        guard action.navigationType == .linkActivated,
              let url = action.request.url, url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil,
              let current = webView.url, isLocal(current),
              let origin = server.origin,
              action.sourceFrame.securityOrigin.protocol == "http",
              action.sourceFrame.securityOrigin.host == "127.0.0.1",
              action.sourceFrame.securityOrigin.port == origin.port else { return false }
        return true
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, isLocal(url), action.navigationType == .linkActivated {
            webView.load(action.request)
        } else if opensExternalLink(action), let url = action.request.url {
            if !NSWorkspace.shared.open(url) { browserMessage = "No se ha podido abrir el enlace." }
        }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.absoluteString == "about:blank" || isLocal(url) {
            decisionHandler(.allow)
        } else {
            if opensExternalLink(action), !NSWorkspace.shared.open(url) {
                browserMessage = "No se ha podido abrir el enlace."
            }
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }
}
