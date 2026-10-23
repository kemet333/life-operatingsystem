import AVFoundation
import Darwin

/// Computes only short-lived scalar features. No audio capture, playback or persistence.
/// Call from an input-node tap using the buffer's actual frameLength, never its capacity.
enum AudioWindowFeatures {
    struct Frame: Sendable {
        let time: TimeInterval
        let rms: Double
        let peak: Double
        let highFrequencyRatio: Double
    }

    /// Same monotonic clock as AVAudioTime.hostTime; use for reset/suppress deadlines.
    static var monotonicNow: TimeInterval {
        AVAudioTime.seconds(forHostTime: mach_absolute_time())
    }

    /// Emits approximately 10 ms windows even when AVAudioEngine supplies large buffers.
    /// Returned features contain no PCM. Consume/copy ONLY Frame values before returning.
    /// `floatChannelData` pointers and the audio buffer must never escape this call.
    static func forEachWindow(
        in buffer: AVAudioPCMBuffer,
        at timestamp: AVAudioTime,
        emit: (Frame) -> Void
    ) {
        let rate = buffer.format.sampleRate
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard rate.isFinite, rate > 0, frames > 0, channels > 0,
              let data = buffer.floatChannelData else { return }
        let stride = buffer.stride
        let windowFrames = max(1, Int((rate * 0.010).rounded()))
        let startTime = timestamp.isHostTimeValid
            ? AVAudioTime.seconds(forHostTime: timestamp.hostTime)
            : monotonicNow - Double(frames) / rate
        var offset = 0
        while offset < frames {
            let count = min(windowFrames, frames - offset)
            // Avoid treating an extremely short trailing fragment as a separate onset.
            if count < max(1, windowFrames / 2) { break }
            var squares = 0.0
            var differences = 0.0
            var peak = 0.0
            for channel in 0..<channels {
                let samples = data[channel]
                var previous = Double(samples[offset * stride])
                for i in 0..<count {
                    let sample = Double(samples[(offset + i) * stride])
                    guard sample.isFinite else { continue }
                    squares += sample * sample
                    peak = max(peak, abs(sample))
                    if i > 0 {
                        let difference = sample - previous
                        differences += difference * difference
                    }
                    previous = sample
                }
            }
            let sampleCount = Double(count * channels)
            let rms = sqrt(squares / sampleCount)
            let differenceRMS = sqrt(differences / max(1, Double((count - 1) * channels)))
            let brightness = min(1, differenceRMS / max(0.000001, sqrt(2) * rms))
            emit(Frame(time: startTime + Double(offset) / rate,
                       rms: rms, peak: peak, highFrequencyRatio: brightness))
            offset += count
        }
    }
}
