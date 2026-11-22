import Foundation
import Speech
import AVFoundation

// This helper consumes already captured WAV chunks through private pipes. It never
// opens a microphone or writes audio to disk. Recognition must stay on-device.
func reply(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value),
          var line = String(data: data, encoding: .utf8) else { return }
    line += "\n"
    FileHandle.standardOutput.write(Data(line.utf8))
}
func fatal(_ message: String) -> Never { reply(["type": "fatal", "error": message]); exit(1) }
struct SpeechFailure: Error { let message: String }

func audioBuffer(_ data: Data) throws -> AVAudioPCMBuffer {
    let bytes = [UInt8](data)
    func u16(_ offset: Int) -> Int { Int(bytes[offset]) | Int(bytes[offset + 1]) << 8 }
    func u32(_ offset: Int) -> Int { u16(offset) | u16(offset + 2) << 16 }
    func tag(_ offset: Int) -> String { String(bytes: bytes[offset..<(offset + 4)], encoding: .ascii) ?? "" }
    guard bytes.count >= 44, bytes.count <= 810_000, tag(0) == "RIFF", tag(8) == "WAVE", u32(4) == bytes.count - 8 else { throw SpeechFailure(message: "Invalid WAV recording (maximum 25 seconds).") }
    var offset = 12, samples: Range<Int>?, hasFormat = false
    while offset < bytes.count {
        guard offset + 8 <= bytes.count else { throw SpeechFailure(message: "Truncated WAV header.") }
        let size = u32(offset + 4), start = offset + 8, end = start + size + size % 2
        guard end <= bytes.count else { throw SpeechFailure(message: "Truncated WAV audio.") }
        if tag(offset) == "fmt " {
            guard !hasFormat, size >= 16, u16(start) == 1, u16(start + 2) == 1, u32(start + 4) == 16000, u32(start + 8) == 32000, u16(start + 12) == 2, u16(start + 14) == 16 else { throw SpeechFailure(message: "Expected mono PCM16 audio at 16000 Hz.") }
            hasFormat = true
        }
        if tag(offset) == "data" {
            guard hasFormat, samples == nil, size > 0, size <= 800_000, size % 2 == 0 else { throw SpeechFailure(message: "Invalid audio samples.") }
            samples = start..<(start + size)
        }
        offset = end
    }
    guard hasFormat, let range = samples,
          let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false),
          let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(range.count / 2)),
          let channel = buffer.floatChannelData?[0] else { throw SpeechFailure(message: "Missing PCM audio samples.") }
    buffer.frameLength = buffer.frameCapacity
    for index in 0..<Int(buffer.frameLength) {
        let sample = UInt16(u16(range.lowerBound + index * 2))
        channel[index] = Float(Int16(bitPattern: sample)) / 32768.0
    }
    return buffer
}

final class NativeSpeechWorker {
    private var recognizer: SFSpeechRecognizer?
    private var task: SFSpeechRecognitionTask?
    private var pendingID: Int?
    private var timeout: DispatchWorkItem?
    private var started = Date()

    func start(language: String, statusOnly: Bool) {
        guard ["auto", "en", "de"].contains(language) else { fatal("Invalid system speech language.") }
        let languages = SFSpeechRecognizer.supportedLocales().map { $0.identifier.replacingOccurrences(of: "_", with: "-") }.filter {
            SFSpeechRecognizer(locale: Locale(identifier: $0))?.supportsOnDeviceRecognition == true
        }.sorted()
        // Status reads deliberately do not call requestAuthorization.
        if statusOnly { reply(["type": "ready", "languages": languages]); exit(0) }
        let prefix = language == "de" ? "de" : "en"
        let preferred = prefix == "de" ? "de-DE" : "en-US"
        guard let selected = languages.first(where: { $0 == preferred }) ?? languages.first(where: { $0.hasPrefix(prefix + "-") }),
              let engine = SFSpeechRecognizer(locale: Locale(identifier: selected)), engine.supportsOnDeviceRecognition else {
            fatal("No installed \(prefix) on-device speech recognizer. Enable the language's on-device dictation in macOS settings. Network recognition is disabled.")
        }
        self.recognizer = engine
        SFSpeechRecognizer.requestAuthorization { authorization in
            DispatchQueue.main.async {
                guard authorization == .authorized else { fatal("Speech recognition permission was denied or restricted. Enable it for PRMTA in System Settings > Privacy & Security > Speech Recognition.") }
                reply(["type": "ready", "languages": languages, "language": selected])
            }
        }
    }
    func receive(_ line: String) {
        var requestID: Int?
        do {
            guard line.utf8.count <= 1_100_000, let data = line.data(using: .utf8),
                  let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let number = request["id"] as? NSNumber, number.doubleValue > 0, number.doubleValue < 9_007_199_254_740_991,
                  number.doubleValue == floor(number.doubleValue) else { throw SpeechFailure(message: "Invalid audio request.") }
            let id = number.intValue; requestID = id
            guard pendingID == nil else { throw SpeechFailure(message: "System speech is busy.") }
            guard SFSpeechRecognizer.authorizationStatus() == .authorized,
                  let engine = recognizer, engine.supportsOnDeviceRecognition else { throw SpeechFailure(message: "On-device speech is not ready or not authorized.") }
            guard let base64 = request["wav"] as? String, let wav = Data(base64Encoded: base64) else { throw SpeechFailure(message: "Invalid WAV encoding.") }
            let buffer = try audioBuffer(wav)
            let recognition = SFSpeechAudioBufferRecognitionRequest()
            recognition.requiresOnDeviceRecognition = true
            recognition.shouldReportPartialResults = false
            recognition.taskHint = .dictation
            pendingID = id; started = Date()
            task = engine.recognitionTask(with: recognition) { result, error in
                DispatchQueue.main.async {
                    guard self.pendingID == id else { return }
                    if let result = result, result.isFinal { self.finish(id: id, text: result.bestTranscription.formattedString) }
                    else if error != nil { self.finish(id: id, error: "On-device speech recognition failed. Check that this language is downloaded in macOS settings.") }
                }
            }
            recognition.append(buffer)
            recognition.endAudio()
            let deadline = DispatchWorkItem { if self.pendingID == id { self.finish(id: id, error: "On-device speech recognition timed out.") } }
            timeout = deadline; DispatchQueue.main.asyncAfter(deadline: .now() + 35, execute: deadline)
        } catch {
            reply(["id": requestID.map { $0 as Any } ?? NSNull(), "error": (error as? SpeechFailure)?.message ?? "Invalid native speech request."])
        }
    }
    private func finish(id: Int, text: String = "", error: String? = nil) {
        timeout?.cancel(); timeout = nil; pendingID = nil
        let oldTask = task; task = nil
        if let error = error { oldTask?.cancel(); reply(["id": id, "error": error]) }
        else { reply(["id": id, "text": text, "ms": max(0, Int(Date().timeIntervalSince(started) * 1000))]) }
    }
    func close() { timeout?.cancel(); task?.cancel(); exit(0) }
}

let arguments = CommandLine.arguments
let languageIndex = arguments.firstIndex(of: "--language")
let language = languageIndex.flatMap { $0 + 1 < arguments.count ? arguments[$0 + 1] : nil } ?? "auto"
let worker = NativeSpeechWorker()
DispatchQueue.main.async { worker.start(language: language, statusOnly: arguments.contains("--status")) }
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine(strippingNewline: true) { DispatchQueue.main.async { worker.receive(line) } }
    DispatchQueue.main.async { worker.close() }
}
// Speech authorization and recognition callbacks need the main run loop alive.
RunLoop.main.run()
