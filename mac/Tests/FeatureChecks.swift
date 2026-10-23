import AVFoundation
import Foundation

@main struct FeatureChecks {
    static func buffer(frames: Int, capacity: Int? = nil, channels: AVAudioChannelCount = 1,
                       interleaved: Bool = false) -> AVAudioPCMBuffer {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000,
                                   channels: channels, interleaved: interleaved)!
        let result = AVAudioPCMBuffer(pcmFormat: format,
                                     frameCapacity: AVAudioFrameCount(capacity ?? frames))!
        result.frameLength = AVAudioFrameCount(frames)
        let data = result.floatChannelData!
        for channel in 0..<Int(channels) {
            for frame in 0..<Int(result.frameCapacity) {
                data[channel][frame * result.stride] = 0
            }
        }
        return result
    }
    static func extract(_ input: AVAudioPCMBuffer, seconds: Double = 1000) -> [AudioWindowFeatures.Frame] {
        var result: [AudioWindowFeatures.Frame] = []
        let timestamp = AVAudioTime(hostTime: AVAudioTime.hostTime(forSeconds: seconds))
        AudioWindowFeatures.forEachWindow(in: input, at: timestamp) { result.append($0) }
        return result
    }
    static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else { fatalError("FAIL: \(name)") }
        print("PASS: \(name)")
    }
    static func main() {
        let mono = buffer(frames: 480)
        for i in 0..<480 { mono.floatChannelData![0][i] = 0.1 }
        let monoFrames = extract(mono)
        check(monoFrames.count == 1 && abs(monoFrames[0].rms - 0.1) < 0.000001, "mono RMS")
        check(abs(monoFrames[0].peak - 0.1) < 0.000001 && monoFrames[0].highFrequencyRatio == 0,
              "constant level peak/brightness")
        check(abs(monoFrames[0].time - 1000) < 0.00001, "audio host timestamp")

        for interleaved in [false, true] {
            let stereo = buffer(frames: 480, channels: 2, interleaved: interleaved)
            check(stereo.stride == (interleaved ? 2 : 1), "expected PCM stride \(interleaved)")
            for i in 0..<480 {
                stereo.floatChannelData![0][i * stereo.stride] = 0.1
                stereo.floatChannelData![1][i * stereo.stride] = 0.3
            }
            let features = extract(stereo)
            check(features.count == 1 && abs(features[0].rms - sqrt(0.05)) < 0.000001,
                  "stereo RMS interleaved=\(interleaved)")
            check(abs(features[0].peak - 0.3) < 0.000001 && features[0].highFrequencyRatio == 0,
                  "stereo peak interleaved=\(interleaved)")
        }

        let padding = buffer(frames: 480, capacity: 960)
        for i in 480..<960 { padding.floatChannelData![0][i] = 1 }
        let paddedFeatures = extract(padding)
        check(paddedFeatures.count == 1 && paddedFeatures[0].peak == 0 && paddedFeatures[0].rms == 0,
              "frameLength excludes loud capacity padding")

        let long = buffer(frames: 4800)
        let windows = extract(long)
        check(windows.count == 10, "100 ms buffer subdivides into ten windows")
        check(zip(windows, windows.dropFirst()).allSatisfy { pair in abs(pair.1.time - pair.0.time - 0.01) < 0.000001 },
              "window timestamps advance by 10 ms")

        // Deliberately larger than typical engine taps; no microphone is involved.
        let gesture = buffer(frames: 57600)
        gesture.floatChannelData![0][4800 + 200] = 0.5
        gesture.floatChannelData![0][19200 + 200] = 0.5
        let gestureWindows = extract(gesture)
        var detector = DoubleClapDetector()
        detector.reset(at: 1000, settleFor: 0, keepCooldown: false)
        var triggers = 0
        for frame in gestureWindows {
            if detector.process(rms: frame.rms, peak: frame.peak, time: frame.time,
                                highFrequencyRatio: frame.highFrequencyRatio) { triggers += 1 }
        }
        check(gestureWindows.count == 120 && triggers == 1,
              "two synthesized transients activate exactly once inside long buffer")
        print("13 PCM feature checks passed. Buffers only in memory; no capture/playback/network.")
    }
}
