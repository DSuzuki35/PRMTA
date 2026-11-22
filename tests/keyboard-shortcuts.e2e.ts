import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHost, type Host } from '../server/host';
import { defaultPreferences, type Preferences } from '../shared/model';

let host: Host, dir: string;
let hookFixture: string;
const openHookFixture = async (page: Page) => {
  await page.route('**/keyboard-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root"></div><script src="/keyboard-fixture.js"></script></body></html>' }));
  await page.route('**/keyboard-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: hookFixture }));
  await page.goto(`${host.origin}/keyboard-fixture`);
  await page.locator('#disable').waitFor();
};
const post = (path: string, body: unknown) => fetch(`${host.origin}/api${path}`, {
  method: 'POST', headers: { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const preferences = () => host.library.getSetting<Preferences>('preferences', defaultPreferences);
test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'prmta-keyboard-'));
  host = await createHost({ dataDir: dir, port: 0, staticDir: resolve('dist') });
  const fixture = await build({ stdin: {
    contents: `import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { useKeyboardControls } from './src/useKeyboardControls';
      import { defaultPreferences } from './shared/model';
      window.keyboardFixture = { actions: [], scrolling: [] };
      const prefs = { ...defaultPreferences, shortcuts: { ...defaultPreferences.shortcuts, nextSentence: 'Meta+KeyK' } };
      function Fixture() {
        const [enabled, setEnabled] = useState(true), [modal, setModal] = useState(false);
        useKeyboardControls(prefs, enabled, action => window.keyboardFixture.actions.push(action), direction => window.keyboardFixture.scrolling.push(direction));
        return <><button id="disable" onClick={() => setEnabled(false)}>Disable controls</button>
          <button id="modal" onClick={() => setModal(true)}>Open dialog</button>
          <input aria-label="Typing field"/><dialog open={modal}>Dialog</dialog></>;
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);`,
    resolveDir: resolve('.'), loader: 'jsx',
  }, bundle: true, write: false, platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
  hookFixture = fixture.outputFiles[0].text;
});

test('hook fixture: Cmd release rearms a key when its keyup was omitted', async ({ page }) => {
  await openHookFixture(page);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', metaKey: true, bubbles: true, cancelable: true })));
  await expect.poll(() => page.evaluate(() => (window as any).keyboardFixture.actions)).toEqual(['nextSentence']);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'MetaLeft', metaKey: false, bubbles: true })));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', metaKey: true, bubbles: true, cancelable: true })));
  await expect.poll(() => page.evaluate(() => (window as any).keyboardFixture.actions)).toEqual(['nextSentence', 'nextSentence']);
});

test('hook fixture: holds heartbeat, stop for released modifiers, and cancel for discrete navigation', async ({ page }) => {
  await openHookFixture(page);
  const scrolling = () => page.evaluate(() => (window as any).keyboardFixture.scrolling as number[]);
  await page.keyboard.down('Shift'); await page.keyboard.down('ArrowDown');
  await expect.poll(scrolling).toContain(1);
  await expect.poll(async () => (await scrolling()).length).toBeGreaterThan(2);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await scrolling()).at(-1)).toBe(0);
  await page.keyboard.up('ArrowDown');
  await page.keyboard.down('Shift'); await page.keyboard.down('ArrowDown');
  await page.keyboard.down('ArrowUp');
  await expect.poll(async () => (await scrolling()).at(-1)).toBe(0);
  await page.keyboard.up('ArrowUp');
  await expect.poll(async () => (await scrolling()).at(-1)).toBe(1);
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => (window as any).keyboardFixture.actions)).toEqual(['nextChapter']);
  await expect.poll(async () => (await scrolling()).at(-1)).toBe(0);
  const stopped = (await scrolling()).length;
  await page.keyboard.down('ArrowDown'); await page.waitForTimeout(250);
  expect((await scrolling()).length).toBe(stopped);
  await page.keyboard.up('ArrowDown'); await page.keyboard.up('Shift');
});

test('hook fixture: typing, dialogs, blur and disabling stop active holds', async ({ page }) => {
  for (const suspend of ['typing', 'dialog', 'blur', 'disabled']) {
    await openHookFixture(page);
    await page.keyboard.down('Shift'); await page.keyboard.down('ArrowDown');
    await expect.poll(() => page.evaluate(() => (window as any).keyboardFixture.scrolling.at(-1))).toBe(1);
    if (suspend === 'typing') await page.getByLabel('Typing field').focus();
    else if (suspend === 'dialog') await page.locator('#modal').click();
    else if (suspend === 'disabled') await page.locator('#disable').click();
    else await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(() => page.evaluate(() => (window as any).keyboardFixture.scrolling.at(-1))).toBe(0);
    await page.keyboard.up('ArrowDown'); await page.keyboard.up('Shift');
    await page.keyboard.press('Home'); await page.waitForTimeout(100);
    expect(await page.evaluate(() => (window as any).keyboardFixture.actions)).toEqual([]);
  }
});
test.afterAll(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(async () => {
  await post('/preferences', { ...defaultPreferences, keyboardScrollSpeed: 240 });
  host.session.load({ id: 'keyboard', title: 'Keyboard fixture', content: 'First sentence here. Second sentence here.\n\nThird paragraph starts. Fourth sentence here.\n---\n# Next chapter\n' + 'The long final paragraph keeps scrolling through many lines. '.repeat(100) });
});

test('captures full key cycles, rejects duplicates and reserved keys, cancels and persists', async ({ page }) => {
  await page.goto(host.url('admin'));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const panel = page.locator('.keyboard-shortcuts');
  const row = panel.locator('.keyboard-shortcut-row').filter({ has: page.locator('#shortcut-label-nextSentence') });
  await page.getByRole('button', { name: 'Assign next sentence shortcut', exact: true }).click();
  await page.keyboard.down('Control');
  await page.keyboard.down('KeyK');
  await expect(row.locator('output')).toHaveText('Ctrl + Right');
  await page.keyboard.up('Control');
  await expect(row.locator('output')).toHaveText('Ctrl + Right');
  await page.keyboard.up('KeyK');
  await expect(row.locator('output')).toHaveText('Ctrl + K');
  await expect.poll(() => preferences().shortcuts.nextSentence).toBe('Ctrl+KeyK');

  await page.getByRole('button', { name: 'Assign next sentence shortcut', exact: true }).click();
  await page.keyboard.press('Space');
  await expect(panel.locator('.keyboard-shortcut-status')).toContainText('already assigned');
  await page.keyboard.press('Control+KeyW');
  await expect(panel.locator('.keyboard-shortcut-status')).toContainText('reserved');
  await page.keyboard.press('Escape');
  await expect(panel.locator('.keyboard-shortcut-status')).toContainText('cancelled');
  await expect(row.locator('output')).toHaveText('Ctrl + K');
  await page.reload();
  await expect(row.locator('output')).toHaveText('Ctrl + K');
  await page.getByRole('button', { name: 'Clear next sentence shortcut', exact: true }).click();
  await expect(row.locator('output')).toHaveText('Unassigned');
  await page.getByRole('button', { name: 'Reset keyboard shortcuts', exact: true }).click();
  await expect(row.locator('output')).toHaveText('Ctrl + Right');
});

test('held keyboard scrolling stops on modifier release, opposed holds, navigation and blur', async ({ page }) => {
  await page.goto(host.url('admin'));
  await page.getByText('Studio connected', { exact: true }).waitFor();
  await page.keyboard.down('Shift');
  await page.keyboard.down('ArrowDown');
  await expect.poll(() => host.session.scrolling).toBe(true);
  await expect.poll(() => host.session.state.position).toBeGreaterThan(1);
  await page.keyboard.up('Shift');
  await expect.poll(() => host.session.scrolling).toBe(false);
  const released = host.session.state.position;
  await page.waitForTimeout(300);
  expect(host.session.state.position).toBe(released);
  await page.keyboard.up('ArrowDown');

  await page.keyboard.down('Shift'); await page.keyboard.down('ArrowDown');
  await expect.poll(() => host.session.scrolling).toBe(true);
  await page.keyboard.down('ArrowUp');
  await expect.poll(() => host.session.scrolling).toBe(false);
  await page.keyboard.up('ArrowUp');
  await expect.poll(() => host.session.scrolling).toBe(true);
  await page.keyboard.up('ArrowDown'); await page.keyboard.up('Shift');

  await page.keyboard.down('Shift'); await page.keyboard.down('ArrowDown');
  await expect.poll(() => host.session.scrolling).toBe(true);
  await page.keyboard.down('PageDown'); await page.keyboard.up('PageDown');
  await expect.poll(() => host.session.scrolling).toBe(false);
  await page.keyboard.up('ArrowDown'); await page.keyboard.up('Shift');
  await page.keyboard.down('Shift'); await page.keyboard.down('ArrowDown');
  await expect.poll(() => host.session.scrolling).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => host.session.scrolling).toBe(false);
  await page.keyboard.up('ArrowDown'); await page.keyboard.up('Shift');
});

test('navigation fires once per press and editing, dialogs and Settings suspend keyboard actions', async ({ page }) => {
  await page.goto(host.url('admin'));
  await page.getByText('Studio connected', { exact: true }).waitFor();
  await page.keyboard.down('Control'); await page.keyboard.down('ArrowRight');
  await expect.poll(() => host.session.state.position).toBe(3);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(250); expect(host.session.state.position).toBe(3);
  await page.keyboard.up('ArrowRight'); await page.keyboard.up('Control');
  await page.getByRole('button', { name: 'Quick start', exact: true }).click();
  await page.keyboard.press('Home'); await page.waitForTimeout(150); expect(host.session.state.position).toBe(3);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.keyboard.press('Home'); await page.waitForTimeout(150); expect(host.session.state.position).toBe(3);
  await page.getByRole('button', { name: 'New script', exact: true }).click();
  await page.getByLabel('Script text').fill('Keyboard typing stays in the editor.');
  await page.getByLabel('Script text').press('Home');
  await page.getByLabel('Script text').press('Control+ArrowRight');
  await page.waitForTimeout(150);
  expect(host.session.state.position).toBe(3);
});

test('custom Cmd shortcuts can be reused when the browser omits the main keyup', async ({ page }) => {
  await post('/preferences', { ...defaultPreferences, shortcuts: { ...defaultPreferences.shortcuts, nextSentence: 'Meta+KeyK' } });
  await page.goto(host.url('admin'));
  await page.getByText('Studio connected', { exact: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', metaKey: true, bubbles: true, cancelable: true })));
  await expect.poll(() => host.session.state.position).toBe(3);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'MetaLeft', metaKey: false, bubbles: true })));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', metaKey: true, bubbles: true, cancelable: true })));
  await expect.poll(() => host.session.state.position).toBe(6);
});

test('opening a dialog or Settings stops a scroll hold immediately', async ({ page }) => {
  await page.goto(host.url('admin'));
  await page.getByText('Studio connected', { exact: true }).waitFor();
  await page.keyboard.down('Shift'); await page.keyboard.down('ArrowDown');
  await expect.poll(() => host.session.scrolling).toBe(true);
  await page.getByRole('button', { name: 'Quick start', exact: true }).click();
  await expect.poll(() => host.session.scrolling).toBe(false);
  await page.keyboard.up('ArrowDown'); await page.keyboard.up('Shift'); await page.keyboard.press('Escape');
  await page.keyboard.down('Shift'); await page.keyboard.down('ArrowDown');
  await expect.poll(() => host.session.scrolling).toBe(true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect.poll(() => host.session.scrolling).toBe(false);
  await page.keyboard.up('ArrowDown'); await page.keyboard.up('Shift');
});

test('transport hints reflect custom shortcuts and omit cleared bindings', async ({ page }) => {
  const shortcuts = { ...defaultPreferences.shortcuts, togglePlay: 'Ctrl+KeyK', nextPage: 'Shift+KeyN', previousPage: null, blackout: null };
  expect((await post('/preferences', { ...defaultPreferences, shortcuts })).ok).toBe(true);
  await page.goto(host.url('admin'));
  await page.getByText('Studio connected', { exact: true }).waitFor();
  await expect(page.getByRole('button', { name: 'Next page', exact: true })).toHaveAttribute('title', 'Next page · Shift + N');
  await expect(page.getByRole('button', { name: 'Previous page', exact: true })).toHaveAttribute('title', 'Previous page');
  await expect(page.getByRole('button', { name: 'Blackout', exact: true })).toHaveAttribute('title', 'Blackout');
  await expect(page.locator('.app-footer kbd')).toHaveText('Ctrl + K');
  expect((await post('/preferences', { ...defaultPreferences, shortcuts: { ...shortcuts, togglePlay: null } })).ok).toBe(true);
  await expect(page.locator('.app-footer kbd')).toHaveCount(0);
});
