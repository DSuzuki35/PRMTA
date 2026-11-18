import { useEffect, useRef, useState } from 'react';
import { gamepadActions, type GamepadActionKey, type Preferences } from '../shared/model';
import { ButtonCapture } from '../shared/gamepad';
import { Range, Toggle } from './AppearancePanel';
export function GamepadAssignments({ preferences, onChange }: { preferences: Preferences; onChange: (p: Preferences) => void }) {
  const [assigning, setAssigning] = useState<GamepadActionKey | null>(null), [status, setStatus] = useState('');
  const [nativeStatus, setNativeStatus] = useState(''), [fallback, setFallback] = useState(false);
  const latest = useRef({ preferences, onChange }); latest.current = { preferences, onChange };
  useEffect(() => {
    if (!window.desktop?.controllerState) return;
    let active = true, busy = false;
    const refresh = async () => {
      if (busy) return; busy = true;
      try {
        const state = await window.desktop!.controllerState();
        if (active) setFallback(state.fallback === true);
        if (active) setNativeStatus(state.status === 'ready' ? state.pads.length ? `Connected: ${state.pads.map(pad => pad.name).join(', ')}` : 'Native controller input ready. Connect a joystick or gamepad.' : state.message);
      } catch (error) { if (active) setNativeStatus(`Controller input unavailable. ${String(error)}`); }
      finally { busy = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!assigning) return;
    let active = true, busy = false;
    const capture = new ButtonCapture(), deadline = Date.now() + 30000;
    const cancel = () => { setAssigning(null); setStatus('Assignment cancelled.'); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
    window.addEventListener('keydown', keyboard);
    const timer = setInterval(async () => {
      if (busy) return; busy = true;
      try {
      if (Date.now() > deadline) { setAssigning(null); setStatus('No full button press detected. Try again.'); return; }
      const native = window.desktop?.controllerState ? await window.desktop.controllerState() : null;
      if (!active) return;
      if (native && !native.fallback && native.status !== 'ready') { setAssigning(null); setStatus(native.message); return; }
      const pads = native && !native.fallback ? native.pads : navigator.getGamepads?.() ?? []; const found = capture.sample(pads);
      if (found) {
        const other = gamepadActions.find(action => action.key !== assigning && found.button === latest.current.preferences[action.key]);
        if (other) { setAssigning(null); setStatus(`Button ${found.button} is already assigned to ${other.label}. Clear that assignment or choose a different button.`); return; }
        latest.current.onChange({ ...latest.current.preferences, [assigning]: found.button }); setAssigning(null); setStatus(`Button ${found.button} assigned to ${gamepadActions.find(action => action.key === assigning)!.label}.`); return;
      }
      setStatus(capture.awaitingRelease ? 'Release the button to finish assigning.' : pads.some(Boolean) ? 'Press and release a button. Already-held buttons are ignored.' : 'Connect a controller and press a button once to wake it, then press and release to assign.');
      } catch (error) { if (active) { setAssigning(null); setStatus(`Could not read controller input. ${String(error)}`); } }
      finally { busy = false; }
    }, 25);
    return () => { active = false; clearInterval(timer); window.removeEventListener('keydown', keyboard); };
  }, [assigning]);
  return <div className="gamepad-assignments" data-assigning={!!assigning}>
    <Toggle label="Controller input in background" checked={preferences.gamepadBackground} onChange={gamepadBackground => onChange({ ...preferences, gamepadBackground })}/>
    <Toggle label="Keep voice follow active" checked={preferences.gamepadKeepVoiceActive} onChange={gamepadKeepVoiceActive => onChange({ ...preferences, gamepadKeepVoiceActive })}/>
    <p className="muted">Voice follow stays active after navigation when enabled. Holding a scroll button gives manual movement priority; voice following resumes on release. Paused takes stay paused.</p>
    <p className="muted">{fallback ? 'Native background input is unavailable. Foreground browser input is active; use Assign button to confirm the button numbers. Restart PRMTA to retry native input.' : window.desktop?.controllerState ? 'Background input works while another app is focused or PRMTA is minimized. Settings, typing and dialogs suspend controls while PRMTA is focused; button assignment always suspends navigation.' : 'Background input requires the Windows desktop app. Browser controllers work while this tab has focus.'}</p>
    {nativeStatus && <p className="muted">{nativeStatus} Native button numbers on some joysticks may differ from older browser bindings. Use Assign button to confirm them.</p>}
    <div className="two-fields">{gamepadActions.map(({ key, label }) => <div className="assignment-field" key={key}><span>{label}</span><div className="assignment-control"><output>{preferences[key] === null ? 'Unassigned' : `Button ${preferences[key]}`}</output><button type="button" className="button secondary" aria-label={`Assign ${label.toLowerCase()} button`} disabled={!!assigning && assigning !== key} onClick={() => { if (assigning === key) { setAssigning(null); setStatus('Assignment cancelled.'); } else { setAssigning(key); setStatus('Press and release a button.'); } }}>{assigning === key ? 'Cancel' : 'Assign button'}</button><button type="button" className="text-button" aria-label={`Clear ${label.toLowerCase()} button`} disabled={!!assigning || preferences[key] === null} onClick={() => { onChange({ ...preferences, [key]: null }); setStatus(`${label} cleared.`); }}>Clear</button></div></div>)}</div>
    <Range label="Held scroll speed (WPM)" min={20} max={400} step={10} value={preferences.gamepadScrollSpeed} suffix=" words per minute" onChange={gamepadScrollSpeed => onChange({ ...preferences, gamepadScrollSpeed })}/>
    {status && <p className="assignment-status" role="status">{status}</p>}<p className="muted">A complete release → press → release cycle is required. Press Esc to cancel assignment.</p><p className="muted">Hold a scroll button to move smoothly; release to stop. Auto playback pauses on controller navigation. Manual scrolling temporarily uses continuous text.</p></div>;
}
