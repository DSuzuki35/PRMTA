import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { createHost } from '../server/host';

it('authenticates library access and scopes output/remote capabilities', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prmpt-host-')); const host = await createHost({ dataDir: dir, port: 0 });
  try {
    const call = (path: string, token: string, body?: unknown) => fetch(`${host.origin}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect((await call('/api/scripts', '')).status).toBe(401);
    expect((await call('/api/scripts', host.tokens.output)).status).toBe(403);
    expect((await call('/api/command', host.tokens.output, { type: 'play' })).status).toBe(403);
    expect((await call('/api/preferences', host.tokens.remote, {})).status).toBe(403);
    expect((await call('/api/command', host.tokens.remote, { type: 'voiceActivity', active: true, transportRevision: 0 })).status).toBe(403);
    const draft = { id: randomUUID(), title: 'Host test', content: 'one two three four', tags: [] };
    const saved = await (await call('/api/scripts', host.tokens.admin, { draft, expectedHeads: [] })).json();
    expect(saved.title).toBe('Host test');
    expect((await call('/api/load', host.tokens.admin, { id: saved.id })).status).toBe(200);
    const state = await (await call('/api/state', host.tokens.output)).json(); expect(state.session.script.title).toBe('Host test');
    expect(state.preferences.cloudFolder).toBeUndefined();
    const changed = { ...saved, content: 'Edited while on air' };
    await call('/api/scripts', host.tokens.admin, { draft: changed, expectedHeads: saved.heads });
    const pinned = await (await call('/api/state', host.tokens.output)).json(); expect(pinned.session.script.content).toBe('one two three four');
    const ws = new WebSocket(`${host.origin.replace('http', 'ws')}/ws`, ['prmpt', host.tokens.output]);
    const message = await new Promise<string>((resolve, reject) => { ws.once('message', m => resolve(String(m))); ws.once('error', reject); });
    expect(JSON.parse(message).session.script.title).toBe('Host test'); ws.close();
    expect((await call('/api/command', host.tokens.remote, { type: 'seek', position: 2 })).status).toBe(200);
    expect((await call('/api/command', host.tokens.admin, { type: 'seek', position: 'invalid' })).status).toBe(400);
    await call('/api/command', host.tokens.admin, { type: 'speed', speed: 80 });
    const prefs = (await (await call('/api/state', host.tokens.admin)).json()).preferences;
    await call('/api/preferences', host.tokens.admin, { ...prefs, profiles: { ...prefs.profiles, studio: { ...prefs.profiles.studio, fontSize: 70 } } });
    expect(host.session.state.speed).toBe(80);
  } finally { await host.close(); rmSync(dir, { recursive: true, force: true }); }
});
it('revokes active LAN output connections when sharing is disabled', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prmpt-lan-')); const host = await createHost({ dataDir: dir, port: 0 });
  try {
    const setNetwork = (enabled: boolean) => fetch(`${host.origin}/api/network`, { method: 'POST', headers: { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }), signal: AbortSignal.timeout(2000) });
    const info = await (await setNetwork(true)).json();
    expect(info.lanEnabled).toBe(true);
    const target = new URL(info.lanUrls[0].output);
    const socket = new WebSocket(`ws://${target.host}/ws`, ['prmpt', host.tokens.output]);
    await new Promise<void>((resolve, reject) => { socket.once('open', () => resolve()); socket.once('error', reject); });
    const closed = new Promise<void>(resolve => socket.once('close', () => resolve()));
    expect((await setNetwork(false)).status).toBe(200); await closed;
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  } finally { await host.close(); rmSync(dir, { recursive: true, force: true }); }
});
