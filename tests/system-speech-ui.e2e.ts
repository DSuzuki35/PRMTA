import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHost, type Host } from '../server/host';
import type { SystemSpeechStatus } from '../shared/system-speech';

let host: Host, vite: ViteDevServer, directory: string, url: string;
const available: SystemSpeechStatus = { managed: true, supported: true, platform: 'win32', engine: 'Windows System.Speech', phase: 'available', languages: ['en-US', 'de-DE'], message: 'Native offline speech is available.', error: null };

test.beforeEach(async ({ page }) => {
  directory = mkdtempSync(join(tmpdir(), 'prmta-system-speech-ui-'));
  host = await createHost({ dataDir: directory, port: 0 });
  // Serve the current source and isolate preferences for every test.
  vite = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, proxy: { '/api': host.origin, '/ws': { target: host.origin, ws: true } } } });
  await vite.listen(); url = `${vite.resolvedUrls!.local[0]}#${host.tokens.admin}`;
  await page.addInitScript(() => {
    Object.defineProperty(window, '__microphoneRequests', { value: 0, writable: true });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      (window as unknown as { __microphoneRequests: number }).__microphoneRequests++;
      throw new Error('These settings tests must not request the microphone.');
    } });
  });
});
test.afterEach(async ({ page }) => { await page.close(); await vite?.close(); await host?.close(); rmSync(directory, { recursive: true, force: true }); });

async function chooseSystem(page: Page) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Speech recognition', exact: true }).selectOption('system');
}
async function expectNoMicrophone(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __microphoneRequests: number }).__microphoneRequests)).toBe(0);
}

test('system provider persists and viewing its status never starts recognition or requests microphone access', async ({ page }) => {
  let reads = 0, starts = 0;
  await page.route('**/api/speech/system/status', route => { reads++; return route.fulfill({ json: available }); });
  await page.route('**/api/speech/system/start', route => { starts++; return route.fulfill({ json: { ...available, phase: 'ready' } }); });
  await chooseSystem(page);
  await expect(page.getByText('Available languages: en-US, de-DE', { exact: true })).toBeVisible();
  await expect.poll(() => host.getPreferences().provider).toBe('system');
  expect(starts).toBe(0); await expectNoMicrophone(page);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Speech recognition', exact: true })).toHaveValue('system');
  await expect(page.getByText(available.message, { exact: true })).toBeVisible();
  expect(reads).toBeGreaterThanOrEqual(2); expect(starts).toBe(0); await expectNoMicrophone(page);
});

test('Prepare explicitly starts native speech with English and respects a later German selection', async ({ page }) => {
  const starts: unknown[] = [];
  await page.route('**/api/speech/system/status', route => route.fulfill({ json: available }));
  await page.route('**/api/speech/system/start', route => {
    expect(route.request().method()).toBe('POST'); starts.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...available, phase: 'ready', message: 'Native speech ready on this computer.' } });
  });
  await chooseSystem(page);
  await expect(page.getByRole('combobox', { name: 'Script language', exact: true })).toHaveValue('en');
  await page.getByRole('button', { name: 'Prepare system speech', exact: true }).click();
  await expect(page.getByText('Native speech ready on this computer.', { exact: true })).toBeVisible();
  expect(starts).toEqual([{ language: 'en' }]); await expectNoMicrophone(page);
  await page.getByRole('combobox', { name: 'Script language', exact: true }).selectOption('de');
  await expect.poll(() => host.getPreferences().language).toBe('de');
  await page.getByRole('button', { name: 'Prepare system speech', exact: true }).click();
  await expect.poll(() => starts.length).toBe(2);
  expect(starts).toEqual([{ language: 'en' }, { language: 'de' }]); await expectNoMicrophone(page);
});

test('native preparation errors stay visible and permit an explicit retry', async ({ page }) => {
  let starts = 0;
  await page.route('**/api/speech/system/status', route => route.fulfill({ json: available }));
  await page.route('**/api/speech/system/start', route => {
    starts++;
    return starts === 1 ? route.fulfill({ status: 503, json: { error: 'No installed English offline speech recognizer.' } }) : route.fulfill({ json: { ...available, phase: 'ready', message: 'Native speech ready after retry.' } });
  });
  await chooseSystem(page);
  await page.getByRole('button', { name: 'Prepare system speech', exact: true }).click();
  await expect(page.locator('.voice-setup').getByRole('alert')).toContainText('No installed English offline speech recognizer.');
  await expect(page.getByRole('button', { name: 'Prepare system speech', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Prepare system speech', exact: true }).click();
  await expect(page.getByText('Native speech ready after retry.', { exact: true })).toBeVisible();
  await expect(page.locator('.voice-setup').getByRole('alert')).toHaveCount(0);
  expect(starts).toBe(2); await expectNoMicrophone(page);
});

test('status failures are visible without attempting to start the native engine', async ({ page }) => {
  let starts = 0;
  await page.route('**/api/speech/system/status', route => route.fulfill({ status: 503, json: { error: 'Native speech helper unavailable.' } }));
  await page.route('**/api/speech/system/start', route => { starts++; return route.fulfill({ json: available }); });
  await chooseSystem(page);
  await expect(page.locator('.voice-setup').getByRole('alert')).toContainText('Native speech helper unavailable.');
  await expect(page.getByRole('button', { name: 'Prepare system speech', exact: true })).toBeDisabled();
  expect(starts).toBe(0); await expectNoMicrophone(page);
});

test('an older preference response cannot overwrite a newer language edit', async ({ page }) => {
  await page.clock.install();
  let client: import('@playwright/test').WebSocketRoute;
  let oldState: string | Buffer | undefined;
  let oldRoute: import('@playwright/test').Route | undefined;
  let oldResponse: import('@playwright/test').APIResponse | undefined;
  let posts = 0;
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    const remote = ws.connectToServer();
    remote.onMessage(message => {
      const state = JSON.parse(String(message));
      if (!oldState && state.preferences?.provider === 'system' && state.preferences.language === 'en') oldState = message;
      else ws.send(message);
    });
    ws.onMessage(message => remote.send(message));
  });
  await page.route('**/api/preferences', async route => {
    if (++posts === 1) { oldRoute = route; oldResponse = await route.fetch(); }
    else await route.continue();
  });
  await page.route('**/api/speech/system/status', route => route.fulfill({ json: available }));
  await chooseSystem(page);
  await expect.poll(() => !!oldResponse && !!oldState).toBe(true);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const language = page.getByRole('combobox', { name: 'Script language', exact: true });
  await language.selectOption('de');
  await oldRoute!.fulfill({ response: oldResponse! });
  // The browser clock is paused: the new debounce cannot fire while the old
  // fetch completion and its WebSocket acknowledgement are delivered.
  await page.waitForTimeout(50);
  client!.send(oldState!);
  await page.waitForTimeout(50);
  await expect(language).toHaveValue('de');
  await page.clock.runFor(200);
  await expect.poll(() => host.getPreferences().language).toBe('de');
});
