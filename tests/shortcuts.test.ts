import { describe, expect, it } from 'vitest';
import { defaultShortcuts, formatShortcut, reservedShortcut, shortcutActions, shortcutFromEvent, shortcutsSchema, ShortcutCapture } from '../shared/shortcuts';

describe('keyboard shortcuts', () => {
  it('migrates missing assignments while retaining cleared and customized assignments', () => {
    const migrated = shortcutsSchema.parse({ blackout: null, microphone: 'Ctrl+KeyM' });
    expect(migrated.togglePlay).toBe('Space');
    expect(migrated.reset).toBe('Home');
    expect(migrated.blackout).toBeNull();
    expect(migrated.microphone).toBe('Ctrl+KeyM');
    expect(Object.keys(migrated)).toHaveLength(shortcutActions.length);
    expect(shortcutsSchema.parse({})).toEqual(defaultShortcuts);
  });

  it('rejects duplicate assignments including collisions with migrated defaults', () => {
    expect(shortcutsSchema.safeParse({ microphone: 'Space' }).success).toBe(false);
    expect(shortcutsSchema.safeParse({ microphone: null, play: null }).success).toBe(true);
    expect(shortcutsSchema.safeParse({ togglePlay: null, microphone: 'Space' }).success).toBe(true);
  });

  it.each(['', 'N', 'Ctrl', 'ShiftLeft', 'Ctrl+Ctrl+KeyN', 'Shift+Ctrl+KeyN', 'KeyUnknown', 'Ctrl+KeyN+KeyM', ' ctrl+KeyN', 'Ctrl+F25'])('rejects malformed binding %s', binding => {
    expect(shortcutsSchema.safeParse({ microphone: binding }).success).toBe(false);
  });

  it.each(['Ctrl+KeyW', 'Ctrl+Shift+KeyW', 'Ctrl+KeyR', 'Ctrl+KeyQ', 'Ctrl+Alt+Delete', 'Alt+F4', 'Alt+Tab', 'Meta+KeyL', 'Meta+KeyQ', 'Meta+KeyW', 'Meta+KeyR', 'Meta+Space', 'Ctrl+KeyT', 'Ctrl+KeyN', 'Ctrl+Shift+KeyN', 'Ctrl+PageUp', 'Ctrl+PageDown', 'F5', 'F12'])('rejects reserved binding %s with an explanation', binding => {
    expect(reservedShortcut(binding)).toEqual(expect.any(String));
    expect(shortcutsSchema.safeParse({ microphone: binding }).success).toBe(false);
  });

  it('accepts available physical keys and canonical combinations', () => {
    for (const binding of ['Ctrl+Shift+KeyK', 'Shift+Meta+KeyK', 'Shift+ArrowDown', 'F9', 'NumpadAdd', 'Backquote', 'Ctrl+Digit1']) {
      expect(shortcutsSchema.safeParse({ microphone: binding, scrollDown: null }).success).toBe(true);
      expect(reservedShortcut(binding)).toBeNull();
    }
  });

  it('normalizes physical codes and modifiers independently of keyboard layout', () => {
    expect(shortcutFromEvent({ code: 'KeyY', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+KeyY');
    expect(shortcutFromEvent({ code: 'KeyN', ctrlKey: true, altKey: true, shiftKey: true, metaKey: true })).toBe('Ctrl+Alt+Shift+Meta+KeyN');
    expect(shortcutFromEvent({ code: 'Space' })).toBe('Space');
  });

  it('ignores repeats, composition, AltGraph and keys without usable codes', () => {
    for (const event of [
      { code: 'KeyA', repeat: true }, { code: 'KeyA', isComposing: true },
      { code: 'KeyQ', ctrlKey: true, altKey: true, getModifierState: (key: string) => key === 'AltGraph' },
      { code: 'ShiftLeft', shiftKey: true }, { code: 'ControlRight', ctrlKey: true },
      { code: 'Unidentified' }, { code: '' },
    ]) expect(shortcutFromEvent(event)).toBeNull();
  });

  it('formats physical codes as readable shortcuts', () => {
    expect(formatShortcut('Ctrl+Shift+KeyN')).toBe('Ctrl + Shift + N');
    expect(formatShortcut('PageUp')).toBe('Page Up');
    expect(formatShortcut('ArrowDown')).toBe('Down');
    expect(formatShortcut(null)).toBe('Unassigned');
  });

  it('captures the keydown combination even when its modifier is released first', () => {
    const capture = new ShortcutCapture();
    expect(capture.press({ code: 'ControlLeft', ctrlKey: true })).toBeNull();
    expect(capture.press({ code: 'KeyN', ctrlKey: true })).toBe('Ctrl+KeyN');
    expect(capture.release({ code: 'ControlLeft' })).toBeNull();
    expect(capture.release({ code: 'KeyN' })).toBe('Ctrl+KeyN');
    expect(capture.release({ code: 'KeyN' })).toBeNull();
  });

  it('does not capture an already-held key or overwrite a pending key with another', () => {
    const capture = new ShortcutCapture();
    expect(capture.press({ code: 'KeyN', repeat: true })).toBeNull();
    expect(capture.release({ code: 'KeyN' })).toBeNull();
    expect(capture.press({ code: 'KeyN' })).toBe('KeyN');
    expect(capture.press({ code: 'KeyJ' })).toBeNull();
    expect(capture.release({ code: 'KeyJ' })).toBeNull();
    expect(capture.release({ code: 'KeyN' })).toBe('KeyN');
  });

  it('completes Cmd capture on its modifier release when macOS omits the main keyup', () => {
    const capture = new ShortcutCapture();
    expect(capture.press({ code: 'KeyK', metaKey: true })).toBe('Meta+KeyK');
    expect(capture.release({ code: 'MetaLeft', metaKey: false })).toBe('Meta+KeyK');
    expect(capture.release({ code: 'KeyK' })).toBeNull();
  });
});
