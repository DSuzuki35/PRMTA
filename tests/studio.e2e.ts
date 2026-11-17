import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHost, type Host } from '../server/host';
let host: Host; let dir: string;
test.beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), 'prmpt-e2e-')); host = await createHost({ dataDir: dir, port: 0, staticDir: resolve('dist'), models: { list: () => ({ managed: true, activeModel: null, models: [{ id: 'base', installed: true, downloading: false, received: 0, error: '' }] }), install: () => {} } }); });
test.afterAll(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
test('imports UTF-8 TXT with page breaks and exports the unchanged text', async ({ page }) => {
  await page.goto(host.url('admin'));
  const content = 'Grüße aus dem Studio.\n---\nEine zweite Seite mit Ä, Ö und Ü.';
  await page.locator('input[type=file]').setInputFiles({ name: 'Import-Test.txt', mimeType: 'text/plain', buffer: Buffer.from(content, 'utf8') });
  await expect(page.getByLabel('Script text')).toHaveValue(content);
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'TXT', exact: true }).click(); const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('Import-Test.txt');
  const { readFileSync } = await import('node:fs'); expect(readFileSync((await download.path())!, 'utf8')).toBe(content);
});
test('writes a script, reloads it, synchronizes output and restores trash', async ({ page, context }) => {
  await page.goto(host.url('admin'));
  await page.getByRole('button', { name: 'New script', exact: true }).click();
  await page.getByLabel('Script title').fill('Mein erster Take');
  await page.getByLabel('Script text').fill('Hallo und willkommen bei PRMTA. Heute sprechen wir über ein wichtiges Thema.\n\nHier beginnt unser zweiter Abschnitt.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Mein erster Take/ }).first().click();
  await expect(page.getByLabel('Script text')).toContainText('Hallo und willkommen');
  await page.getByRole('button', { name: 'Load in prompter', exact: true }).click();
  const output = await context.newPage(); await output.goto(host.url('output'));
  await expect(output.locator('.prompter')).toContainText('Hallo und willkommen');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect.poll(() => host.session.state.position, { timeout: 10000 }).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Blackout', exact: true }).click();
  await expect(output.locator('.blackout-cover')).toBeVisible();
  await page.getByRole('button', { name: 'Blackout', exact: true }).click();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: /Mein erster Take/ }).first().click();
  await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('button', { name: /Mein erster Take/ }).first().click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
});
test('recovers an unsaved invalid draft after navigation and adopts clean external revisions', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'New script', exact: true }).click();
  await page.getByLabel('Script title').fill('Draft recovery');
  await page.getByLabel('Script text').fill('Initial saved text');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByLabel('Script text').fill('Important unsaved work'); await page.getByLabel('Script title').fill('');
  await page.getByRole('button', { name: 'Prompter', exact: true }).click();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByLabel('Script text')).toHaveValue('Important unsaved work');
  await page.getByLabel('Script title').fill('Draft recovered'); await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const original = host.library.list().find(s => s.title === 'Draft recovered')!;
  const response = await fetch(`${host.origin}/api/scripts`, { method: 'POST', headers: { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: { ...original, content: 'Updated on another controller' }, expectedHeads: original.heads }) });
  expect(response.ok).toBe(true);
  await expect(page.getByLabel('Script text')).toHaveValue('Updated on another controller');
});
test('keeps the current word on the reading guide when mirrored vertically', async ({ page }) => {
  host.session.load({ id: 'mirror-fixture', title: 'Mirror fixture', content: 'One two three four five six seven eight nine ten.' });
  await page.goto(host.url('admin')); await page.getByText('Studio connected', { exact: true }).waitFor();
  await page.getByLabel('Text flow').selectOption('scroll');
  await page.getByText('Mirror vertically', { exact: true }).click();
  await expect.poll(async () => page.locator('.prompter').first().evaluate(el => {
    const guide = el.querySelector('.reading-guide')!.getBoundingClientRect();
    const word = el.querySelector('.current-word')!.getBoundingClientRect();
    return Math.abs(guide.y - (word.y + word.height / 2));
  }), { timeout: 5000 }).toBeLessThan(5);
});
test('pages follow voice, keyboard and mapped gamepad buttons; VR stays transparent', async ({ page, context }) => {
  const response = await fetch(`${host.origin}/api/scripts`, { method: 'POST', headers: { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: { id: crypto.randomUUID(), title: 'Pages', content: 'Guten Morgen heute erzählen wir Geschichten.\n---\nAuf dieser zweiten Seite stehen neue Worte.\n\\---\nZum Schluss bedanken wir uns sehr herzlich.' }, expectedHeads: [] }) });
  const script = await response.json(); host.session.load(script);
  const request = (path: string, body: unknown) => fetch(`${host.origin}/api${path}`, { method: 'POST', headers: { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await page.goto(host.url('admin')); await page.getByText('Studio connected', { exact: true }).waitFor();
  await page.getByLabel('Text flow').selectOption('page');
  await expect.poll(() => host.library.getSetting<any>('preferences', {}).profiles?.studio.flow).toBe('page');
  await expect(page.locator('.page-number')).toHaveText('1 / 3');
  await page.keyboard.press('Tab'); await page.keyboard.press('PageDown');
  await expect(page.locator('.page-number')).toHaveText('2 / 3');
  await page.keyboard.press('PageUp'); await expect(page.locator('.page-number')).toHaveText('1 / 3');
  await request('/command', { type: 'mode', mode: 'voice' }); await request('/command', { type: 'play', countdown: 0 });
  await request('/command', { type: 'transcript', text: 'Guten Morgen heute erzählen wir Geschichten auf dieser zweiten Seite' });
  await expect(page.locator('.page-number')).toHaveText('2 / 3');
  await expect(page.locator('.current-word')).toHaveText('stehen');
  await request('/command', { type: 'pause' });
  const current = await (await fetch(`${host.origin}/api/state`, { headers: { Authorization: `Bearer ${host.tokens.admin}` } })).json();
  await request('/preferences', { ...current.preferences, gamepadEnabled: true });
  await page.evaluate(() => { Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ index: 0, buttons: Array.from({ length: 6 }, (_, i) => ({ pressed: i === 5 })) }] }); });
  await expect(page.locator('.page-number')).toHaveText('3 / 3');
  const output = await context.newPage(); await output.goto(host.url('output', host.origin, 'vr'));
  await expect(output.locator('.prompter')).toHaveClass(/transparent/);
  await expect(output.locator('html')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('model label stays above the full-width dropdown at desktop and narrow sizes', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const select = page.getByLabel('Local model'); await select.waitFor();
  for (const width of [1600, 800]) {
    await page.setViewportSize({ width, height: 1000 }); await select.scrollIntoViewIfNeeded();
    const geometry = await select.evaluate(el => { const label = el.parentElement!; const range = document.createRange(); range.selectNodeContents(label.firstChild!); const text = range.getBoundingClientRect(), control = el.getBoundingClientRect(), parent = label.getBoundingClientRect(); return { gap: control.top - text.bottom, width: control.width, available: parent.width, right: control.right }; });
    expect(geometry.gap).toBeGreaterThanOrEqual(6); expect(geometry.width).toBeGreaterThan(200); expect(Math.abs(geometry.width - geometry.available)).toBeLessThan(2); expect(geometry.right).toBeLessThanOrEqual(width);
  }
});

test('returning from a long fitted page restores the configured scrolling font size', async ({ page }) => {
  host.session.load({ id: 'font-fixture', title: 'Font fixture', content: `${'Long page content with many words. '.repeat(80)}\n---\nLast page.` });
  await page.goto(host.url('admin')); await page.getByText('Studio connected', { exact: true }).waitFor();
  await page.getByLabel('Text flow').selectOption('page');
  await expect.poll(() => page.locator('.prompter-text').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeLessThan(42);
  await page.getByLabel('Text flow').selectOption('scroll');
  await expect(page.locator('.prompter-text')).toHaveCSS('font-size', '42px');
});

test('sets up voice with a button and shows download progress without terminal instructions', async ({ page }) => {
  let downloaded = false, polls = 0, requestedModel = '';
  await page.route('**/api/speech/models', route => route.fulfill({ json: { managed: true, activeModel: null, models: [{ id: 'base', installed: downloaded && ++polls > 2, downloading: downloaded && polls <= 2, received: downloaded ? 74000000 : 0, error: '' }] } }));
  await page.route('**/api/speech/models/install', route => { downloaded = true; return route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/speech/start', route => { requestedModel = route.request().postDataJSON().model; return route.fulfill({ json: { ok: true } }); });
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('powershell', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Set up voice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Voice ready', exact: true })).toBeVisible();
  expect(downloaded).toBe(true); expect(requestedModel).toBe('base');
});
