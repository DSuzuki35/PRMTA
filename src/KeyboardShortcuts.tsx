import { useEffect, useRef, useState } from 'react';
import type { Preferences } from '../shared/model';
import { defaultShortcuts, formatShortcut, reservedShortcut, shortcutActions, ShortcutCapture, shortcutsSchema, type ShortcutAction } from '../shared/shortcuts';
import { Range, Toggle } from './AppearancePanel';
import './KeyboardShortcuts.css';

const groups = [...new Set(shortcutActions.map(action => action.group))];

export function KeyboardShortcuts({ preferences, onChange }: { preferences: Preferences; onChange: (p: Preferences) => void }) {
  const [assigning, setAssigning] = useState<ShortcutAction | null>(null);
  const [status, setStatus] = useState('');
  const latest = useRef({ preferences, onChange });
  latest.current = { preferences, onChange };

  useEffect(() => {
    if (!assigning) return;
    const capture = new ShortcutCapture();
    const cancel = () => { setAssigning(null); setStatus('Assignment cancelled.'); };
    const keydown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code === 'Escape') { cancel(); return; }
      const binding = capture.press(event);
      if (!binding) return;
      setStatus(`Release ${formatShortcut(binding)} to finish assigning.`);
    };
    const keyup = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const binding = capture.release(event);
      if (!binding) return;
      const { preferences: current, onChange: save } = latest.current;
      const reserved = reservedShortcut(binding);
      const duplicate = shortcutActions.find(action => action.id !== assigning && current.shortcuts[action.id] === binding);
      const shortcuts = { ...current.shortcuts, [assigning]: binding };
      const checked = shortcutsSchema.safeParse(shortcuts);
      if (reserved || duplicate || !checked.success) {
        setStatus(reserved ?? (duplicate ? `${formatShortcut(binding)} is already assigned to ${duplicate.label}. Clear that assignment or choose another shortcut.` : 'This key combination cannot be assigned. Choose another shortcut.'));
        return;
      }
      save({ ...current, shortcuts: checked.data });
      setAssigning(null);
      setStatus(`${formatShortcut(binding)} assigned to ${shortcutActions.find(action => action.id === assigning)!.label}.`);
    };
    const visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup, true);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [assigning]);

  return <div className="keyboard-shortcuts" data-assigning={!!assigning}>
    <p className="muted">Shortcuts work while PRMTA is focused. Typing, Settings and open dialogs suspend playback shortcuts.</p>
    <p className="muted">Win / Cmd shortcuts depend on your operating system. Some combinations may be handled by the system before PRMTA receives them.</p>
    <Toggle label="Keep voice follow active after keyboard navigation" checked={preferences.keyboardKeepVoiceActive} onChange={keyboardKeepVoiceActive => onChange({ ...preferences, keyboardKeepVoiceActive })}/>
    <p className="muted">Hold a scroll shortcut to move smoothly; release to stop. Voice following resumes on release when enabled. Paused takes stay paused.</p>
    <Range label="Keyboard held scroll speed (WPM)" min={20} max={400} step={10} value={preferences.keyboardScrollSpeed} suffix=" words per minute" onChange={keyboardScrollSpeed => onChange({ ...preferences, keyboardScrollSpeed })}/>
    <div className="keyboard-shortcut-instructions">
      <p className="muted" id="keyboard-capture-help">Choose Assign shortcut, then press and release a key combination. Esc cancels. Key names use physical positions on a US keyboard.</p>
      <button type="button" className="button secondary" disabled={!!assigning} onClick={() => {
        onChange({ ...preferences, shortcuts: { ...defaultShortcuts } });
        setStatus('Default keyboard shortcuts restored.');
      }}>Reset keyboard shortcuts</button>
    </div>
    <p className="assignment-status keyboard-shortcut-status" role="status" aria-live="polite">{status || 'Each shortcut can be assigned to one action.'}</p>
    {groups.map(group => <fieldset className="keyboard-shortcut-group" key={group}>
      <legend>{group}</legend>
      {shortcutActions.filter(action => action.group === group).map(({ id, label }) => <div className="keyboard-shortcut-row" key={id}>
        <span id={`shortcut-label-${id}`}>{label}</span>
        <div className="keyboard-shortcut-controls">
          <output aria-labelledby={`shortcut-label-${id}`}>{formatShortcut(preferences.shortcuts[id])}</output>
          <button type="button" className="button secondary" aria-label={`${assigning === id ? 'Cancel' : 'Assign'} ${label.toLowerCase()} shortcut`} aria-describedby="keyboard-capture-help" aria-pressed={assigning === id} disabled={!!assigning && assigning !== id} onClick={() => {
            if (assigning === id) { setAssigning(null); setStatus('Assignment cancelled.'); }
            else { setAssigning(id); setStatus(`Press and release a shortcut for ${label}. Esc cancels.`); }
          }}>{assigning === id ? 'Cancel' : 'Assign shortcut'}</button>
          <button type="button" className="text-button" aria-label={`Clear ${label.toLowerCase()} shortcut`} disabled={!!assigning || preferences.shortcuts[id] === null} onClick={() => {
            onChange({ ...preferences, shortcuts: { ...preferences.shortcuts, [id]: null } });
            setStatus(`${label} shortcut cleared.`);
          }}>Clear</button>
        </div>
      </div>)}
    </fieldset>)}
  </div>;
}
