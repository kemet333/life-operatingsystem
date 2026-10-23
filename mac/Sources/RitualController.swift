import AppKit
import AVFoundation
import Combine
import UniformTypeIdentifiers

private final class AcousticPulseProcessor {
    private let lock = NSLock()
    private var detector = DoubleClapDetector()

    func reset(at time: TimeInterval) {
        lock.lock(); defer { lock.unlock() }
        detector.reset(at: time, settleFor: 1.0, keepCooldown: true)
    }

    func process(_ buffer: AVAudioPCMBuffer, at time: AVAudioTime) -> (Bool, [DoubleClapDetector.Event]) {
        lock.lock(); defer { lock.unlock() }
        var didTrigger = false
        AudioWindowFeatures.forEachWindow(in: buffer, at: time) { frame in
            if detector.process(rms: frame.rms, peak: frame.peak, time: frame.time,
                                highFrequencyRatio: frame.highFrequencyRatio) {
                didTrigger = true
                detector.suppress(until: frame.time + 8)
            }
        }
        return (didTrigger, detector.takeEvents())
    }
}

/// Local tuning log for the snap detector (Workspace/chasquidos.log): level, peak and brightness of each loud
/// onset and what the detector decided. Numbers only — no audio is kept or sent. Written off the audio thread.
private enum SnapLog {
    static let queue = DispatchQueue(label: "lifeos.snaplog", qos: .utility)
    static let file: URL? = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                         appropriateFor: nil, create: false)
        .appendingPathComponent("com.lifeoperatingsystem.app/Workspace/chasquidos.log")
    static func write(_ events: [DoubleClapDetector.Event]) {
        guard let file, !events.isEmpty else { return }
        let stamp = ISO8601DateFormatter().string(from: Date())
        let text = events.map { String(format: "%@ rms %.4f pico %.3f brillo %.2f %@\n", stamp, $0.rms, $0.peak, $0.brightness, $0.verdict) }.joined()
        queue.async {
            if let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int), size > 200_000 {
                try? FileManager.default.removeItem(at: file.appendingPathExtension("1"))
                try? FileManager.default.moveItem(at: file, to: file.appendingPathExtension("1"))
            }
            guard let data = text.data(using: .utf8) else { return }
            if let handle = try? FileHandle(forWritingTo: file) {
                defer { try? handle.close() }
                _ = try? handle.seekToEnd(); try? handle.write(contentsOf: data)
            } else { try? data.write(to: file) }
        }
    }
}

@MainActor
final class RitualController: NSObject, ObservableObject, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {
    static let defaultGreeting = "Buenos días. Todo listo cuando quieras."
    @Published private(set) var wantsListening = false
    @Published private(set) var captureRunning = false
    @Published private(set) var status = "Micrófono apagado"
    @Published private(set) var detail = "Actívalo cuando quieras usar los dos chasquidos."
    @Published private(set) var isPlaying = false
    @Published private(set) var trackName = "Ninguna pista seleccionada"
    @Published private(set) var availableVoices: [AlfredVoiceOption] = []
    @Published var voiceIdentifier: String {
        didSet { UserDefaults.standard.set(voiceIdentifier, forKey: "ritual.voiceIdentifier") }
    }
    @Published var greeting: String {
        didSet { UserDefaults.standard.set(greeting, forKey: "ritual.greeting") }
    }
    @Published var musicVolume: Double {
        didSet {
            UserDefaults.standard.set(musicVolume, forKey: "ritual.musicVolume")
            player?.volume = Float(musicVolume * (activeUtterance == nil ? 1 : 0.45))
        }
    }
    @Published var voiceVolume: Double {
        didSet { UserDefaults.standard.set(voiceVolume, forKey: "ritual.voiceVolume") }
    }
    var showMainWindow: (() -> Void)?
    var onNativeSpeechEvent: ((NativeSpeechEvent) -> Void)?
    /// Speaks the ritual greeting with Alfred's ElevenLabs voice through the page; false = use the Mac's voice.
    var neuralGreeting: ((String, @escaping (Bool) -> Void) -> Void)?
    private let engine = AVAudioEngine()
    /// True while Alfred dictation owns the microphone; the clap detector must not reopen it.
    private var dictating = false
    /// True while the page plays Alfred's neural voice.
    private var externalSpeech = false
    private let processor = AcousticPulseProcessor()
    private let speech = AVSpeechSynthesizer()
    private var activeUtterance: AVSpeechUtterance?
    private var conversationIDs: [ObjectIdentifier: String] = [:]
    private var player: AVAudioPlayer?
    private var trackURL: URL?
    private var scopedTrack: URL?
    private var tapInstalled = false
    private var resumeWork: DispatchWorkItem?
    private var lastActivation: TimeInterval = -.infinity
    private let cooldown: TimeInterval = 8
    private var captureGeneration = UUID()
    private var systemSleeping = false
    private var observers: [(NotificationCenter, NSObjectProtocol)] = []

    override init() {
        greeting = UserDefaults.standard.string(forKey: "ritual.greeting") ?? Self.defaultGreeting
        voiceIdentifier = UserDefaults.standard.string(forKey: "ritual.voiceIdentifier") ?? ""
        let storedMusic = UserDefaults.standard.object(forKey: "ritual.musicVolume") as? Double
        let storedVoice = UserDefaults.standard.object(forKey: "ritual.voiceVolume") as? Double
        musicVolume = min(0.7, max(0, storedMusic ?? 0.32))
        voiceVolume = min(0.8, max(0.1, storedVoice ?? 0.65))
        super.init()
        speech.delegate = self
        refreshVoices()
        let audioCenter = NotificationCenter.default
        let audioObserver = audioCenter.addObserver(forName: .AVAudioEngineConfigurationChange,
                                                     object: engine, queue: nil) { [weak self] _ in
            DispatchQueue.main.async { self?.inputConfigurationChanged() }
        }
        observers.append((audioCenter, audioObserver))
        let workspaceCenter = NSWorkspace.shared.notificationCenter
        let sleepObserver = workspaceCenter.addObserver(forName: NSWorkspace.willSleepNotification,
                                                       object: nil, queue: .main) { [weak self] _ in
            DispatchQueue.main.async { self?.willSleep() }
        }
        let wakeObserver = workspaceCenter.addObserver(forName: NSWorkspace.didWakeNotification,
                                                      object: nil, queue: .main) { [weak self] _ in
            DispatchQueue.main.async { self?.didWake() }
        }
        observers.append((workspaceCenter, sleepObserver))
        observers.append((workspaceCenter, wakeObserver))
        if let bookmark = UserDefaults.standard.data(forKey: "ritual.trackBookmark") {
            var stale = false
            if let url = try? URL(resolvingBookmarkData: bookmark, options: [.withSecurityScope, .withoutUI],
                                  relativeTo: nil, bookmarkDataIsStale: &stale) {
                trackURL = url
                trackName = url.lastPathComponent
            }
        }
        // The owner (05/10/2026): the two-snap ritual must work at every launch, so their listening choice is kept.
        // It only resumes if he had switched it on and macOS already allows the microphone; nothing is asked at launch.
        if UserDefaults.standard.bool(forKey: "ritual.listening"),
           AVCaptureDevice.authorizationStatus(for: .audio) == .authorized {
            DispatchQueue.main.async { [weak self] in self?.setListening(true) }
        }
    }

    deinit { for (center, observer) in observers { center.removeObserver(observer) } }

    private func inputConfigurationChanged() {
        guard captureRunning, !systemSleeping else { return }
        stopCapture()
        if wantsListening && !isPlaying { startCapture() }
    }

    private func willSleep() {
        systemSleeping = true
        resumeWork?.cancel(); resumeWork = nil
        stopCapture(); stopOutputs()
        status = wantsListening ? "Escucha en pausa · Mac dormido" : "Micrófono apagado"
        detail = "Al despertar, la escucha solo vuelve si ya la habías activado."
    }

    private func didWake() {
        systemSleeping = false
        if wantsListening { beginListeningIfPossible() }
    }

    func setListening(_ enabled: Bool) {
        resumeWork?.cancel(); resumeWork = nil
        wantsListening = enabled
        UserDefaults.standard.set(enabled, forKey: "ritual.listening")
        if !enabled {
            stopCapture()
            status = isPlaying ? "Ritual en reproducción · micro apagado" : "Micrófono apagado"
            detail = "La escucha está desactivada."
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: beginListeningIfPossible()
        case .notDetermined:
            status = "Esperando permiso de micrófono"
            detail = "macOS te pedirá acceso para detectar los chasquidos."
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self, self.wantsListening else { return }
                    if granted { self.beginListeningIfPossible() } else { self.permissionDenied() }
                }
            }
        case .denied, .restricted: permissionDenied()
        @unknown default: permissionDenied()
        }
    }

    private func beginListeningIfPossible() {
        if isPlaying {
            status = "Escucha en pausa"
            detail = "Se activará al terminar la música y la voz de Alfred."
        } else { startCapture() }
    }

    private func permissionDenied() {
        wantsListening = false
        status = "Sin permiso de micrófono"
        detail = "Puedes concederlo en Ajustes del Sistema → Privacidad y seguridad → Micrófono."
    }

    private func startCapture() {
        guard wantsListening, !isPlaying, !captureRunning, !systemSleeping, !dictating, !externalSpeech else { return }
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else { permissionDenied(); return }
        stopCapture()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            wantsListening = false
            status = "No hay entrada de audio disponible"
            detail = "Comprueba el micrófono elegido en Ajustes del Sistema → Sonido."
            return
        }
        processor.reset(at: AudioWindowFeatures.monotonicNow)
        let signal = processor
        let generation = captureGeneration
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, time in
            // Only transient RMS/peak levels are computed. No audio is saved, copied to a file or transmitted.
            let (triggered, events) = signal.process(buffer, at: time)
            SnapLog.write(events)
            if triggered {
                DispatchQueue.main.async {
                    guard let self, self.captureGeneration == generation else { return }
                    self.detectedDoubleClap()
                }
            }
        }
        tapInstalled = true
        do {
            engine.prepare()
            try engine.start()
            captureRunning = true
            status = "Escuchando dos chasquidos"
            detail = "Dos chasquidos (o palmadas) con una pausa breve, de un cuarto de segundo a un segundo. El detector descansa 8 segundos después."
        } catch {
            stopCapture()
            wantsListening = false
            status = "No se ha podido activar el micrófono"
            detail = error.localizedDescription
        }
    }

    private func stopCapture() {
        captureGeneration = UUID()
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        captureRunning = false
    }

    private func detectedDoubleClap() {
        guard wantsListening, captureRunning, !isPlaying,
              AudioWindowFeatures.monotonicNow - lastActivation >= cooldown else { return }
        runRitual(includeMusic: true)
    }

    func testGreeting() { runRitual(includeMusic: false) }
    func testRitual() { runRitual(includeMusic: true) }

    func refreshVoices() {
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("es-") }
        availableVoices = voices.map { voice in
            AlfredVoiceOption(id: voice.identifier, name: voice.name, language: voice.language,
                quality: voice.quality.rawValue,
                gender: voice.gender == .male ? "masculina" : voice.gender == .female ? "femenina" : "género no indicado")
        }.sorted {
            if ($0.gender == "masculina") != ($1.gender == "masculina") { return $0.gender == "masculina" }
            if $0.quality != $1.quality { return $0.quality > $1.quality }
            if ($0.language == "es-ES") != ($1.language == "es-ES") { return $0.language == "es-ES" }
            return $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
        if voiceIdentifier.isEmpty, let preferred = availableVoices.first(where: { $0.gender == "masculina" }) {
            voiceIdentifier = preferred.id
        }
    }

    var selectedVoiceLabel: String {
        availableVoices.first(where: { $0.id == voiceIdentifier })?.label ?? "Ninguna voz seleccionada"
    }
    var voiceAvailable: Bool { selectedVoice() != nil }
    var voiceHelp: String {
        if voiceIdentifier.isEmpty {
            return "No hay una voz española marcada masculina instalada. Añade una en las voces de macOS o elige una alternativa explícitamente."
        }
        if !voiceAvailable { return "La voz elegida ya no está disponible. Actualiza la lista o elige otra; no se cambia por una voz femenina automáticamente." }
        return "Voz local de macOS, con ritmo pausado. La misma voz se usa para Alfred y para tu saludo."
    }
    private func selectedVoice() -> AVSpeechSynthesisVoice? {
        guard !voiceIdentifier.isEmpty, availableVoices.contains(where: { $0.id == voiceIdentifier }) else { return nil }
        return AVSpeechSynthesisVoice(identifier: voiceIdentifier)
    }

    private func utterance(_ text: String, voice: AVSpeechSynthesisVoice) -> AVSpeechUtterance {
        let result = AVSpeechUtterance(string: text)
        result.voice = voice
        result.volume = Float(voiceVolume)
        result.rate = AVSpeechUtteranceDefaultSpeechRate * 0.9
        result.pitchMultiplier = 0.92
        return result
    }

    func speakConversation(text: String, id: String) {
        refreshVoices()
        guard let voice = selectedVoice() else {
            onNativeSpeechEvent?(NativeSpeechEvent(state: .unavailable, id: id, reason: "voice-unavailable"))
            return
        }
        resumeWork?.cancel(); resumeWork = nil
        stopCapture()
        activeUtterance = nil
        speech.stopSpeaking(at: .immediate)
        isPlaying = true
        status = "Alfred prepara su respuesta · micro apagado"
        detail = "La escucha está detenida durante la voz y se reanuda solo si la habías activado."
        let response = utterance(text, voice: voice)
        activeUtterance = response
        conversationIDs[ObjectIdentifier(response)] = id
        player?.volume = Float(musicVolume * 0.45)
        speech.speak(response)
    }

    func stopConversation(id: String? = nil) {
        guard let activeUtterance, let current = conversationIDs[ObjectIdentifier(activeUtterance)],
              id == nil || id == current else {
            if let id { onNativeSpeechEvent?(NativeSpeechEvent(state: .idle, id: id, reason: "not-current")) }
            return
        }
        // didCancel reports the real end of speech. Capture remains off until that callback.
        if !speech.stopSpeaking(at: .immediate) {
            conversationIDs.removeValue(forKey: ObjectIdentifier(activeUtterance))
            self.activeUtterance = nil
            onNativeSpeechEvent?(NativeSpeechEvent(state: .idle, id: current, reason: "stopped"))
            player?.volume = Float(musicVolume)
            finishIfSilent()
        }
    }

    func openVoiceSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.universalaccess") {
            NSWorkspace.shared.open(url)
        }
    }

    private func runRitual(includeMusic: Bool) {
        resumeWork?.cancel(); resumeWork = nil
        stopCapture()
        stopOutputs()
        lastActivation = AudioWindowFeatures.monotonicNow
        showMainWindow?()
        isPlaying = true
        status = "Ritual de inicio"
        detail = "El micrófono está detenido mientras se reproduce música o voz."
        if includeMusic, let url = trackURL {
            if url.startAccessingSecurityScopedResource() { scopedTrack = url }
            do {
                let music = try AVAudioPlayer(contentsOf: url)
                music.delegate = self
                music.volume = Float(musicVolume * 0.45)
                music.prepareToPlay()
                guard music.play() else { throw NSError(domain: "LifeOS", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "La pista seleccionada no se ha podido reproducir."]) }
                player = music
            } catch {
                detail = "Música no disponible: \(error.localizedDescription). Se mantiene el saludo."
                releaseTrackAccess()
            }
        }
        let text = greeting.trimmingCharacters(in: .whitespacesAndNewlines)
        // Alfred's own voice (ElevenLabs, through the page) first; the Mac's voice only if the page cannot.
        if !text.isEmpty, let neural = neuralGreeting {
            let ritual = lastActivation
            neural(text) { [weak self] accepted in
                DispatchQueue.main.async {
                    guard let self, self.lastActivation == ritual, self.isPlaying else { return }
                    if !accepted { self.speakGreeting(text) }
                    self.finishIfSilent()
                }
            }
            return
        }
        speakGreeting(text)
        finishIfSilent()
    }

    private func speakGreeting(_ text: String) {
        refreshVoices()
        if !text.isEmpty, let voice = selectedVoice() {
            let spokenGreeting = utterance(text, voice: voice)
            activeUtterance = spokenGreeting
            conversationIDs[ObjectIdentifier(spokenGreeting)] = "ritual"
            speech.speak(spokenGreeting)
        } else if text.isEmpty {
            detail = "La frase está vacía. Puedes escribirla en estos ajustes."
        } else {
            detail = voiceHelp
        }
    }

    private func finishIfSilent() {
        guard player == nil, activeUtterance == nil else { return }
        isPlaying = false
        status = wantsListening ? "Descanso del detector" : "Ritual terminado · micro apagado"
        detail = wantsListening ? "La escucha volverá tras el descanso; durante este tiempo no se captura audio." : "Puedes volver a probarlo cuando quieras."
        guard wantsListening else { return }
        let delay = max(0.8, lastActivation + cooldown - AudioWindowFeatures.monotonicNow)
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.wantsListening, !self.isPlaying else { return }
            self.startCapture()
        }
        resumeWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func stopOutputs() {
        activeUtterance = nil
        speech.stopSpeaking(at: .immediate)
        player?.stop(); player = nil
        releaseTrackAccess()
        isPlaying = false
    }

    /// Push-to-talk needs the microphone: park the clap detector and silence Alfred, then hand it back.
    func beginDictation() {
        dictating = true
        resumeWork?.cancel(); resumeWork = nil
        stopConversation()
        stopCapture()
    }

    func endDictation() {
        dictating = false
        if wantsListening { beginListeningIfPossible() }
    }

    /// The page is playing Alfred's neural voice: duck the ritual music and rest the clap detector meanwhile.
    func setExternalSpeech(_ active: Bool) {
        externalSpeech = active
        if active {
            resumeWork?.cancel(); resumeWork = nil
            stopCapture()
            player?.volume = Float(musicVolume * 0.45)
        } else {
            player?.volume = Float(musicVolume)
            if wantsListening { beginListeningIfPossible() }
        }
    }

    func stopEverything() {
        wantsListening = false
        UserDefaults.standard.set(false, forKey: "ritual.listening")
        resumeWork?.cancel(); resumeWork = nil
        stopCapture()
        stopOutputs()
        status = "Todo detenido · micro apagado"
        detail = "No hay escucha ni reproducción activas."
    }

    private func releaseTrackAccess() {
        scopedTrack?.stopAccessingSecurityScopedResource()
        scopedTrack = nil
    }

    func chooseTrack() {
        let panel = NSOpenPanel()
        panel.appearance = NSAppearance(named: .darkAqua)
        panel.title = "Elige la pista local de tu ritual"
        panel.prompt = "Elegir pista"
        panel.allowedContentTypes = [.audio]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.begin { [weak self] response in
            guard response == .OK, let url = panel.url, let self else { return }
            do {
                let bookmark = try url.bookmarkData(options: .withSecurityScope,
                    includingResourceValuesForKeys: nil, relativeTo: nil)
                UserDefaults.standard.set(bookmark, forKey: "ritual.trackBookmark")
                self.trackURL = url; self.trackName = url.lastPathComponent
            } catch { self.status = "No se ha podido conservar la pista"; self.detail = error.localizedDescription }
        }
    }

    func removeTrack() {
        stopEverything()
        trackURL = nil; trackName = "Ninguna pista seleccionada"
        UserDefaults.standard.removeObject(forKey: "ritual.trackBookmark")
    }
    func restoreGreeting() { greeting = Self.defaultGreeting }
    func openMicrophoneSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") {
            NSWorkspace.shared.open(url)
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        let identifier = ObjectIdentifier(utterance)
        let voiceName = utterance.voice?.name
        DispatchQueue.main.async { [weak self] in
            guard let self, self.activeUtterance.map({ ObjectIdentifier($0) }) == identifier,
                  let id = self.conversationIDs[identifier] else { return }
            self.status = "Alfred está hablando · micro apagado"
            self.onNativeSpeechEvent?(NativeSpeechEvent(state: .speaking, id: id, voice: voiceName))
        }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let identifier = ObjectIdentifier(utterance)
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let id = self.conversationIDs.removeValue(forKey: identifier),
               self.activeUtterance.flatMap({ self.conversationIDs[ObjectIdentifier($0)] }) != id {
                self.onNativeSpeechEvent?(NativeSpeechEvent(state: .idle, id: id, reason: "finished"))
            }
            guard self.activeUtterance.map({ ObjectIdentifier($0) }) == identifier else { return }
            self.activeUtterance = nil
            self.player?.volume = Float(self.musicVolume)
            self.finishIfSilent()
        }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let identifier = ObjectIdentifier(utterance)
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let id = self.conversationIDs.removeValue(forKey: identifier),
               self.activeUtterance.flatMap({ self.conversationIDs[ObjectIdentifier($0)] }) != id {
                self.onNativeSpeechEvent?(NativeSpeechEvent(state: .idle, id: id, reason: "cancelled"))
            }
            guard self.activeUtterance.map({ ObjectIdentifier($0) }) == identifier else { return }
            self.activeUtterance = nil
            self.player?.volume = Float(self.musicVolume)
            self.finishIfSilent()
        }
    }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let identifier = ObjectIdentifier(player)
        DispatchQueue.main.async { [weak self] in
            guard let self, self.player.map({ ObjectIdentifier($0) }) == identifier else { return }
            self.player = nil
            self.releaseTrackAccess()
            self.finishIfSilent()
        }
    }
    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        let identifier = ObjectIdentifier(player)
        DispatchQueue.main.async { [weak self] in
            guard let self, self.player.map({ ObjectIdentifier($0) }) == identifier else { return }
            self.player = nil; self.releaseTrackAccess()
            self.detail = "La reproducción de música se ha interrumpido."
            self.finishIfSilent()
        }
    }
}
