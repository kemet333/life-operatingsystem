import AVFoundation
import Speech

struct NativeDictationRequest: Equatable {
    enum Action: String { case start, stop, cancel }
    let action: Action

    static func parse(_ body: Any) -> NativeDictationRequest? {
        guard let value = body as? [String: Any], Set(value.keys) == ["action"],
              let text = value["action"] as? String, let action = Action(rawValue: text) else { return nil }
        return NativeDictationRequest(action: action)
    }
}

/// Push-to-talk dictation for Alfred: Spanish (Spain), on-device whenever macOS supports it.
/// Audio lives only in memory for the recognizer; nothing is stored or sent by this app.
@MainActor
final class NativeDictation {
    enum State: String { case listening, partial, final, idle, unavailable }
    var onEvent: ((State, String?, String?) -> Void)?
    /// Called before the microphone opens (pause the clap detector, silence Alfred) and after it closes.
    var willStart: (() -> Void)?
    var didFinish: (() -> Void)?
    /// Live microphone loudness (RMS, ~20 times a second) so Alfred's orb can follow the owner's voice.
    var onLevel: ((Float) -> Void)?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "es-ES"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var latest = ""
    private var tapInstalled = false
    private var finishing: DispatchWorkItem?
    private var stopRequested = false
    private(set) var active = false

    func start() {
        guard !active else { return }
        stopRequested = false
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: break
        case .notDetermined:
            SFSpeechRecognizer.requestAuthorization { [weak self] status in
                DispatchQueue.main.async {
                    if status == .authorized { self?.start() } else { self?.onEvent?(.unavailable, nil, "speech-denied") }
                }
            }
            return
        default: onEvent?(.unavailable, nil, "speech-denied"); return
        }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: break
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted { self?.start() } else { self?.onEvent?(.unavailable, nil, "mic-denied") }
                }
            }
            return
        default: onEvent?(.unavailable, nil, "mic-denied"); return
        }
        guard let recognizer, recognizer.isAvailable else { onEvent?(.unavailable, nil, "recognizer-unavailable"); return }

        willStart?()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            didFinish?()
            onEvent?(.unavailable, nil, "no-input")
            return
        }
        var lastLevel = Date.distantPast
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            request.append(buffer)
            // Only a loudness number leaves this closure; the audio itself stays with the recognizer.
            guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0,
                  Date().timeIntervalSince(lastLevel) >= 0.05 else { return }
            lastLevel = Date()
            var sum: Float = 0
            for i in 0..<Int(buffer.frameLength) { sum += samples[i] * samples[i] }
            let rms = (sum / Float(buffer.frameLength)).squareRoot()
            DispatchQueue.main.async { self?.onLevel?(rms) }
        }
        tapInstalled = true
        do {
            engine.prepare()
            try engine.start()
        } catch {
            teardown()
            didFinish?()
            onEvent?(.unavailable, nil, "no-input")
            return
        }
        self.request = request
        latest = ""
        active = true
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let failed = error != nil
            DispatchQueue.main.async { self?.handle(text: text, isFinal: isFinal, failed: failed) }
        }
        onEvent?(.listening, nil, nil)
    }

    /// Release of the talk key: stop listening and deliver whatever was heard.
    func stop() {
        guard active, !stopRequested else { return }
        stopRequested = true
        stopAudio()
        request?.endAudio()
        // The recognizer usually reports a final result within a few hundred ms; never wait forever.
        let fallback = DispatchWorkItem { [weak self] in self?.finish() }
        finishing = fallback
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4, execute: fallback)
    }

    func cancel() {
        guard active else { return }
        task?.cancel()
        teardown()
        didFinish?()
        onEvent?(.idle, nil, "cancelled")
    }

    private func handle(text: String?, isFinal: Bool, failed: Bool) {
        guard active else { return }
        if let text { latest = text }
        if isFinal || (failed && stopRequested) { finish(); return }
        if failed { cancel(); return }
        if let text, !stopRequested { onEvent?(.partial, text, nil) }
    }

    private func finish() {
        guard active else { return }
        let text = latest.trimmingCharacters(in: .whitespacesAndNewlines)
        task?.finish()
        teardown()
        didFinish?()
        onEvent?(.final, text, nil)
    }

    private func stopAudio() {
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    }

    private func teardown() {
        finishing?.cancel(); finishing = nil
        stopAudio()
        request = nil
        task = nil
        active = false
        stopRequested = false
    }
}
