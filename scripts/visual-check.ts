import { chromium } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHost } from '../server/host';
const dir = mkdtempSync(join(tmpdir(), 'prmpt-visual-'));
const host = await createHost({ dataDir: dir, port: 0, staticDir: resolve('dist') });
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
try {
  const script = host.library.save({ id: randomUUID(), title: 'Your words. Your pace.', content: "Great stories do not need perfect words.\n\nThey need a voice that is ready to tell them.\n\nWelcome to ==PRMTA==. A little space for ideas worth sharing.\n\n---\n\nTake a moment. Find your rhythm.\n\nYou set the pace. Your script follows. On your display, in a browser, or right inside your VR world.\n\n---\n\nA small slip? Keep going.\n\nStay with your story. Speak naturally. Make this take your own.\n\n**Your words. Your pace.**", folder: 'YouTube', tags: ['Intro', 'Storytelling'], favorite: true, deleted: false, notes: '' }, []);
  host.library.save({ ...script, id: randomUUID(), title: 'Make the first seconds count', content: 'The first ten seconds decide whether your story gets heard.\n\nStart with a question. Or an unexpected idea.', tags: ['Hook'] }, []);
  host.session.load(script); host.session.command({ type: 'seek', position: 8 });
  await page.goto(host.url('admin')); await page.getByText('Studio connected', { exact: true }).waitFor(); await page.waitForTimeout(600);
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/studio.png' });
  await page.getByRole('button', { name: 'Library', exact: true }).click(); await page.getByRole('button', { name: /Your words. Your pace./ }).click();
  await page.screenshot({ path: 'artifacts/library.png' });
  await page.getByRole('button', { name: 'Prompter', exact: true }).click();
  await page.setViewportSize({ width: 700, height: 1000 }); await page.screenshot({ path: 'artifacts/narrow.png' });
  console.log(JSON.stringify({ errors, screenshots: ['artifacts/studio.png', 'artifacts/library.png', 'artifacts/narrow.png'] }));
} finally { await browser.close(); await host.close(); rmSync(dir, { recursive: true, force: true }); }
