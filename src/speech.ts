import { voiceTiming } from '../shared/audio';
import { VoiceActivityGate } from '../shared/voice-pacing';
import { api } from './api';
import type { Preferences } from '../shared/model';

function wav(samples: Float32Array, sampleRate: number): Blob {
  const ratio = sampleRate / 16000; const length = Math.floor(samples.length / ratio);
  const buffer = new ArrayBuffer(44 + length * 2); const view = new DataView(buffer);
  const str = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) { const start = Math.floor(i * ratio); const end = Math.max(start + 1, Math.floor((i + 1) * ratio)); let value = 0; for (let j = start; j < end && j < samples.length; j++) value += samples[j]; value /= end - start; view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 32767, true); }
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function startSpeech(preferences: Preferences, onText: (text: string) => void, onStatus: (message: string, level?: number) => void, onEnded: (message: string) => void = () => {}, captureKey: () => string | null = () => 'active', onActivity: (active: boolean) => void = () => {}): Promise<() => void> {
  if (preferences.provider === 'browser') {
    const Recognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Recognition) throw new Error('This browser does not support speech recognition. Use local Whisper.');
    const recognition = new Recognition(); recognition.continuous = true; recognition.interimResults = true;
    recognition.lang = preferences.language === 'de' ? 'de-DE' : 'en-US'; let stopped = false; let retry: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { stopped = true; clearTimeout(retry); recognition.abort(); };
    const fatal = (message: string) => { if (stopped) return; stop(); onEnded(message); };
    recognition.onresult = (event: any) => { let text = ''; for (let i = Math.max(0, event.resultIndex - 1); i < event.results.length; i++) text += event.results[i][0].transcript + ' '; if (captureKey()) onText(text); };
    recognition.onerror = (event: any) => { if (['no-speech', 'aborted'].includes(event.error)) onStatus('Waiting for speech'); else fatal(`Browser speech recognition: ${event.error}. Turn the microphone off and on again.`); };
    recognition.onend = () => { if (!stopped) retry = setTimeout(() => { if (!stopped) try { recognition.start(); } catch (error) { fatal(String(error)); } }, 300); };
    recognition.start(); onStatus('Browser listening · may use an online service');
    return stop;
  }
  const parakeet = preferences.provider === 'parakeet';
  if (parakeet) await api('/speech/parakeet/start', { acceleration: preferences.parakeetAcceleration });
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
  let key: string | null = null, epoch = 0;
  let activity = new VoiceActivityGate(), lastActivity: boolean | undefined, activitySentAt = 0;
  let chunks: Float32Array[] = []; let total = 0; let busy = false; let lastVoice = 0; let lastMeter = 0;
  for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => fatal('Microphone disconnected. Choose a device and reconnect.'), { once: true });
  context.onstatechange = () => { if (!stopped && context.state !== 'running') onStatus('Audio capture suspended. Turn the microphone off and on again.'); };
  processor.onaudioprocess = event => {
    const nextKey = captureKey();
    if (nextKey !== key) { key = nextKey; epoch++; chunks = []; total = 0; lastVoice = 0; activity = new VoiceActivityGate(); lastActivity = undefined; }
    const data = new Float32Array(event.inputBuffer.getChannelData(0));
    let energy = 0; for (const sample of data) energy += sample * sample;
    const rms = Math.sqrt(energy / data.length); if (rms > .008) lastVoice = Date.now();
    const now = Date.now(), active = activity.sample(rms, now);
    if (key && (active !== lastActivity || now - activitySentAt >= 180)) { onActivity(active); lastActivity = active; activitySentAt = now; }
    if (Date.now() - lastMeter >= 180) { lastMeter = Date.now(); onStatus(!key ? 'Microphone ready · press Play to follow' : rms > .008 ? `Local ${parakeet ? 'Parakeet' : 'Whisper'} listening` : 'Waiting for speech', Math.round(Math.min(1, rms * 12) * 12) / 12); }
    if (!key) return;
    chunks.push(data); total += data.length;
    while (total > context.sampleRate * timing.window && chunks.length > 1) total -= chunks.shift()!.length;
  };
  interval = setInterval(async () => {
    if (busy || !key || captureKey() !== key || total < context.sampleRate * timing.minimum || Date.now() - lastVoice > 2200) return;
    busy = true; const requestKey = key, requestEpoch = epoch; const data = new Float32Array(total); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    try { const response = await api<{ text: string }>(parakeet ? '/speech?provider=parakeet' : `/speech?whisperUrl=${encodeURIComponent(preferences.whisperUrl)}`, undefined, wav(data, context.sampleRate)); if (!stopped && epoch === requestEpoch && captureKey() === requestKey && response.text) onText(response.text); }
    catch (error) { if (!stopped) onStatus(String(error)); }
    finally { busy = false; }
  }, timing.interval);
  return () => { stop(); chunks = []; };
  } catch (error) { stop(); throw error; }
}
