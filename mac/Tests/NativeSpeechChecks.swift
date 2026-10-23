import Foundation

@main
struct NativeSpeechChecks {
    static func main() {
        var count = 0
        func check(_ condition: @autoclosure () -> Bool, _ name: String) {
            precondition(condition(), name); count += 1
        }
        let speak = NativeSpeechRequest.parse(["action": "speak", "text": "  Hola, Ana.\n", "id": "reply-1"])
        check(speak == NativeSpeechRequest(action: .speak, id: "reply-1", text: "Hola, Ana."), "valid speech and whitespace")
        check(NativeSpeechRequest.parse(["action": "stop", "id": "reply-1"])?.action == .stop, "valid stop")
        check(NativeSpeechRequest.parse(["action": "stop", "id": "ritual"])?.action == .stop, "ritual can be stopped explicitly")
        check(NativeSpeechRequest.parse(["action": "speak", "id": "ritual", "text": "hello"]) == nil, "ritual id reserved for native greeting")
        check(NativeSpeechRequest.parse(["action": "stop", "id": "reply-1", "text": "ignored"]) == nil, "stop must not carry text")
        check(NativeSpeechRequest.parse(["action": "download", "id": "reply-1"]) == nil, "unknown action")
        check(NativeSpeechRequest.parse(["action": "speak", "id": "reply-1", "text": 123]) == nil, "text type")
        check(NativeSpeechRequest.parse(["action": "speak", "id": "reply-1", "text": "\n \t"]) == nil, "empty trimmed text")
        check(NativeSpeechRequest.parse(["action": "speak", "id": "reply-1", "text": "hola\0mundo"]) == nil, "embedded control rejected")
        check(NativeSpeechRequest.parse(["action": "speak", "id": "reply-1", "text": String(repeating: "a", count: 8_001)]) == nil, "character cap")
        check(NativeSpeechRequest.parse(["action": "speak", "id": "reply-1", "text": "Hola\n\tmundo"]) != nil, "normal linebreak and tab")
        check(NativeSpeechRequest.parse(["action": "speak", "id": "reply-1", "text": "Hola", "url": "https://evil.invalid"]) == nil, "extra fields rejected")
        check(!NativeSpeechRequest.validID("x';alert(1)"), "id cannot inject JS")
        check(!NativeSpeechRequest.validID(String(repeating: "a", count: 81)), "id cap")
        check(NativeSpeechRequest.validID("reply_1.2:3-4"), "id allowed delimiters")
        let local = URL(string: "http://127.0.0.1:40123/")!
        func trusted(main: Bool = true, scheme: String = "http", host: String = "127.0.0.1", port: Int = 40123,
                     current: URL? = local, origin: URL? = local) -> Bool {
            NativeSpeechRequest.trusted(mainFrame: main, scheme: scheme, host: host, port: port, currentURL: current, origin: origin)
        }
        check(trusted(), "exact local origin")
        check(!trusted(main: false), "iframe denied")
        check(!trusted(host: "127.0.0.1.evil.invalid"), "host suffix denied")
        check(!trusted(port: 40124), "other port denied")
        check(!trusted(scheme: "https"), "other scheme denied")
        check(!trusted(current: URL(string: "https://example.invalid/")), "foreign top page denied")
        check(!trusted(current: URL(string: "http://user@127.0.0.1:40123/")), "userinfo denied")
        check(!trusted(origin: nil), "stopped server denied")
        let event = NativeSpeechEvent(state: .speaking, id: "reply-1", voice: "Jorge").dictionary
        check(event["state"] == "speaking" && event["id"] == "reply-1" && event["text"] == nil, "event carries state without prose")
        print("Native speech checks: \(count) passed. No capture, playback or network.")
    }
}
