import { voiceTiming } from '../shared/audio';
import { VoiceActivityGate } from '../shared/voice-pacing';
import { api } from './api';
import { VoiceCommandGate, parseVoiceCommand } from '../shared/voice-commands';
import type { ShortcutAction } from '../shared/shortcuts';
import type { Preferences } from '../shared/model';

function wav(samples: Float32Array, sampleRate: number): Blob {
  const ratio = sampleRate / 16000; const length = Math.floor(samples.length / ratio);
  const buffer = new ArrayBuffer(44 + length * 2); const view = new DataView(buffer);
  const str = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) { const start = Math.floor(i * ratio); const end = Math.max(start + 1, Math.floor((i + 1) * ratio)); let value = 0; for (let j = start; j < end && j < samples.length; j++) value += samples[j]; value /= end - start; view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 32767, true); }
  return new Blob([buffer], { type: 'audio/wav' });
}

export type SpeechCommands = { enabled(): boolean; wakeWord(): string; context(): string | null; onCommand(action: ShortcutAction): void };

export async function startSpeech(preferences: Preferences, onText: (text: string) => void, onStatus: (message: string, level?: number) => void, onEnded: (message: string) => void = () => {}, captureKey: () => string | null = () => 'active', onActivity: (active: boolean) => void = () => {}, commands?: SpeechCommands): Promise<() => void> {
  const commandGate = new VoiceCommandGate();
  let commandAddressed = false, config = '';
  const keys = () => {
    const enabled = commands?.enabled() ?? false, wake = commands?.wakeWord() ?? 'prompta';
    const nextConfig = `${enabled}:${wake}`;
    if (nextConfig !== config) { config = nextConfig; commandGate.reset(); commandAddressed = false; }
    const follow = captureKey(), control = enabled ? commands!.context() : null;
    return { follow, control, key: control ? `${config}:${control}:${follow ?? 'paused'}` : follow };
  };
  const deliver = (text: string, final: boolean, utteranceId: number, captured: ReturnType<typeof keys>) => {
    const current = keys();
    if (current.key !== captured.key) return;
    if (commands?.enabled()) {
      const parsed = parseVoiceCommand(text, commands.wakeWord());
      if (parsed.consumed) commandAddressed = true;
      if (commandAddressed) {
        if (final && captured.control && current.control === captured.control) {
          const result = commandGate.consume(text, { wakeWord: commands.wakeWord(), utteranceId });
          if (result.action) commands.onCommand(result.action);
        }
        return;
      }
      if (commandGate.consume(text, { wakeWord: commands.wakeWord(), utteranceId }).consumed) return;
    }
    if (captured.follow && current.follow === captured.follow) onText(text);
  };
  if (preferences.provider === 'browser') {
    const Recognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Recognition) throw new Error('This browser does not support speech recognition. Choose a local speech engine.');
    const recognition = new Recognition(); recognition.continuous = true; recognition.interimResults = true;
    recognition.lang = preferences.language === 'de' ? 'de-DE' : 'en-US';
    let stopped = false, utterance = 0, began = false, captured = keys();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { stopped = true; clearTimeout(retry); recognition.abort(); };
    const fatal = (message: string) => { if (stopped) return; stop(); onEnded(message); };
    recognition.onspeechstart = () => {
      utterance++; began = true; captured = keys(); commandAddressed = false;
      commandGate.observeVoiceActivity(true);
    };
    recognition.onspeechend = () => { commandGate.observeVoiceActivity(false); };
    recognition.onresult = (event: any) => {
      if (stopped) return;
      // Browsers emit cumulative result arrays. Process only changed results;
      // final hypotheses prevent "next" firing before "next sentence" arrives.
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        deliver(text, !!event.results[i].isFinal, utterance, began ? captured : keys());
      }
    };
    recognition.onerror = (event: any) => { if (['no-speech', 'aborted'].includes(event.error)) onStatus('Waiting for speech'); else fatal(`Browser speech recognition: ${event.error}. Turn the microphone off and on again.`); };
    recognition.onend = () => { if (!stopped) retry = setTimeout(() => { if (!stopped) try { began = false; recognition.start(); } catch (error) { fatal(String(error)); } }, 300); };
    recognition.start(); onStatus('Browser listening · may use an online service');
    return stop;
  }
  const parakeet = preferences.provider === 'parakeet';
  const system = preferences.provider === 'system';
  if (system) await api('/speech/system/start', { language: preferences.language });
  else if (parakeet) await api('/speech/parakeet/start', { acceleration: preferences.parakeetAcceleration });
  else {
    const status = await api<{ ok: boolean; message: string }>(`/speech/status?whisperUrl=${encodeURIComponent(preferences.whisperUrl)}`);
    const models = await api<{ managed: boolean }>('/speech/models');
    if (models.managed || !status.ok) await api('/speech/start', { whisperUrl: preferences.whisperUrl, model: preferences.whisperModel });
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: preferences.microphoneId ? { exact: preferences.microphoneId } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
  let context: AudioContext;
  try { context = new AudioContext(); await context.resume(); }
  catch (error) { stream.getTracks().forEach(t => t.stop()); throw error; }
  let source: MediaStreamAudioSourceNode | undefined, processor: ScriptProcessorNode | undefined, mute: GainNode | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; clearInterval(interval); processor?.disconnect(); source?.disconnect(); mute?.disconnect(); stream.getTracks().forEach(t => t.stop()); void context.close(); };
  const fatal = (message: string) => { if (stopped) return; stop(); onEnded(message); };
  try {
  source = context.createMediaStreamSource(stream);
  // Fixed-size PCM capture. Audio stays with the selected local recognition service.
  processor = context.createScriptProcessor(4096, 1, 1); mute = context.createGain(); mute.gain.value = 0;
  source.connect(processor); processor.connect(mute); mute.connect(context.destination);
  const timing = voiceTiming[preferences.voiceLatency];
  let key: string | null = null, epoch = 0, contextRevision = 0, utterance = 0;
  let acousticActive = false, quietSince: number | undefined, captured = keys();
  const acoustic = new VoiceActivityGate();
  let activity = new VoiceActivityGate(), lastActivity: boolean | undefined, activitySentAt = 0;
  let chunks: Float32Array[] = []; let total = 0; let busy = false; let lastVoice = 0; let lastMeter = 0;
  type AudioRequest = { data: Float32Array; key: string; epoch: number; contextRevision: number; utterance: number; captured: ReturnType<typeof keys>; final: boolean; addressed: boolean };
  let pendingFinal: AudioRequest | undefined, finalizedEpoch = -1;
  const snapshot = (final: boolean): AudioRequest => {
    const data = new Float32Array(total); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    return { data, key: key!, epoch, contextRevision, utterance, captured, final, addressed: commandAddressed };
  };
  for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => fatal('Microphone disconnected. Choose a device and reconnect.'), { once: true });
  context.onstatechange = () => { if (!stopped && context.state !== 'running') onStatus('Audio capture suspended. Turn the microphone off and on again.'); };
  processor.onaudioprocess = event => {
    const nextKeys = keys(), nextKey = nextKeys.key; captured = nextKeys;
    if (nextKey !== key) { key = nextKey; epoch++; contextRevision++; pendingFinal = undefined; chunks = []; total = 0; lastVoice = 0; activity = new VoiceActivityGate(); lastActivity = undefined; }
    const data = new Float32Array(event.inputBuffer.getChannelData(0));
    let energy = 0; for (const sample of data) energy += sample * sample;
    const rms = Math.sqrt(energy / data.length); if (rms > .008) lastVoice = Date.now();
    const now = Date.now(), active = activity.sample(rms, now), talking = acoustic.sample(rms, now);
    if (!talking) quietSince ??= now;
    else {
      if (!acousticActive && (utterance === 0 || (quietSince !== undefined && now - quietSince >= 650))) {
        utterance++; commandAddressed = false;
        if (commands?.enabled()) {
          // Onset confirmation takes several frames. Retain a short pre-roll so
          // those first sounds of the wake word survive the utterance reset.
          const retained = new Float32Array(Math.min(total, Math.ceil(context.sampleRate * .3)));
          let remaining = retained.length;
          for (let i = chunks.length - 1; i >= 0 && remaining > 0; i--) {
            const count = Math.min(remaining, chunks[i].length);
            retained.set(chunks[i].subarray(chunks[i].length - count), remaining - count); remaining -= count;
          }
          chunks = retained.length ? [retained] : []; total = retained.length; epoch++; pendingFinal = undefined;
        }
      }
      quietSince = undefined;
    }
    acousticActive = talking; commandGate.observeVoiceActivity(talking, now);
    if (captured.follow && (active !== lastActivity || now - activitySentAt >= 180)) { onActivity(active); lastActivity = active; activitySentAt = now; }
    if (Date.now() - lastMeter >= 180) { lastMeter = Date.now(); onStatus(!key ? 'Microphone ready · press Play to follow' : !captured.follow && commands?.enabled() ? 'Listening for commands · playback paused' : rms > .008 ? `Local ${system ? 'system speech' : parakeet ? 'Parakeet' : 'Whisper'} listening` : 'Waiting for speech', Math.round(Math.min(1, rms * 12) * 12) / 12); }
    if (!key) return;
    chunks.push(data); total += data.length;
    while (total > context.sampleRate * timing.window && chunks.length > 1) total -= chunks.shift()!.length;
    if (commands?.enabled() && utterance > 0 && lastVoice > 0 && !talking && quietSince !== undefined && now - quietSince >= 650 && finalizedEpoch !== epoch) {
      // Capture once at the end of speech, even while recognition is busy. A
      // slow response must not let silence evict the words from the PCM window.
      pendingFinal = snapshot(true); finalizedEpoch = epoch;
    }
  };
  interval = setInterval(async () => {
    if (busy || !key || keys().key !== key) return;
    const queued = pendingFinal;
    if (!queued && (finalizedEpoch === epoch || total < context.sampleRate * timing.minimum || Date.now() - lastVoice > 2200)) return;
    const request = queued ?? snapshot(false); pendingFinal = undefined;
    if (request.epoch !== epoch || request.key !== key || request.utterance !== utterance) return;
    // A queued snapshot may predate the previous hypothesis identifying this
    // utterance as a command. Preserve that suppression flag with the request.
    request.addressed ||= commandAddressed;
    busy = true;
    try {
      const response = await api<{ text: string }>(system ? `/speech?provider=system&language=${preferences.language}` : parakeet ? '/speech?provider=parakeet' : `/speech?whisperUrl=${encodeURIComponent(preferences.whisperUrl)}`, undefined, wav(request.data, context.sampleRate));
      const current = keys();
      if (stopped || contextRevision !== request.contextRevision || current.key !== request.key || !response.text) return;
      if (epoch === request.epoch && request.utterance === utterance) deliver(response.text, request.final, request.utterance, request.captured);
      // An acoustic pause starts a new command utterance, not a new script
      // position. Late ordinary narration remains useful until navigation or
      // another capture-context change. Never mutate the new utterance's
      // commandAddressed state or execute an old command through this path.
      else if (request.utterance < utterance && request.captured.follow && current.follow === request.captured.follow && !request.addressed
        && (!commands?.enabled() || !parseVoiceCommand(response.text, commands.wakeWord()).consumed)) onText(response.text);
    }
    catch (error) { if (!stopped) onStatus(String(error)); }
    finally { busy = false; }
  }, timing.interval);
  return () => { stop(); chunks = []; pendingFinal = undefined; };
  } catch (error) { stop(); throw error; }
}
