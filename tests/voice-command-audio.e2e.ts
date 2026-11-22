import { test as base, expect, chromium, type Page, type Route } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHost, type Host } from '../server/host';
import { defaultPreferences, type Command } from '../shared/model';

type AudioRequest = { at: number; trailingSilence: number; position: number; playing: boolean };
type AudioApp = { page: Page; host: Host; commands: Command[]; requests: AudioRequest[]; respond: (handler: (request: AudioRequest, route: Route) => Promise<void>) => void; post: (command: Command) => Promise<void> };

// Chromium consumes a real PCM file, so VAD, capture windows, WAV conversion and
// stale-request guards all execute. Only the external recognizer is replaced.
function speechAndSilence(): Buffer {
  const sampleRate = 48000, seconds = 26, pcm = Buffer.alloc(44 + sampleRate * seconds * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write('WAVEfmt ', 8);
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(sampleRate, 24); pcm.writeUInt32LE(sampleRate * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36); pcm.writeUInt32LE(pcm.length - 44, 40);
  for (let i = 0; i < sampleRate * seconds; i++) {
    const time = i / sampleRate, phase = (time - 1) % 2.6;
    const value = time >= 1 && phase < 1.2 ? Math.sin(2 * Math.PI * 220 * time) * (.18 + .12 * Math.sin(2 * Math.PI * 4 * time)) : 0;
    pcm.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  return pcm;
}

function trailingSilence(wav: Buffer): number {
  const rate = wav.readUInt32LE(24), samples = (wav.length - 44) / 2;
  let lastLoud = samples - 1;
  while (lastLoud >= 0 && Math.abs(wav.readInt16LE(44 + lastLoud * 2)) < 260) lastLoud--;
  return (samples - lastLoud - 1) / rate;
}

const test = base.extend<{ audioApp: AudioApp }>({
  audioApp: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'prmta-command-audio-')), audioFile = join(dir, 'utterances.wav');
    writeFileSync(audioFile, speechAndSilence());
    let host: Host | undefined, vite: ViteDevServer | undefined;
    const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${audioFile}`] });
    try {
      host = await createHost({ dataDir: dir, port: 0 });
      const headers = { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' };
      await fetch(`${host.origin}/api/preferences`, { method: 'POST', headers, body: JSON.stringify({ ...defaultPreferences, provider: 'whisper', voiceCommandsEnabled: true, countdown: 0 }) });
      host.session.load({ id: 'commands', title: 'Command audio', content: 'First sentence here. Second sentence here. Third sentence here. Fourth sentence here.\n---\nPrompta next sentence appears in this script. More closing words remain.' });
      vite = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, proxy: { '/api': host.origin, '/ws': { target: host.origin, ws: true } } } });
      await vite.listen();
      const page = await browser.newPage(), commands: Command[] = [], requests: AudioRequest[] = [];
      let responder = async (_request: AudioRequest, route: Route) => { await route.fulfill({ json: { text: '' } }); };
      await page.route(/\/api\/speech\/status(?:\?|$)/, route => route.fulfill({ json: { ok: true, message: 'Ready' } }));
      await page.route(/\/api\/speech\/models(?:\?|$)/, route => route.fulfill({ json: { managed: false, activeModel: 'base', models: [] } }));
      await page.route(/\/api\/speech\/start(?:\?|$)/, route => route.fulfill({ json: { ok: true } }));
      await page.route(/\/api\/command$/, async route => { commands.push(route.request().postDataJSON()); await route.continue(); });
      await page.route(/\/api\/speech(?:\?|$)/, async route => {
        const request = { at: Date.now(), trailingSilence: trailingSilence(route.request().postDataBuffer()!), position: host!.session.state.position, playing: host!.session.state.playing };
        requests.push(request); await responder(request, route);
      });
      await page.goto(`${vite.resolvedUrls!.local[0]}#${host.tokens.admin}`);
      await page.getByText('Studio connected', { exact: true }).waitFor();
      const currentHost = host;
      await use({ page, host, commands, requests, respond: handler => { responder = handler; }, post: async command => {
        const result = await fetch(`${currentHost.origin}/api/command`, { method: 'POST', headers, body: JSON.stringify(command) });
        expect(result.ok).toBe(true);
      } });
    } finally {
      for (const context of browser.contexts()) await context.close();
      await browser.close(); await vite?.close(); await host?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
});

test('listens while paused and executes play only after the audio finishes', async ({ audioApp: app }) => {
  app.respond(async (_request, route) => { await route.fulfill({ json: { text: 'prompta play' } }); });
  await app.page.getByRole('button', { name: 'Enable voice', exact: true }).click();
  await expect(app.page.getByRole('button', { name: 'Mic on', exact: true })).toBeVisible();
  await expect.poll(() => app.requests.length).toBeGreaterThan(0);
  expect(app.requests[0].playing).toBe(false);
  expect(app.requests[0].trailingSilence).toBeLessThan(.85);
  expect(app.host.session.state.playing).toBe(false);
  await expect.poll(() => app.host.session.state.playing, { timeout: 10000 }).toBe(true);
  await app.page.getByRole('button', { name: 'Mic on', exact: true }).click();
  expect(app.requests.some(request => request.trailingSilence >= .65)).toBe(true);
  expect(app.commands.filter(command => command.type === 'play')).toHaveLength(1);
  expect(app.commands.filter(command => command.type === 'transcript')).toEqual([]);
  expect(app.host.session.state.position).toBe(0);
});

test('suppresses interim next, deduplicates rolling commands and rearms after a fresh utterance', async ({ audioApp: app }) => {
  app.respond(async (request, route) => { await route.fulfill({ json: { text: request.trailingSilence < .65 ? 'prompta next' : 'prompta next sentence' } }); });
  await app.page.getByRole('button', { name: 'Enable voice', exact: true }).click();
  await expect(app.page.getByRole('button', { name: 'Mic on', exact: true })).toBeVisible();
  await expect.poll(() => app.host.session.state.mode).toBe('voice');
  await app.post({ type: 'play', countdown: 0 });
  await expect.poll(() => app.requests.length).toBeGreaterThan(0);
  expect(app.host.session.state.position).toBe(0);
  await expect.poll(() => app.host.session.state.position, { timeout: 10000 }).toBe(3);
  await expect.poll(() => app.host.session.state.position, { timeout: 10000 }).toBe(6);
  await app.page.getByRole('button', { name: 'Mic on', exact: true }).click();
  const navigation = app.commands.filter(command => command.type === 'navigate');
  expect(navigation).toHaveLength(2);
  expect(navigation.every(command => command.unit === 'sentence' && command.direction === 1)).toBe(true);
  expect(app.requests.length).toBeGreaterThanOrEqual(4);
  expect(app.commands.filter(command => command.type === 'transcript')).toEqual([]);
  expect(app.host.session.state.speech.transcript).toBe('');
});

test('drops a recognition response when manual navigation changes its capture context', async ({ audioApp: app }) => {
  let pending: Route | undefined;
  app.respond(async (request, route) => {
    if (request.trailingSilence >= .7 && !pending) { pending = route; return; }
    await route.fulfill({ json: { text: '' } });
  });
  await app.page.getByRole('button', { name: 'Enable voice', exact: true }).click();
  await expect(app.page.getByRole('button', { name: 'Mic on', exact: true })).toBeVisible();
  await expect.poll(() => !!pending, { timeout: 10000 }).toBe(true);
  await app.page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect.poll(() => app.host.session.state.position).toBe(12);
  await pending!.fulfill({ json: { text: 'prompta reset' } });
  await app.page.waitForTimeout(700);
  expect(app.host.session.state.position).toBe(12);
  expect(app.commands.filter(command => command.type === 'reset')).toEqual([]);
  expect(app.commands.filter(command => command.type === 'transcript')).toEqual([]);
  await app.page.getByRole('button', { name: 'Mic on', exact: true }).click();
});
