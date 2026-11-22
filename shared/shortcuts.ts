import { z } from 'zod';

export const shortcutActions = [
  { id: 'togglePlay', label: 'Play / pause', group: 'Playback' },
  { id: 'play', label: 'Play', group: 'Playback' },
  { id: 'pause', label: 'Pause', group: 'Playback' },
  { id: 'reset', label: 'Reset to start', group: 'Playback' },
  { id: 'previousWord', label: 'Previous word', group: 'Navigation' },
  { id: 'nextWord', label: 'Next word', group: 'Navigation' },
  { id: 'previousSentence', label: 'Previous sentence', group: 'Navigation' },
  { id: 'nextSentence', label: 'Next sentence', group: 'Navigation' },
  { id: 'previousParagraph', label: 'Previous paragraph', group: 'Navigation' },
  { id: 'nextParagraph', label: 'Next paragraph', group: 'Navigation' },
  { id: 'previousPage', label: 'Previous page', group: 'Navigation' },
  { id: 'nextPage', label: 'Next page', group: 'Navigation' },
  { id: 'previousChapter', label: 'Previous chapter', group: 'Navigation' },
  { id: 'nextChapter', label: 'Next chapter', group: 'Navigation' },
  { id: 'scrollUp', label: 'Scroll up (hold)', group: 'Scrolling & speed' },
  { id: 'scrollDown', label: 'Scroll down (hold)', group: 'Scrolling & speed' },
  { id: 'speedUp', label: 'Increase speed', group: 'Scrolling & speed' },
  { id: 'speedDown', label: 'Decrease speed', group: 'Scrolling & speed' },
  { id: 'blackout', label: 'Blackout', group: 'Display & modes' },
  { id: 'fullscreen', label: 'Fullscreen', group: 'Display & modes' },
  { id: 'microphone', label: 'Microphone on / off', group: 'Display & modes' },
  { id: 'modeVoice', label: 'Voice mode', group: 'Display & modes' },
  { id: 'modeTimed', label: 'Auto mode', group: 'Display & modes' },
  { id: 'modeManual', label: 'Manual mode', group: 'Display & modes' },
  { id: 'loop', label: 'Loop on / off', group: 'Playback' },
] as const;
export type ShortcutAction = typeof shortcutActions[number]['id'];

export const defaultShortcuts: Record<ShortcutAction, string | null> = {
  togglePlay: 'Space', play: null, pause: 'Escape', reset: 'Home',
  previousWord: 'ArrowLeft', nextWord: 'ArrowRight',
  previousSentence: 'Ctrl+ArrowLeft', nextSentence: 'Ctrl+ArrowRight',
  previousParagraph: 'Ctrl+ArrowUp', nextParagraph: 'Ctrl+ArrowDown',
  previousPage: 'PageUp', nextPage: 'PageDown',
  previousChapter: 'Shift+PageUp', nextChapter: 'Shift+PageDown',
  scrollUp: 'Shift+ArrowUp', scrollDown: 'Shift+ArrowDown',
  speedUp: 'ArrowUp', speedDown: 'ArrowDown',
  blackout: 'KeyB', fullscreen: 'KeyF', microphone: null,
  modeVoice: null, modeTimed: null, modeManual: null, loop: null,
};

const codePattern = /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal|Comma)|Arrow(?:Up|Down|Left|Right)|Space|Enter|Escape|Tab|Home|End|PageUp|PageDown|Insert|Delete|Backspace|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|IntlBackslash|IntlRo|IntlYen|Semicolon|Quote|Comma|Period|Slash|Pause|ScrollLock|NumLock|CapsLock|ContextMenu)$/;
const modifierOrder = ['Ctrl', 'Alt', 'Shift', 'Meta'];

function validBinding(binding: string): boolean {
  const parts = binding.split('+'), code = parts.pop()!;
  return codePattern.test(code) && parts.every((part, index) => modifierOrder.includes(part)
    && (index === 0 || modifierOrder.indexOf(parts[index - 1]) < modifierOrder.indexOf(part)));
}

/** Return a user-facing reason when a combination belongs to the OS or browser. */
export function reservedShortcut(binding: string): string | null {
  const parts = binding.split('+'), code = parts.pop()!;
  const ctrl = parts.includes('Ctrl'), alt = parts.includes('Alt'), shift = parts.includes('Shift'), meta = parts.includes('Meta');
  if ((meta && ['KeyQ', 'KeyW', 'KeyL', 'Space', 'Tab', 'Escape'].includes(code)) || (alt && ['F4', 'Tab', 'Escape', 'Space'].includes(code))
    || (ctrl && alt && code === 'Delete') || (ctrl && shift && code === 'Escape')) {
    return 'This shortcut is reserved by the operating system. Choose another combination.';
  }
  if (['F5', 'F6', 'F12'].includes(code) || ((ctrl || meta) && !alt && ['KeyW', 'KeyR', 'KeyQ', 'KeyT', 'KeyN', 'KeyL', 'Tab', 'PageUp', 'PageDown'].includes(code))
    || (alt && ['ArrowLeft', 'ArrowRight', 'Home'].includes(code)) || code === 'Tab') {
    return 'This shortcut is reserved for browser or focus navigation. Choose another combination.';
  }
  return null;
}

const bindingSchema = z.string().max(80).refine(validBinding, 'Choose a valid key or key combination.')
  .superRefine((binding, context) => {
    const message = reservedShortcut(binding);
    if (message) context.addIssue({ code: 'custom', message });
  }).nullable();
type BindingSchema = z.ZodDefault<typeof bindingSchema>;
const shape = Object.fromEntries(shortcutActions.map(({ id }) => [id, bindingSchema.default(defaultShortcuts[id])])) as Record<ShortcutAction, BindingSchema>;
export const shortcutsSchema = z.object(shape).superRefine((shortcuts, context) => {
  const assigned = new Map<string, string>();
  for (const { id, label } of shortcutActions) {
    const binding = shortcuts[id];
    if (binding === null) continue;
    const other = assigned.get(binding);
    if (other) context.addIssue({ code: 'custom', path: [id], message: `${formatShortcut(binding)} is already assigned to ${other}. Clear that assignment first.` });
    assigned.set(binding, label);
  }
});

export type ShortcutKeyEvent = {
  code: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean;
  repeat?: boolean; isComposing?: boolean; getModifierState?: (key: string) => boolean;
};

/** Physical codes stay stable across keyboard layouts; AltGraph is text entry. */
export function shortcutFromEvent(event: ShortcutKeyEvent): string | null {
  if (event.repeat || event.isComposing || event.getModifierState?.('AltGraph') || !codePattern.test(event.code)) return null;
  return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', event.code].filter(Boolean).join('+');
}

const keyLabels: Record<string, string> = {
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', PageUp: 'Page Up', PageDown: 'Page Down',
  Escape: 'Esc', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Meta: 'Win / Cmd',
};
export function formatShortcut(binding: string | null): string {
  if (binding === null) return 'Unassigned';
  return binding.split('+').map(part => keyLabels[part] ?? part.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Numpad ')).join(' + ');
}

export class ShortcutCapture {
  private pending: { code: string; binding: string } | null = null;

  press(event: ShortcutKeyEvent): string | null {
    if (this.pending) return null;
    const binding = shortcutFromEvent(event);
    if (binding) this.pending = { code: event.code, binding };
    return binding;
  }

  release(event: Pick<ShortcutKeyEvent, 'code' | 'metaKey'>): string | null {
    if (!this.pending) return null;
    const cmdReleased = (event.code === 'MetaLeft' || event.code === 'MetaRight') && !event.metaKey && this.pending.binding.split('+').includes('Meta');
    if (event.code !== this.pending.code && !cmdReleased) return null;
    const binding = this.pending.binding;
    this.pending = null;
    return binding;
  }
}
