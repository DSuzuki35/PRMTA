import { useEffect, useState } from 'react';
import type { Preferences } from '../shared/model';
import { Toggle } from './AppearancePanel';

export function VoiceCommandsSettings({ preferences, onChange }: { preferences: Preferences; onChange: (p: Preferences) => void }) {
  const [wake, setWake] = useState(preferences.voiceCommandWakeWord);
  useEffect(() => setWake(preferences.voiceCommandWakeWord), [preferences.voiceCommandWakeWord]);
  const valid = wake.trim().length >= 2 && wake.trim().length <= 32 && /^[\p{L}][\p{L} '-]*$/u.test(wake.trim());
  return <section className="settings-card voice-commands-settings">
    <h2>Voice commands</h2>
    <Toggle label="Enable voice commands" checked={preferences.voiceCommandsEnabled} onChange={voiceCommandsEnabled => onChange({ ...preferences, voiceCommandsEnabled })}/>
    <p className="muted">Commands listen only while the microphone is on. They also work while playback is paused. Pause briefly before and after a command; ordinary script reading continues to use voice following.</p>
    <form onSubmit={event => { event.preventDefault(); if (valid) onChange({ ...preferences, voiceCommandWakeWord: wake.trim().toLowerCase() }); }}>
      <label className="voice-wake-field">Wake phrase<input value={wake} maxLength={32} onChange={event => setWake(event.target.value)} aria-invalid={!valid}/></label>
      <button type="submit" className="button secondary" disabled={!valid || wake.trim().toLowerCase() === preferences.voiceCommandWakeWord}>Apply wake phrase</button>
    </form>
    <p className="muted">Start each command with “{preferences.voiceCommandWakeWord}”. Commands are ignored in Settings, while editing, and while assigning controls. Use a different wake phrase if it occurs in your script.</p>
    <div className="shortcut-grid">{[
      ['next / previous sentence', 'Move one sentence'], ['next / previous paragraph', 'Move one paragraph'],
      ['next / previous page', 'Move one script page'], ['next / previous chapter', 'Move between headings'],
      ['play / pause', 'Start or pause playback'], ['reset / back to start', 'Return to the beginning'],
      ['faster / slower', 'Change speed by 5 WPM'], ['blackout', 'Toggle output blackout'],
      ['voice / auto / manual mode', 'Change playback mode'],
    ].map(([phrase, description]) => <div key={phrase}><kbd>{phrase}</kbd><span>{description}</span></div>)}</div>
    <p className="muted">“Next” and “previous” alone mean page navigation. Chapters use Markdown headings such as # Introduction; without headings, explicit --- separators define chapters. Repeated recognition of one command is ignored.</p>
  </section>;
}
