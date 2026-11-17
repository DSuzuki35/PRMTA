import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHost, type Host } from '../server/host';
import { defaultPreferences } from '../shared/model';
let host: Host, dir: string;
test.beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), 'prmta-render-')); host = await createHost({ dataDir: dir, port: 0, staticDir: resolve('dist') }); });
test.afterAll(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
const post = (path: string, body: unknown) => fetch(`${host.origin}/api${path}`, { method: 'POST', headers: { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test.beforeEach(async () => { await post('/preferences', structuredClone(defaultPreferences)); });

test('page fitting never reverses font size in studio or browser output', async ({ page, context }) => {
  host.session.load({ id: 'fit', title: 'Fit', content: `${'A sentence with several words to fit on this page. '.repeat(12)}\n---\nLast page.` });
  await page.goto(host.url('admin'));
  await page.getByLabel('Output profile').selectOption('display');
  await page.getByLabel('Text flow').selectOption('page');
  const output = await context.newPage(); await output.setViewportSize({ width: 900, height: 500 }); await output.goto(host.url('output'));
  let previous = [0, 0];
  for (const size of [24, 48, 96, 160]) {
    await page.getByLabel('Font size', { exact: true }).fill(String(size));
    await expect.poll(() => host.library.getSetting<any>('preferences', {}).profiles.display.fontSize).toBe(size);
    for (const [i, surface] of [page, output].entries()) {
      const geometry = await surface.locator('.prompter-text').evaluate(el => ({ size: parseFloat(getComputedStyle(el).fontSize), height: el.scrollHeight, available: el.closest('.prompter')!.clientHeight }));
      expect(geometry.size).toBeGreaterThanOrEqual(previous[i] - .1);
      expect(geometry.height).toBeLessThanOrEqual(geometry.available * .83);
      previous[i] = geometry.size;
    }
  }
  await page.getByLabel('Text flow').selectOption('scroll');
  await expect(output.locator('.prompter-text')).toHaveCSS('font-size', '160px');
});

test('long scripts keep a bounded DOM, wheel navigation works and loading resets the visible word', async ({ page }) => {
  host.session.load({ id: 'long', title: 'Long', content: 'One two three four five six seven eight nine ten.\n\n'.repeat(300) });
  await page.goto(host.url('admin')); await expect(page.locator('[data-word="0"]')).toBeVisible();
  expect(await page.locator('[data-word]').count()).toBeLessThanOrEqual(1024);
  await page.locator('.prompter').hover(); await page.mouse.wheel(0, 400);
  await expect.poll(() => host.session.state.position).toBeGreaterThan(0);
  await post('/command', { type: 'seek', position: 2500 });
  await expect(page.locator('.current-word')).toHaveAttribute('data-word', '2500');
  // Loading through the public command broadcasts a different script, paused at zero.
  const response = await post('/scripts', { draft: { id: crypto.randomUUID(), title: 'Short', content: 'First word is visible from the start.' }, expectedHeads: [] });
  const script = await response.json(); await post('/load', { id: script.id });
  await expect.poll(() => page.locator('.prompter').evaluate(el => {
    const word = el.querySelector('[data-word="0"]')?.getBoundingClientRect();
    const guide = el.querySelector('.reading-guide')!.getBoundingClientRect();
    return word ? Math.abs(word.y + word.height / 2 - guide.y) : 999;
  })).toBeLessThan(3);
  expect(host.session.state.position).toBe(0);
});

test('background opacity applies to the browser without fading text', async ({ page, context }) => {
  host.session.load({ id: 'alpha', title: 'Alpha', content: 'Visible words on a translucent background.' });
  await page.goto(host.url('admin')); await page.getByLabel('Output profile').selectOption('display');
  const output = await context.newPage(); await output.goto(host.url('output'));
  await page.getByLabel('Background opacity', { exact: true }).fill('40');
  await expect(output.locator('.prompter')).toHaveCSS('background-color', 'rgba(16, 17, 19, 0.4)');
  await expect(output.locator('.prompter')).toHaveCSS('opacity', '1');
  await page.getByLabel('Background opacity', { exact: true }).fill('0');
  await expect(output.locator('.prompter')).toHaveCSS('background-color', 'rgba(16, 17, 19, 0)');
});

test('smooth line transitions can be disabled and enabled during playback', async ({ page }) => {
  host.session.load({ id: 'smooth', title: 'Smooth', content: Array.from({ length: 80 }, (_, i) => `Line ${i}.`).join('\n') });
  await page.goto(host.url('admin'));
  await page.getByText('Smooth line transitions', { exact: true }).click();
  await expect.poll(() => host.library.getSetting<any>('preferences', {}).profiles.studio.smoothScroll).toBe(false);
  await post('/command', { type: 'mode', mode: 'manual' }); await post('/command', { type: 'play', countdown: 0 });
  await post('/command', { type: 'seek', position: 12 });
  await expect(page.locator('.current-word')).toHaveAttribute('data-word', '12');
  const distance = () => page.locator('.prompter').evaluate(el => {
    const word = el.querySelector('.current-word')!.getBoundingClientRect(), guide = el.querySelector('.reading-guide')!.getBoundingClientRect();
    return Math.abs(word.y + word.height / 2 - guide.y);
  });
  expect(await distance()).toBeLessThan(2);
  await page.getByText('Smooth line transitions', { exact: true }).click();
  await post('/command', { type: 'seek', position: 24 });
  await expect(page.locator('.current-word')).toHaveAttribute('data-word', '24');
  expect(await distance()).toBeGreaterThan(5);
  await expect.poll(distance).toBeLessThan(2);
  await post('/command', { type: 'pause' });
});

test('small fonts fill a 4K browser output and grow normally below the page limit', async ({ page }) => {
  host.session.load({ id: '4k', title: '4K', content: 'One two three four five six seven eight nine ten. '.repeat(2000) });
  const preferences = structuredClone(defaultPreferences); preferences.profiles.display.fontSize = 24;
  await post('/preferences', preferences); await page.setViewportSize({ width: 3840, height: 2160 }); await page.goto(host.url('output'));
  await expect.poll(() => page.locator('[data-word]').count()).toBeGreaterThan(512);
  const edge = await page.locator('[data-word]').last().boundingBox(); expect(edge!.y).toBeGreaterThan(2160);
  const response = await post('/scripts', { draft: { id: crypto.randomUUID(), title: 'Short page', content: 'One two three four five six seven eight nine ten.' }, expectedHeads: [] });
  await post('/load', { id: (await response.json()).id });
  preferences.profiles.display.flow = 'page';
  for (const size of [24, 48, 96]) {
    preferences.profiles.display.fontSize = size; await post('/preferences', preferences);
    await expect(page.locator('.prompter-text')).toHaveCSS('font-size', `${size}px`);
  }
});

test('switching and seeking a 3000-word script avoids multi-second main-thread stalls', async ({ page }) => {
  host.session.load({ id: 'perf', title: 'Performance', content: 'One two three four five six seven eight nine ten. '.repeat(300) });
  await page.goto(host.url('admin'));
  await page.evaluate(() => {
    (window as any).longTasks = [];
    new PerformanceObserver(list => { (window as any).longTasks.push(...list.getEntries().map(entry => entry.duration)); }).observe({ type: 'longtask', buffered: false });
  });
  for (const position of [100, 700, 1500, 2400, 0]) {
    await post('/command', { type: 'seek', position });
    await expect(page.locator('.current-word')).toHaveAttribute('data-word', String(position));
  }
  const longest = await page.evaluate(() => Math.max(0, ...(window as any).longTasks));
  console.log(`3000-word navigation: longest observed renderer task ${Math.round(longest)} ms`);
  expect(longest).toBeLessThan(500);
});
