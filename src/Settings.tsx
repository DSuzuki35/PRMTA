import { useEffect, useState } from 'react';
import { Mic, Keyboard } from 'lucide-react';
import type { Preferences } from '../shared/model';
import { Range, Toggle } from './AppearancePanel';
import { ModelPicker } from './ModelPicker';
import { WhisperConnection } from './WhisperConnection';
import { ParakeetSetup } from './ParakeetSetup';
import { MicrophoneMeter } from './MicrophoneMeter';
import { GamepadAssignments } from './GamepadAssignments';
import { CloudSettings } from './CloudSettings';
import { UpdateSettings } from './UpdateSettings';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { VoiceCommandsSettings } from './VoiceCommandsSettings';
import { SystemSpeechSettings } from './SystemSpeechSettings';
export function Settings({ preferences, onChange, report }: { preferences: Preferences; onChange: (p: Preferences) => void; report: (text: string) => void }) {
  const mac = window.desktop?.platform === 'darwin';
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => { void navigator.mediaDevices?.enumerateDevices().then(list => setDevices(list.filter(d => d.kind === 'audioinput'))); }, []);
  return <div className="page-scroll settings-page"><div className="page-title"><div><div className="eyebrow">MAKE IT YOURS</div><h1>Your studio. Your rules.</h1><p>Local data. Your cloud. Your speaking pace.</p></div></div>
    <section className="settings-card"><div className="section-heading"><h2><Mic size={21}/>Voice follow</h2><span className="pill">DE / EN</span></div><p className="muted">Your selected speech engine transcribes your voice. PRMTA matches it to your script, tolerates small changes, and waits when you go off script.</p><div className="two-fields"><label>Speech recognition<select value={preferences.provider} onChange={e => onChange({ ...preferences, provider: e.target.value as Preferences['provider'] })}><option value="whisper">{mac ? 'Whisper · external local server' : 'Whisper · local'}</option><option value="parakeet" disabled={mac}>{mac ? 'NVIDIA Parakeet · Windows only' : 'NVIDIA Parakeet · local'}</option><option value="system">{mac ? 'Apple · on-device speech' : 'Windows / Apple · system speech'}</option><option value="browser">Browser · may use an online service</option></select></label><label>Script language<select disabled={preferences.provider === 'parakeet'} value={preferences.language} onChange={e => onChange({ ...preferences, language: e.target.value as Preferences['language'] })}><option value="en">English</option><option value="de">German</option><option value="auto">Automatic</option></select></label></div><label>Microphone<select value={preferences.microphoneId} onChange={e => onChange({ ...preferences, microphoneId: e.target.value })}><option value="">System default</option>{devices.filter(d => d.deviceId !== 'default').map((d,i) => <option value={d.deviceId} key={d.deviceId || i}>{d.label || `Microphone ${i + 1}`}</option>)}</select></label>
    {mac && preferences.provider === 'parakeet' && <p className="notice warning">This saved engine is only available on Windows. Select Apple system speech or an external Whisper server on this Mac.</p>}
    {preferences.provider === 'parakeet' && <p className="muted">Automatic language detection</p>}
    <MicrophoneMeter deviceId={preferences.microphoneId} onDevices={setDevices}/>
    {preferences.provider !== 'browser' ? <><label>Voice response<select value={preferences.voiceLatency} onChange={e => onChange({ ...preferences, voiceLatency: e.target.value as Preferences['voiceLatency'] })}><option value="responsive">Responsive · faster word highlighting</option><option value="steady">Steady · more context, lower request rate</option></select></label><p className="muted">Reconnect the microphone after changing voice settings.</p>{preferences.provider === 'system' ? <SystemSpeechSettings preferences={preferences} report={report}/> : preferences.provider === 'parakeet' ? (mac ? null : <ParakeetSetup preferences={preferences} onChange={onChange} report={report}/>) : <WhisperConnection preferences={preferences} onChange={onChange} report={report}/>}</> : <div className="notice warning">Browser recognition may use an online service and is not available in every Electron version. Local recognition is recommended for desktop. Automatic uses English in this mode.</div>}</section>
    <VoiceCommandsSettings preferences={preferences} onChange={onChange}/>
    <CloudSettings preferences={preferences} onChange={onChange} report={report}/>
    {preferences.provider === 'whisper' && !mac && <section className="settings-card"><h2>Whisper models</h2><ModelPicker preferences={preferences} onChange={onChange} report={report}/></section>}
    <section className="settings-card"><h2>Playback</h2><Range label="Countdown" value={preferences.countdown} min={0} max={15} suffix=" s" onChange={v => onChange({ ...preferences, countdown: v })}/><Toggle label="Loop at end of script" checked={preferences.loop} onChange={v => onChange({ ...preferences, loop: v })}/></section>
    <section className="settings-card"><h2>Joystick / Gamepad</h2><Toggle label="Enable controller buttons" checked={preferences.gamepadEnabled} onChange={v => onChange({ ...preferences, gamepadEnabled: v })}/><GamepadAssignments preferences={preferences} onChange={onChange}/></section>
    <section className="settings-card"><h2><Keyboard size={21}/>Keyboard shortcuts</h2><KeyboardShortcuts preferences={preferences} onChange={onChange}/></section>
    <UpdateSettings report={report}/>
  </div>;
}
