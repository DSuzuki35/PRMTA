import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHost, type Host } from '../server/host';
let host: Host, vite: ViteDevServer, dir: string, url: string;
test.beforeEach(async ({ page }) => {
  dir = mkdtempSync(join(tmpdir(), 'prmta-mac-settings-'));
  host = await createHost({ dataDir: dir, port: 0, defaultProvider: 'system' });
  vite = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, proxy: { '/api': host.origin, '/ws': { target: host.origin, ws: true } } } });
  await vite.listen(); url = `${vite.resolvedUrls!.local[0]}#${host.tokens.admin}`;
  await page.addInitScript(() => {
    (window as any).desktop = { platform: 'darwin', updateStatus: async () => ({ mode: 'macos-manual', currentVersion: '0.4.1', phase: 'unavailable', message: 'Download the macOS DMG to update.' }), onUpdateStatus: () => () => {}, openReleases: async () => {} };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => { throw new Error('No microphone in settings test'); } });
  });
  await page.goto(url); await page.getByRole('button', { name: 'Settings', exact: true }).click();
});
test.afterEach(async ({ page }) => { await page.close(); await vite?.close(); await host?.close(); rmSync(dir, { recursive: true, force: true }); });

test('Mac settings offer external Whisper without Windows installation or model downloads', async ({ page }) => {
  await expect(page.getByRole('combobox', { name: 'Speech recognition', exact: true }).locator('option[value=parakeet]')).toBeDisabled();
  await page.getByRole('combobox', { name: 'Speech recognition', exact: true }).selectOption('whisper');
  await expect(page.getByRole('button', { name: 'Download model', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Set up voice', exact: true })).toHaveCount(0);
  await page.route('**/api/speech/status?*', route => route.fulfill({ json: { ok: true, message: 'Whisper connected' } }));
  await page.getByRole('button', { name: 'Check connection', exact: true }).click();
  await expect(page.getByText('Whisper connected', { exact: true })).toBeVisible();
  await expect(page.getByText(/Windows app starts Whisper/)).toHaveCount(0);
  await expect(page.locator('[aria-labelledby="updates-heading"]')).not.toContainText('Windows');
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toHaveCount(0);
});

test('explicit Mac shortcut reset avoids Mission Control and preserves language', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Script language', exact: true }).selectOption('de');
  await expect.poll(() => host.getPreferences().language).toBe('de');
  await page.getByRole('button', { name: 'Reset keyboard shortcuts', exact: true }).click();
  await expect.poll(() => host.getPreferences().shortcuts.previousSentence).toBe('Meta+ArrowLeft');
  expect(host.getPreferences().shortcuts.nextParagraph).toBe('Meta+ArrowDown');
  expect(host.getPreferences().language).toBe('de');
});

test('saved Windows-only choices remain saved but do not expose unsupported Mac controls', async ({ page }) => {
  const preferences = { ...host.getPreferences(), provider: 'parakeet', gamepadBackground: true };
  await page.request.post(host.origin + '/api/preferences', { headers: { Authorization: `Bearer ${host.tokens.admin}` }, data: preferences });
  await page.reload();
  await expect(page.getByText(/This saved engine is only available on Windows/)).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Parakeet processing', exact: true })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Controller input in background', exact: true })).toHaveCount(0);
  expect(host.getPreferences().provider).toBe('parakeet');
  expect(host.getPreferences().gamepadBackground).toBe(true);
});
