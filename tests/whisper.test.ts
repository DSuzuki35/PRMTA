import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Replace only the native executable with a real HTTP child process.
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: (_exe: string, args: string[], options: object) => actual.spawn(process.execPath, [resolve('tests/fixtures/whisper-server.mjs'), ...args], options) };
});
import { WhisperService } from '../electron/whisper';

let root: string, service: WhisperService;
const servers: Server[] = [];
async function listen(server = createServer()) {
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function freeUrl() { const server = createServer(); const url = await listen(server); await new Promise<void>(resolve => server.close(() => resolve())); return url; }
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'prmta-whisper-'));
  mkdirSync(join(root, 'Release')); writeFileSync(join(root, 'Release', 'whisper-server.exe'), 'fixture');
  service = new WhisperService(root, model => `${model}.bin`, 'win32');
});
afterEach(async () => {
  service.close();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
it('starts the selected model on a custom port and moves it when the port changes', async () => {
  const first = await freeUrl(), second = await freeUrl();
  await service.ensure(first, 'turbo-q5');
  expect(await (await fetch(`${first}/health`)).json()).toEqual({ status: 'ok', model: 'turbo-q5.bin' });
  await service.ensure(second, 'turbo-q5');
  expect(await (await fetch(`${second}/health`)).json()).toEqual({ status: 'ok', model: 'turbo-q5.bin' });
  await expect(fetch(`${first}/health`)).rejects.toThrow();
  expect(service.activeModel).toBe('turbo-q5');
});
it('reports an occupied port without touching the other application', async () => {
  const url = await listen(createServer((_req, res) => { res.writeHead(404); res.end('another app'); }));
  await expect(service.ensure(url)).rejects.toThrow(/port .*in use/i);
  expect(await (await fetch(`${url}/health`)).text()).toBe('another app');
  expect(service.activeModel).toBeNull();
});
it('does not replace an independently started Whisper model', async () => {
  const url = await listen(createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"status":"ok"}'); }));
  await expect(service.ensure(url, 'turbo-q5')).rejects.toThrow(/separate.*port/i);
  expect((await fetch(`${url}/health`)).ok).toBe(true);
});
it.each(['http://127.0.0.1:0', 'http://127.0.0.1:65536', 'https://127.0.0.1:18080', 'http://example.com:18080', 'http://user:pass@127.0.0.1:18080'])('rejects invalid or nonlocal endpoints: %s', async url => {
  await expect(service.ensure(url)).rejects.toThrow(/local HTTP|port/i);
});
it('rejects a Fetch-blocked port before launching a server', async () => {
  await expect(service.ensure('http://127.0.0.1:6000')).rejects.toThrow(/port 6000.*reserved/i);
}, 1000);

it('uses an external Mac Whisper server without Windows binaries or downloaded models', async () => {
  rmSync(join(root, 'Release'), { recursive: true });
  service = new WhisperService(root, () => null, 'darwin');
  const url = await listen(createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"status":"ok"}'); }));
  await expect(service.ensure(url, 'turbo-q5')).resolves.toBeUndefined();
  expect(service.activeModel).toBeNull();
  service.close();
  expect((await fetch(`${url}/health`)).ok).toBe(true);
});

it('guides Mac users to their external server without attempting Windows startup', async () => {
  service = new WhisperService(root, () => null, 'darwin');
  await expect(service.ensure(await freeUrl())).rejects.toThrow(/external Whisper server/i);
});
