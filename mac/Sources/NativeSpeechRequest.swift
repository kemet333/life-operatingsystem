import Foundation

struct NativeSpeechRequest: Equatable {
    enum Action: String { case speak, stop }
    let action: Action
    let id: String
    let text: String?

    static func validID(_ value: String) -> Bool {
        (1...80).contains(value.utf8.count) && value.utf8.allSatisfy {
            (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) ||
                [45, 46, 58, 95].contains($0)
        }
    }

    static func parse(_ body: Any) -> NativeSpeechRequest? {
        guard let value = body as? [String: Any], Set(value.keys).isSubset(of: ["action", "id", "text"]),
              let actionText = value["action"] as? String, let action = Action(rawValue: actionText),
              let id = value["id"] as? String, validID(id) else { return nil }
        if action == .stop {
            guard value["text"] == nil else { return nil }
            return NativeSpeechRequest(action: action, id: id, text: nil)
        }
        guard id != "ritual", let raw = value["text"] as? String, raw.utf8.count <= 32_000 else { return nil }
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...8_000).contains(text.count), !text.unicodeScalars.contains(where: {
            CharacterSet.controlCharacters.contains($0) && $0 != "\n" && $0 != "\t" && $0 != "\r"
        }) else { return nil }
        return NativeSpeechRequest(action: action, id: id, text: text)
    }

    static func trusted(mainFrame: Bool, scheme: String, host: String, port: Int,
                        currentURL: URL?, origin: URL?) -> Bool {
        guard mainFrame, scheme == "http", host == "127.0.0.1", let origin,
              origin.scheme == "http", origin.host == "127.0.0.1", origin.port == port,
              let currentURL, currentURL.scheme == origin.scheme, currentURL.host == origin.host,
              currentURL.port == port, currentURL.user == nil, currentURL.password == nil else { return false }
        return true
    }
}

struct NativeSpeechEvent {
    enum State: String { case speaking, idle, unavailable }
    let state: State
    let id: String
    var reason: String?
    var voice: String?
    var dictionary: [String: String] {
        var result = ["state": state.rawValue, "id": id]
        if let reason { result["reason"] = reason }
        if let voice { result["voice"] = voice }
        return result
    }
}

struct AlfredVoiceOption: Identifiable {
    let id: String
    let name: String
    let language: String
    let quality: Int
    let gender: String
    var label: String {
        let qualityName = quality == 3 ? "premium" : quality == 2 ? "mejorada" : "estándar"
        return "\(name) · \(language) · \(qualityName) · \(gender)"
    }
}
