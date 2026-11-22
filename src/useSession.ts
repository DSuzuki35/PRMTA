import { useEffect, useState } from 'react';
import { defaultPreferences, type SessionState } from '../shared/model';
import { token, type StateMessage } from './api';
const initial: SessionState = { script: null, position: 0, playing: false, mode: 'timed', speed: 130, blackout: false, loop: false, countdownUntil: 0, elapsed: 0, updatedAt: 0, transportRevision: 0, speech: { transcript: '', confidence: 0, status: 'Ready' } };
export function useSession(onLibrary?: () => void) {
  const [session, setSession] = useState(initial); const [preferences, setPreferences] = useState(defaultPreferences);
  const [connected, setConnected] = useState(false);
  const [workspace, setWorkspace] = useState('local');
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  useEffect(() => {
    let dead = false; let ws: WebSocket; let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`, ['prmpt', token]);
      ws.onopen = () => setConnected(true);
      ws.onmessage = event => {
        const data: StateMessage = JSON.parse(event.data);
        if (data.session) setSession(previous => ({ ...previous, ...data.session, script: data.session!.script === undefined ? previous.script : data.session!.script }));
        // Output and remote clients receive only public appearance/countdown
        // preferences. Keep safe local control defaults for omitted private keys.
        if (data.preferences) setPreferences({ ...defaultPreferences, ...data.preferences });
        if (data.workspace) setWorkspace(data.workspace);
        if (data.upgradeRequired !== undefined) setUpgradeRequired(data.upgradeRequired);
        if (data.type === 'library') onLibrary?.();
      };
      ws.onclose = () => { setConnected(false); if (!dead) retry = setTimeout(connect, 1500); };
      ws.onerror = () => ws.close();
    };
    if (token) connect();
    return () => { dead = true; clearTimeout(retry); ws?.close(); };
  }, [onLibrary]);
  return { session, preferences, connected, workspace, upgradeRequired };
}
