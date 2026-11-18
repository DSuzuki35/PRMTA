import { useEffect, useRef, useState } from 'react';
import { gamepadActions, type GamepadActionKey, type Preferences } from '../shared/model';
import { ButtonCapture } from '../shared/gamepad';
import { Range } from './AppearancePanel';
export function GamepadAssignments({ preferences, onChange }: { preferences: Preferences; onChange: (p: Preferences) => void }) {
  const [assigning, setAssigning] = useState<GamepadActionKey | null>(null), [status, setStatus] = useState('');
  const latest = useRef({ preferences, onChange }); latest.current = { preferences, onChange };
  useEffect(() => {
    if (!assigning) return;
    const capture = new ButtonCapture(), deadline = Date.now() + 30000;
    const cancel = () => { setAssigning(null); setStatus('Assignment cancelled.'); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
    window.addEventListener('keydown', keyboard);
    const timer = setInterval(() => {
      if (Date.now() > deadline) { setAssigning(null); setStatus('No full button press detected. Try again.'); return; }
      const pads = navigator.getGamepads?.() ?? []; const found = capture.sample(pads);
      if (found) {
        const other = gamepadActions.find(action => action.key !== assigning && found.button === latest.current.preferences[action.key]);
        if (other) { setAssigning(null); setStatus(`Button ${found.button} is already assigned to ${other.label}. Clear that assignment or choose a different button.`); return; }
        latest.current.onChange({ ...latest.current.preferences, [assigning]: found.button }); setAssigning(null); setStatus(`Button ${found.button} assigned to ${gamepadActions.find(action => action.key === assigning)!.label}.`); return;
      }
      setStatus(capture.awaitingRelease ? 'Release the button to finish assigning.' : pads.some(Boolean) ? 'Press and release a button. Already-held buttons are ignored.' : 'Connect a controller and press a button once to wake it, then press and release to assign.');
    }, 25);
    return () => { clearInterval(timer); window.removeEventListener('keydown', keyboard); };
  }, [assigning]);
  return <div className="gamepad-assignments"><div className="two-fields">{gamepadActions.map(({ key, label }) => <div className="assignment-field" key={key}><span>{label}</span><div className="assignment-control"><output>{preferences[key] === null ? 'Unassigned' : `Button ${preferences[key]}`}</output><button type="button" className="button secondary" aria-label={`Assign ${label.toLowerCase()} button`} disabled={!!assigning && assigning !== key} onClick={() => { if (assigning === key) { setAssigning(null); setStatus('Assignment cancelled.'); } else { setAssigning(key); setStatus('Press and release a button.'); } }}>{assigning === key ? 'Cancel' : 'Assign button'}</button><button type="button" className="text-button" aria-label={`Clear ${label.toLowerCase()} button`} disabled={!!assigning || preferences[key] === null} onClick={() => { onChange({ ...preferences, [key]: null }); setStatus(`${label} cleared.`); }}>Clear</button></div></div>)}</div>
    <Range label="Held scroll speed (WPM)" min={20} max={400} step={10} value={preferences.gamepadScrollSpeed} suffix=" words per minute" onChange={gamepadScrollSpeed => onChange({ ...preferences, gamepadScrollSpeed })}/>
    {status && <p className="assignment-status" role="status">{status}</p>}<p className="muted">A complete release → press → release cycle is required. All controller actions are suspended in Settings and dialogs. Press Esc to cancel assignment.</p><p className="muted">Hold a scroll button to move smoothly; release to stop. Controller navigation pauses playback. Scrolling uses continuous text; page layout returns with navigation or playback.</p></div>;
}
