import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHost } from '../server/host';

it('uses the current Whisper endpoint for setup and status before preferences finish saving', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prmta-port-'));
  const speech = createServer((req, res) => { req.resume(); res.setHeader('Content-Type', 'application/json'); res.end(req.url === '/inference' ? '{"text":"one two three"}' : '{"status":"ok"}'); });
  await new Promise<void>(resolve => speech.listen(0, '127.0.0.1', resolve));
  const whisperUrl = `http://127.0.0.1:${(speech.address() as AddressInfo).port}`;
  let started: unknown;
  const host = await createHost({ dataDir: dir, port: 0, ensureSpeech: async (url, model) => { started = { url, model }; } });
  const headers = { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' };
  try {
    const response = await fetch(`${host.origin}/api/speech/start`, { method: 'POST', headers, body: JSON.stringify({ whisperUrl, model: 'turbo-q5' }) });
    expect(response.status).toBe(200);
    expect(started).toEqual({ url: whisperUrl, model: 'turbo-q5' });
    const status = await fetch(`${host.origin}/api/speech/status?whisperUrl=${encodeURIComponent(whisperUrl)}`, { headers });
    expect((await status.json()).ok).toBe(true);
    // An active capture keeps its chosen endpoint even if stored preferences differ.
    const wav = Buffer.alloc(44); wav.write('RIFF'); wav.write('WAVE', 8);
    const transcript = await fetch(`${host.origin}/api/speech?whisperUrl=${encodeURIComponent(whisperUrl)}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'audio/wav' }, body: wav });
    expect(await transcript.json()).toEqual({ text: 'one two three' });
    const invalid = await fetch(`${host.origin}/api/speech/start`, { method: 'POST', headers, body: JSON.stringify({ whisperUrl: 'http://example.com:18080' }) });
    expect(invalid.ok).toBe(false);
    expect(started).toEqual({ url: whisperUrl, model: 'turbo-q5' });
  } finally { await host.close(); await new Promise<void>(resolve => speech.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); }
});

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
