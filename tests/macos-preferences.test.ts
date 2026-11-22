import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHost } from '../server/host';
import { shortcutsForPlatform, shortcutsSchema } from '../shared/shortcuts';

it('gives new Mac profiles valid Cmd navigation without changing saved bindings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prmta-mac-keys-'));
  let host;
  try {
    const shortcuts = shortcutsForPlatform('darwin');
    expect(shortcutsSchema.safeParse(shortcuts).success).toBe(true);
    host = await createHost({ dataDir: dir, port: 0, defaultShortcuts: shortcuts });
    expect(host.getPreferences().shortcuts.previousSentence).toBe('Meta+ArrowLeft');
    expect(host.getPreferences().shortcuts.nextParagraph).toBe('Meta+ArrowDown');
    const saved = { ...host.getPreferences(), language: 'de', shortcuts: { ...host.getPreferences().shortcuts, previousSentence: 'KeyJ' } };
    const response = await fetch(host.origin + '/api/preferences', { method: 'POST', headers: { Authorization: `Bearer ${host.tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify(saved) });
    expect(response.ok).toBe(true);
    await host.close(); host = undefined;
    host = await createHost({ dataDir: dir, port: 0, defaultShortcuts: shortcuts });
    expect(host.getPreferences().shortcuts.previousSentence).toBe('KeyJ');
    expect(host.getPreferences().language).toBe('de');
    expect(shortcutsForPlatform('win32').previousSentence).toBe('Ctrl+ArrowLeft');
  } finally { await host?.close(); rmSync(dir, { recursive: true, force: true }); }
});
