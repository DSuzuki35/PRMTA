import { useEffect, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { audioLevels } from '../shared/audio';

export function MicrophoneMeter({ deviceId, onDevices }: { deviceId: string; onDevices: (devices: MediaDeviceInfo[]) => void }) {
  const [enabled, setEnabled] = useState(false), [status, setStatus] = useState('Test your input before a take.'), [db, setDb] = useState(-60), [peak, setPeak] = useState(-60), [clipped, setClipped] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false, stream: MediaStream | undefined, context: AudioContext | undefined, source: MediaStreamAudioSourceNode | undefined, timer: ReturnType<typeof setInterval> | undefined;
    let peakUntil = 0, clipUntil = 0, heldPeak = -60, smoothDb = -60;
    const clean = () => { clearInterval(timer); source?.disconnect(); stream?.getTracks().forEach(t => t.stop()); if (context && context.state !== 'closed') void context.close().catch(() => {}); };
    setStatus('Connecting microphone…'); setDb(-60); setPeak(-60); setClipped(false);
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
        if (disposed) { clean(); return; }
        context = new AudioContext(); await context.resume();
        if (disposed) { clean(); return; }
        source = context.createMediaStreamSource(stream); const analyser = context.createAnalyser(); analyser.fftSize = 8192; source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        setStatus('Listening locally · audio is not recorded');
        void navigator.mediaDevices.enumerateDevices().then(devices => { if (!disposed) onDevices(devices.filter(d => d.kind === 'audioinput')); }).catch(() => {});
        for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => { if (!disposed) { setEnabled(false); setStatus('Microphone disconnected. Reconnect it and test again.'); } }, { once: true });
        timer = setInterval(() => {
          analyser.getFloatTimeDomainData(samples); const level = audioLevels(samples), now = Date.now();
          smoothDb = level.db >= smoothDb ? level.db : Math.max(level.db, smoothDb - 5);
          if (level.peakDb >= heldPeak || now > peakUntil) { heldPeak = level.peakDb; peakUntil = now + 800; }
          if (level.clipped) clipUntil = now + 1000;
          setDb(smoothDb); setPeak(heldPeak); setClipped(now < clipUntil);
        }, 80);
      } catch (error) {
        if (!disposed) { setEnabled(false); const name = (error as DOMException).name; setStatus(name === 'NotAllowedError' ? 'Microphone permission denied. Allow access and try again.' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'Selected microphone is unavailable. Choose another input.' : `Microphone unavailable: ${String(error)}`); }
        clean();
      }
    })();
    return () => { disposed = true; clean(); };
  }, [enabled, deviceId, onDevices]);
  const level = enabled ? (db + 60) / 60 * 100 : 0;
  return <div className="microphone-test"><div className="microphone-test-heading"><button type="button" className="button secondary small" onClick={() => { if (enabled) { setStatus('Microphone test stopped.'); setDb(-60); setPeak(-60); setClipped(false); } setEnabled(!enabled); }}>{enabled ? <Square size={14}/> : <Mic size={14}/>} {enabled ? 'Stop test' : 'Test microphone'}</button><output aria-live="off" className={clipped ? 'error-text' : ''}>{enabled && db > -60 ? `${Math.round(db)} dBFS` : '−∞ dBFS'}{enabled && clipped ? ' · Clipping' : ''}</output></div><div className="input-meter" role="meter" aria-label="Microphone input level" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={enabled ? Math.round(db) : -60} aria-valuetext={enabled ? `${Math.round(db)} dBFS` : 'Microphone test off'}><div className="input-meter-fill" style={{ width: `${level}%` }}/>{enabled && <i className="input-meter-peak" style={{ left: `${Math.min(99.5, (peak + 60) / 60 * 100)}%` }}/>}</div><div className="input-meter-scale"><span>−60</span><span>−40</span><span>−20</span><span>−6</span><span>0 dB</span></div><p role="status" className="muted">{status}</p></div>;
}
