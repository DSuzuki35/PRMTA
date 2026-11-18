import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHost, type Host } from '../server/host';
import { defaultPreferences } from '../shared/model';
let host: Host, dir: string;
const post = (path: string, body: unknown) => fetch(`${host.origin}/api${path}`, { method: 'POST', headers: { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const buttons = (page: Page, held: number[] = [], connected = true) => page.evaluate(({ held, connected }) => {
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => connected ? [{ index: 0, id: 'fixture controller', buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: held.includes(index) })) }] : [] });
}, { held, connected });
const release = async (page: Page) => { await buttons(page); await page.waitForTimeout(80); };
test.beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), 'prmta-controller-')); host = await createHost({ dataDir: dir, port: 0, staticDir: resolve('dist') }); });
test.afterAll(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(async () => {
  await post('/preferences', { ...defaultPreferences, gamepadEnabled: true, scrollUpButton: 0, scrollDownButton: 1, previousParagraphButton: 2, nextParagraphButton: 3, previousSentenceButton: 6, nextSentenceButton: 7, gamepadScrollSpeed: 240 });
  host.session.load({ id: 'controller', title: 'Controller', content: 'First sentence here. Second sentence here.\n\nThird paragraph starts. Fourth sentence here.\n---\n' + 'The long final paragraph keeps scrolling through many lines. '.repeat(100) });
});

test('assignments ignore stuck buttons, reject duplicates across actions, clear and persist', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await buttons(page, [10]);
  await page.getByRole('button', { name: 'Assign next sentence button', exact: true }).click();
  await page.waitForTimeout(150);
  const field = page.locator('.assignment-field').filter({ hasText: 'Next sentence' });
  await expect(field.locator('output')).toHaveText('Button 7');
  await buttons(page, [10, 5]); await page.waitForTimeout(80); await buttons(page, [10]);
  await expect(page.locator('.assignment-status')).toContainText('already assigned to Next page');
  await page.getByRole('button', { name: 'Clear next page button', exact: true }).click();
  await page.getByRole('button', { name: 'Assign next sentence button', exact: true }).click();
  await page.waitForTimeout(80); await buttons(page, [10, 5]); await page.waitForTimeout(80); await buttons(page, [10]);
  await expect(field.locator('output')).toHaveText('Button 5');
  await page.getByRole('slider', { name: 'Held scroll speed (WPM)' }).press('End');
  await expect.poll(() => host.library.getSetting<any>('preferences', {}).gamepadScrollSpeed).toBe(400);
  await page.reload(); await expect(field.locator('output')).toHaveText('Button 5');
  await expect(page.getByRole('slider', { name: 'Held scroll speed (WPM)' })).toHaveValue('400');
  await page.setViewportSize({ width: 800, height: 1000 });
  await page.locator('.gamepad-assignments').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/controller-settings-v030.png', fullPage: true });
  expect(await page.locator('.gamepad-assignments').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(2);
});

test('controller navigates units once per press and stops holds for release, modal, settings, blur and disconnect', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByText('Studio connected', { exact: true }).waitFor(); await release(page);
  await buttons(page, [7]); await expect.poll(() => host.session.state.position).toBe(3);
  await page.waitForTimeout(200); expect(host.session.state.position).toBe(3);
  await release(page); await buttons(page, [3]); await expect.poll(() => host.session.state.position).toBe(6);
  await release(page); await buttons(page, [5]); await expect.poll(() => host.session.state.position).toBe(12);
  await release(page); await buttons(page, [1]); await expect.poll(() => host.session.state.position).toBeGreaterThan(12.5);
  await buttons(page, [0, 1]); await expect.poll(() => host.session.scrolling).toBe(false);
  const opposed = host.session.state.position; await page.waitForTimeout(200); expect(host.session.state.position).toBe(opposed);
  await release(page); await buttons(page, [0]); await expect.poll(() => host.session.state.position).toBeLessThan(opposed);
  await release(page); await expect.poll(() => host.session.scrolling).toBe(false);
  await buttons(page, [1]); await expect.poll(() => host.session.scrolling).toBe(true);
  await page.getByRole('button', { name: 'Quick start', exact: true }).click();
  await expect.poll(() => host.session.scrolling).toBe(false);
  const modal = host.session.state.position; await page.waitForTimeout(250); expect(host.session.state.position).toBe(modal);
  await page.keyboard.press('Escape'); await release(page); await buttons(page, [1]); await expect.poll(() => host.session.scrolling).toBe(true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click(); await expect.poll(() => host.session.scrolling).toBe(false);
  await page.getByRole('button', { name: 'Prompter', exact: true }).click(); await release(page); await buttons(page, [1]); await expect.poll(() => host.session.scrolling).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await expect.poll(() => host.session.scrolling).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForTimeout(80); expect(host.session.scrolling).toBe(false);
  await release(page); await buttons(page, [1]); await expect.poll(() => host.session.scrolling).toBe(true);
  await buttons(page, [], false); await expect.poll(() => host.session.scrolling).toBe(false);
  await buttons(page, [1]); await page.waitForTimeout(150); expect(host.session.scrolling).toBe(false);
  await release(page); await post('/command', { type: 'reset' });
  await buttons(page, [5, 7]); await expect.poll(() => host.session.state.position).toBe(12);
  await page.waitForTimeout(100); expect(host.session.state.position).toBe(12);
  await release(page); await buttons(page, [4, 7]); await page.waitForTimeout(100); expect(host.session.state.position).toBe(12);
});

test('keeps the current word rendered through long paragraph window boundaries', async ({ page }) => {
  host.session.load({ id: 'long-controller', title: 'Long', content: 'one two three four five six seven eight nine ten '.repeat(400) });
  await page.goto(host.url('admin')); await page.getByText('Studio connected', { exact: true }).waitFor();
  for (const position of [511, 512, 600, 3500]) {
    await post('/command', { type: 'seek', position });
    await expect(page.locator(`.current-word[data-word="${position}"]`)).toBeVisible();
    expect(await page.locator('.prompter [data-word]').count()).toBeLessThanOrEqual(768);
  }
});

test('held scroll moves output smoothly in page profiles and expires when the controller vanishes', async ({ page, context }) => {
  await post('/preferences', { ...defaultPreferences, gamepadEnabled: true, scrollUpButton: 0, scrollDownButton: 1, gamepadScrollSpeed: 240, profiles: { ...defaultPreferences.profiles, display: { ...defaultPreferences.profiles.display, flow: 'page' } } });
  const output = await context.newPage(); await output.goto(host.url('output')); await expect(output.locator('.page-number')).toContainText('1 /');
  await page.goto(host.url('admin')); await page.bringToFront(); await page.getByText('Studio connected', { exact: true }).waitFor();
  await release(page); await buttons(page, [1]); await expect.poll(() => host.session.scrolling).toBe(true);
  await expect(output.locator('.page-number')).toContainText('Manual scroll');
  const movement = await output.locator('.prompter-text').evaluate(el => new Promise<{ distance: number; maxFrame: number; changed: number }>(resolve => {
    const positions: number[] = []; const start = performance.now();
    const frame = () => { positions.push(new DOMMatrix(getComputedStyle(el).transform).m42); if (performance.now() - start < 1000) requestAnimationFrame(frame); else { const differences = positions.slice(1).map((value, i) => Math.abs(value - positions[i])); resolve({ distance: Math.abs(positions.at(-1)! - positions[0]), maxFrame: Math.max(...differences), changed: differences.filter(delta => delta > .01).length }); } };
    requestAnimationFrame(frame);
  }));
  expect(movement.distance).toBeGreaterThan(10); expect(movement.maxFrame).toBeLessThan(20); expect(movement.changed).toBeGreaterThan(15);
  await release(page); await post('/command', { type: 'seek', position: 382 });
  await expect(output.locator('.page-number')).toContainText('2 /');
  await buttons(page, [1]); await expect.poll(() => host.session.scrolling).toBe(true);
  await expect(output.locator('.page-number')).toContainText('Manual scroll');
  await page.waitForTimeout(200);
  // Crossing 384 rebases the virtual text window from 0 to 128.
  const rebase = await output.locator('.prompter-text').evaluate(el => new Promise<number>(resolve => {
    const positions: number[] = [], start = performance.now();
    const frame = () => { const word = el.querySelector('[data-word="390"]'); if (word) positions.push(word.getBoundingClientRect().y); if (performance.now() - start < 1100) requestAnimationFrame(frame); else resolve(Math.max(...positions.slice(1).map((value, i) => Math.abs(value - positions[i])))); };
    requestAnimationFrame(frame);
  }));
  expect(rebase).toBeLessThan(5);
  await buttons(page, [0]);
  const reverse = await output.locator('.prompter-text').evaluate(el => new Promise<number>(resolve => {
    const positions: number[] = [], start = performance.now();
    const frame = () => { const word = el.querySelector('[data-word="390"]'); if (word) positions.push(word.getBoundingClientRect().y); if (performance.now() - start < 1300) requestAnimationFrame(frame); else resolve(Math.max(...positions.slice(1).map((value, i) => Math.abs(value - positions[i])))); };
    requestAnimationFrame(frame);
  }));
  expect(reverse).toBeLessThan(5);
  await release(page); await expect.poll(() => host.session.scrolling).toBe(false);
  await page.waitForTimeout(50);
  const releaseY = await output.locator('.prompter-text').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m42);
  await page.waitForTimeout(200);
  const stoppedY = await output.locator('.prompter-text').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m42);
  expect(Math.abs(stoppedY - releaseY)).toBeLessThan(.1);
  await buttons(page, [1]); await expect.poll(() => host.session.scrolling).toBe(true);
  // Suspend the controller poll without sending a release, as a crashed client would.
  await page.route('**/api/command', route => route.abort());
  await expect.poll(() => host.session.scrolling).toBe(false);
  const stopped = host.session.state.position; await page.waitForTimeout(700); expect(host.session.state.position).toBe(stopped);
  await expect(output.locator('.page-number')).toContainText('Manual scroll');
  await post('/command', { type: 'navigate', unit: 'page', direction: 1 }); await expect(output.locator('.page-number')).toContainText('2 /');
});
