import { useEffect, useRef, useState } from 'react';
import type { Preferences } from '../shared/model';
import { ButtonCapture } from '../shared/gamepad';
export function GamepadAssignments({ preferences, onChange }: { preferences: Preferences; onChange: (p: Preferences) => void }) {
  const [assigning, setAssigning] = useState<'previousButton' | 'nextButton' | null>(null), [status, setStatus] = useState('');
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
        const other = assigning === 'previousButton' ? 'nextButton' : 'previousButton';
        if (found.button === latest.current.preferences[other]) { setAssigning(null); setStatus(`Button ${found.button} is already assigned to ${other === 'nextButton' ? 'Next page' : 'Previous page'}. Choose a different button.`); return; }
        latest.current.onChange({ ...latest.current.preferences, [assigning]: found.button }); setAssigning(null); setStatus(`Button ${found.button} assigned to ${assigning === 'previousButton' ? 'Previous page' : 'Next page'}.`); return;
      }
      setStatus(capture.awaitingRelease ? 'Release the button to finish assigning.' : pads.some(Boolean) ? 'Press and release a button. Already-held buttons are ignored.' : 'Connect a controller and press a button once to wake it, then press and release to assign.');
    }, 25);
    return () => { clearInterval(timer); window.removeEventListener('keydown', keyboard); };
  }, [assigning]);
  return <div className="gamepad-assignments"><div className="two-fields">{(['previousButton', 'nextButton'] as const).map(key => <div className="assignment-field" key={key}><span>{key === 'previousButton' ? 'Previous page' : 'Next page'}</span><div className="assignment-control"><output>Button {preferences[key]}</output><button type="button" className="button secondary" aria-label={`Assign ${key === 'previousButton' ? 'previous' : 'next'} page button`} disabled={!!assigning && assigning !== key} onClick={() => { if (assigning === key) { setAssigning(null); setStatus('Assignment cancelled.'); } else { setAssigning(key); setStatus('Press and release a button.'); } }}>{assigning === key ? 'Cancel' : 'Assign button'}</button></div></div>)}</div>{status && <p className="assignment-status" role="status">{status}</p>}<p className="muted">A complete release → press → release cycle is required. Page navigation is suspended in Settings. Press Esc to cancel.</p></div>;
}
