import Foundation

/// Local double-transient heuristic. No microphone, recording, networking or I/O.
/// Feed non-overlapping approximately 10 ms windows on ONE serial executor.
/// RMS/peak are linear normalized sample amplitudes, not decibels.
/// It is a clap/snap heuristic, not a guaranteed classifier of sound sources.
/// Tuned on 05/10/2026 for the owner's two finger snaps: softer and less bright than claps, and slower to repeat.
/// To stay safe while typing or talking, the pair must be exactly two: quiet before the first, and no third
/// transient within `confirmAfter` of the second (typing is a run of clicks, a double snap is isolated).
struct DoubleClapDetector {
    struct Configuration {
        var minimumRMS: Double = 0.003
        var minimumPeak: Double = 0.015
        var noiseMultiplier: Double = 4.0
        var onsetMultiplier: Double = 1.8
        var minimumCrest: Double = 1.8
        var minimumHighFrequencyRatio: Double = 0.20
        var minimumGap: TimeInterval = 0.18
        var maximumGap: TimeInterval = 1.0
        var quietBefore: TimeInterval = 0.35
        var confirmAfter: TimeInterval = 0.45
        var maximumImpulseDuration: TimeInterval = 0.18
        var releaseFraction: Double = 0.40
        var releaseHold: TimeInterval = 0.015
        var refractory: TimeInterval = 0.10
        var cooldown: TimeInterval = 5.0
        var initialSettling: TimeInterval = 0.50
        var maximumFrameGap: TimeInterval = 0.12
    }

    private struct Impulse {
        let onset: TimeInterval
        let prior: TimeInterval
        let level: (rms: Double, peak: Double, brightness: Double)
        let releaseThreshold: Double
        var quietSince: TimeInterval?
    }

    /// What the detector made of one loud onset: scalar features only, for a local tuning log. Never audio.
    struct Event: Sendable {
        let time: TimeInterval
        let rms: Double
        let peak: Double
        let brightness: Double
        let verdict: String
    }

    var configuration: Configuration
    private(set) var noiseRMS: Double = 0.0001
    private var previousRMS: Double = 0.0001
    private var lastFrameTime: TimeInterval?
    private var impulse: Impulse?
    private var firstClap: TimeInterval?
    private var lastOnset: TimeInterval = -.infinity
    private var pending: TimeInterval?
    private var features = (rms: 0.0, peak: 0.0, brightness: 0.0)
    private(set) var events: [Event] = []
    private var refractoryUntil: TimeInterval = -.infinity
    private var blockedUntil: TimeInterval = -.infinity
    private var initialized = false

    init(configuration: Configuration = Configuration()) {
        self.configuration = configuration
    }

    /// Call after enabling the listener, changing input device, sleep or a pause.
    /// Retain the cooldown across pause/resume; an explicit fresh session may clear it.
    mutating func reset(
        at time: TimeInterval,
        settleFor duration: TimeInterval = 0.50,
        keepCooldown: Bool = true
    ) {
        guard time.isFinite, duration.isFinite else { return }
        impulse = nil
        firstClap = nil
        pending = nil
        lastOnset = -.infinity
        lastFrameTime = nil
        previousRMS = 0.0001
        noiseRMS = 0.0001
        refractoryUntil = -.infinity
        let settled = time + max(0, duration)
        blockedUntil = keepCooldown ? max(blockedUntil, settled) : settled
        initialized = true
    }

    /// Drop pending claps and reject all frames through a finite monotonic timestamp.
    /// The host MUST independently disable this detector during its own audio playback.
    /// On final music/TTS completion or cancellation, suppress for another 0.8 seconds.
    mutating func suppress(until time: TimeInterval) {
        guard time.isFinite else { return }
        blockedUntil = max(blockedUntil, time)
        impulse = nil
        firstClap = nil
        pending = nil
        lastOnset = -.infinity
        previousRMS = 0.0001
        lastFrameTime = nil
        initialized = true
    }

    /// Optional highFrequencyRatio: RMS of first differences / (sqrt(2) * RMS),
    /// computed within this SAME window and channel. Clamp it to 0...1.
    /// A supplied ratio rejects low-frequency impulses; omitted values use RMS/peak only.
    /// `time` must be a monotonic audio-window timestamp in seconds.
    mutating func process(
        rms rawRMS: Double,
        peak rawPeak: Double,
        time: TimeInterval,
        highFrequencyRatio: Double? = nil
    ) -> Bool {
        guard rawRMS.isFinite, rawPeak.isFinite, time.isFinite,
              rawRMS >= 0, rawPeak >= 0 else { return false }
        if let ratio = highFrequencyRatio, !ratio.isFinite { return false }
        let rms = min(1, rawRMS)
        let peak = min(1, rawPeak)
        if !initialized {
            initialized = true
            blockedUntil = time + configuration.initialSettling
        }
        let dt = lastFrameTime.map { time - $0 } ?? 0.01
        guard dt > 0 else { return false }
        if dt > configuration.maximumFrameGap {
            impulse = nil
            firstClap = nil
            pending = nil
            previousRMS = max(noiseRMS, rms)
        }
        lastFrameTime = time
        defer { previousRMS = rms }
        features = (rms, peak, highFrequencyRatio ?? 1)

        // The second snap is confirmed once nothing else has struck since: then the ritual starts.
        if let due = pending, time >= due, impulse == nil {
            pending = nil
            note(time, "ritual")
            suppress(until: time + configuration.cooldown)
            return true
        }

        if time < blockedUntil {
            // Bounded settling adaptation; the host never feeds its own music/TTS here.
            noiseRMS += 0.10 * (min(rms, 0.02) - noiseRMS)
            noiseRMS = max(0.00005, noiseRMS)
            impulse = nil
            firstClap = nil
            return false
        }
        let triggerRMS = max(configuration.minimumRMS, noiseRMS * configuration.noiseMultiplier)

        if var current = impulse {
            let elapsed = time - current.onset
            if elapsed > configuration.maximumImpulseDuration {
                impulse = nil
                firstClap = nil
                pending = nil
                note(current.onset, "largo (voz o ruido sostenido)", current.level)
                refractoryUntil = time + configuration.refractory
                return false
            }
            if rms <= current.releaseThreshold {
                if current.quietSince == nil { current.quietSince = time }
                if time - (current.quietSince ?? time) >= configuration.releaseHold {
                    impulse = nil
                    acceptClap(current, now: time)
                    return false
                }
            } else {
                current.quietSince = nil
            }
            impulse = current
            return false
        }

        if let firstClap, time - firstClap > configuration.maximumGap + configuration.maximumImpulseDuration {
            self.firstClap = nil
        }
        if rms < triggerRMS {
            let alpha = 1 - exp(-min(dt, 0.1) / 2.0)
            noiseRMS += alpha * (rms - noiseRMS)
            noiseRMS = max(0.00005, noiseRMS)
        }
        let onsetRatio = rms / max(previousRMS, noiseRMS, 0.00005)
        let crest = peak / max(rms, 0.00005)
        let brightEnough = highFrequencyRatio.map { $0 >= configuration.minimumHighFrequencyRatio } ?? true
        guard time >= refractoryUntil, onsetRatio >= configuration.onsetMultiplier else { return false }
        // Near misses are logged too, so a real snap that falls short shows by how much.
        guard rms >= triggerRMS, peak >= configuration.minimumPeak, crest >= configuration.minimumCrest, brightEnough else {
            if rms >= triggerRMS * 0.5, peak >= configuration.minimumPeak * 0.5 {
                note(time, rms < triggerRMS || peak < configuration.minimumPeak ? "flojo" : !brightEnough ? "grave" : "sin pico")
            }
            return false
        }
        // Any new strike while the pair waits for confirmation means a run of clicks (typing), not two snaps.
        if pending != nil { pending = nil; firstClap = nil; note(time, "tercer golpe: no es un doble chasquido") }
        impulse = Impulse(
            onset: time,
            prior: lastOnset,
            level: features,
            releaseThreshold: max(noiseRMS * 2.0, rms * configuration.releaseFraction),
            quietSince: nil
        )
        lastOnset = time
        return false
    }

    private mutating func acceptClap(_ clap: Impulse, now: TimeInterval) {
        let onset = clap.onset
        refractoryUntil = onset + configuration.refractory
        if let first = firstClap {
            let gap = onset - first
            if gap >= configuration.minimumGap && gap <= configuration.maximumGap {
                firstClap = nil
                pending = now + configuration.confirmAfter
                note(onset, "segundo chasquido", clap.level)
                return
            }
            if gap < configuration.minimumGap { return }
        }
        guard onset - clap.prior >= configuration.quietBefore else {
            firstClap = nil
            note(onset, "seguido de otro golpe", clap.level)
            return
        }
        firstClap = onset
        note(onset, "primer chasquido", clap.level)
    }

    private mutating func note(_ time: TimeInterval, _ verdict: String,
                               _ level: (rms: Double, peak: Double, brightness: Double)? = nil) {
        let f = level ?? features
        events.append(Event(time: time, rms: f.rms, peak: f.peak, brightness: f.brightness, verdict: verdict))
        if events.count > 64 { events.removeFirst(events.count - 64) }
    }

    /// The events since the last call, for the local tuning log.
    mutating func takeEvents() -> [Event] {
        defer { events.removeAll(keepingCapacity: true) }
        return events
    }
}
