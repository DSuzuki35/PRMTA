import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHost, type Host } from '../server/host';
let host: Host, dir: string;
test.beforeEach(async ({ page }) => {
  dir = mkdtempSync(join(tmpdir(), 'prmta-voice-commands-'));
  host = await createHost({ dataDir: dir, port: 0, staticDir: resolve('dist') });
  await fetch(`${host.origin}/api/preferences`, { method: 'POST', headers: { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...host.getPreferences(), provider: 'browser', voiceCommandsEnabled: true, countdown: 0 }) });
  host.session.load({ id: 'fixture', title: 'Fixture', content: 'First sentence ends. Second sentence ends.\n\nThird paragraph begins. Another sentence here.\n\n# Chapter two\nThe next chapter begins.' });
  await page.addInitScript(() => {
    (window as any).SpeechRecognition = class {
      start() { (window as any).recognizer = this; }
      abort() {}
    };
  });
});
test.afterEach(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });

test('commands start paused playback, wait for final phrases, deduplicate and navigate chapters', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Enable voice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mic on', exact: true })).toBeVisible();
  const say = (text: string, final = true) => page.evaluate(({ text, final }) => {
    const recognizer = (window as any).recognizer;
    recognizer.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: final })] });
  }, { text, final });
  await say('prompta play'); await expect.poll(() => host.session.state.playing).toBe(true);
  await say('prompta next', false); await page.waitForTimeout(150); expect(host.session.state.position).toBe(0);
  await say('prompta next sentence'); await expect.poll(() => host.session.state.position).toBe(3);
  await say('prompta next sentence'); await page.waitForTimeout(150); expect(host.session.state.position).toBe(3);
  await say('prompta next chapter'); await expect.poll(() => host.session.state.position).toBe(12);
  await say('prompta pause'); await expect.poll(() => host.session.state.playing).toBe(false);
  expect(host.session.state.speech.transcript).not.toContain('prompta');
  await page.getByRole('button', { name: 'Mic on', exact: true }).click();
});

test('voice settings expose opt-in commands and a persisted wake word', async ({ page }) => {
  await page.goto(host.url('admin')); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Enable voice commands', exact: true })).toBeChecked();
  await page.getByRole('textbox', { name: 'Wake phrase', exact: true }).fill('computer');
  await page.getByRole('button', { name: 'Apply wake phrase', exact: true }).click();
  await expect.poll(() => host.getPreferences().voiceCommandWakeWord).toBe('computer');
  await page.getByRole('switch', { name: 'Enable voice commands', exact: true }).uncheck();
  await expect.poll(() => host.getPreferences().voiceCommandsEnabled).toBe(false);
});
