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

export async function startSpeech(preferences: Preferences, onText: (text: string) => void, onStatus: (message: string, level?: number) => void, onEnded: (message: string) => void = () => {}): Promise<() => void> {
  if (preferences.provider === 'browser') {
    const Recognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Recognition) throw new Error('This browser does not support speech recognition. Use local Whisper.');
    const recognition = new Recognition(); recognition.continuous = true; recognition.interimResults = true;
    recognition.lang = preferences.language === 'en' ? 'en-US' : 'de-DE'; let stopped = false; let retry: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { stopped = true; clearTimeout(retry); recognition.abort(); };
    const fatal = (message: string) => { if (stopped) return; stop(); onEnded(message); };
    recognition.onresult = (event: any) => { let text = ''; for (let i = Math.max(0, event.resultIndex - 1); i < event.results.length; i++) text += event.results[i][0].transcript + ' '; onText(text); };
    recognition.onerror = (event: any) => { if (['no-speech', 'aborted'].includes(event.error)) onStatus('Waiting for speech'); else fatal(`Browser speech recognition: ${event.error}. Turn the microphone off and on again.`); };
    recognition.onend = () => { if (!stopped) retry = setTimeout(() => { if (!stopped) try { recognition.start(); } catch (error) { fatal(String(error)); } }, 300); };
    recognition.start(); onStatus('Browser listening · may use an online service');
    return stop;
  }
  const status = await api<{ ok: boolean; message: string }>('/speech/status');
  const models = await api<{ managed: boolean }>('/speech/models');
  if (models.managed || !status.ok) await api('/speech/start', {});
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
  // Fixed-size PCM capture. Audio never leaves the loopback Whisper service.
  processor = context.createScriptProcessor(4096, 1, 1); mute = context.createGain(); mute.gain.value = 0;
  source.connect(processor); processor.connect(mute); mute.connect(context.destination);
  let chunks: Float32Array[] = []; let total = 0; let busy = false; let lastVoice = 0; let lastMeter = 0;
  for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => fatal('Microphone disconnected. Choose a device and reconnect.'), { once: true });
  context.onstatechange = () => { if (!stopped && context.state !== 'running') onStatus('Audio capture suspended. Turn the microphone off and on again.'); };
  processor.onaudioprocess = event => {
    const data = new Float32Array(event.inputBuffer.getChannelData(0));
    let energy = 0; for (const sample of data) energy += sample * sample;
    const rms = Math.sqrt(energy / data.length); if (rms > .008) lastVoice = Date.now();
    if (Date.now() - lastMeter >= 180) { lastMeter = Date.now(); onStatus(rms > .008 ? 'Local Whisper listening' : 'Waiting for speech', Math.round(Math.min(1, rms * 12) * 12) / 12); }
    chunks.push(data); total += data.length;
    while (total > context.sampleRate * 6 && chunks.length > 1) total -= chunks.shift()!.length;
  };
  interval = setInterval(async () => {
    if (busy || total < context.sampleRate * 1.5 || Date.now() - lastVoice > 2200) return;
    busy = true; const data = new Float32Array(total); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    try { const response = await api<{ text: string }>('/speech', undefined, wav(data, context.sampleRate)); if (!stopped && response.text) onText(response.text); }
    catch (error) { if (!stopped) onStatus(String(error)); }
    finally { busy = false; }
  }, 1800);
  return () => { stop(); chunks = []; };
  } catch (error) { stop(); throw error; }
}
