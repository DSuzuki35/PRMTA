import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHost, type Host } from '../server/host';

let host: Host, vite: ViteDevServer, dir: string, url: string;
let started: { url: string; model: string } | undefined;
test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'prmta-whisper-ui-'));
  host = await createHost({ dataDir: dir, port: 0,
    ensureSpeech: async (url, model) => { started = { url, model }; },
    models: { list: () => ({ managed: true, activeModel: null, models: [{ id: 'base', installed: true, downloading: false, received: 0, error: '' }] }), install: () => {} },
  });
  // Serve sources so this regression can run without building a Windows release.
  vite = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, proxy: { '/api': host.origin, '/ws': { target: host.origin, ws: true } } } });
  await vite.listen();
  url = `${vite.resolvedUrls!.local[0]}#${host.tokens.admin}`;
});
test.afterAll(async () => { await vite?.close(); await host?.close(); rmSync(dir, { recursive: true, force: true }); });
test('applies a custom port, starts the bundled engine and preserves it after reload', async ({ page }) => {
  await page.goto(url);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Whisper port', { exact: true }).fill('18080');
  await page.getByRole('button', { name: 'Apply server', exact: true }).click();
  await expect(page.getByLabel('Local model', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set up voice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Voice ready', exact: true })).toBeVisible();
  expect(started).toEqual({ url: 'http://127.0.0.1:18080', model: 'base' });
  await expect.poll(async () => (await (await page.request.get(`${host.origin}/api/state`, { headers: { Authorization: `Bearer ${host.tokens.admin}` } })).json()).preferences.whisperUrl).toBe('http://127.0.0.1:18080');
  await page.reload();
  await expect(page.getByLabel('Whisper port', { exact: true })).toHaveValue('18080');
  await page.getByLabel('Whisper port', { exact: true }).fill('0');
  await expect(page.getByRole('button', { name: 'Apply server', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Set up voice', exact: true })).toBeDisabled();
  await page.getByLabel('Local Whisper server', { exact: true }).fill('http://127.0.0.1:6000');
  await expect(page.getByRole('button', { name: 'Apply server', exact: true })).toBeDisabled();
  await page.getByLabel('Whisper port', { exact: true }).fill('18081');
  await expect(page.getByRole('button', { name: 'Apply server', exact: true })).toBeEnabled();
});
