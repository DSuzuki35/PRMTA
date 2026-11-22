import { useEffect, useRef } from 'react';
import type { Preferences } from '../shared/model';
import { shortcutActions, shortcutFromEvent, type ShortcutAction } from '../shared/shortcuts';

type ScrollDirection = -1 | 0 | 1;
const editingSelector = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
const suspendedSelector = 'dialog[open], [role="dialog"][aria-modal="true"], .editor-expanded, [data-assigning="true"]';

/** Foreground keyboard controls. The caller owns action dispatch and scroll transport. */
export function useKeyboardControls(
  preferences: Preferences,
  enabled: boolean,
  onAction: (action: ShortcutAction) => void,
  onScroll: (direction: ScrollDirection) => void,
) {
  const latest = useRef({ preferences, onAction, onScroll });
  latest.current = { preferences, onAction, onScroll };
  const bindings = JSON.stringify(preferences.shortcuts);

  useEffect(() => {
    if (!enabled) return;
    const mapped = new Map<string, ShortcutAction>();
    for (const { id } of shortcutActions) {
      const binding = latest.current.preferences.shortcuts[id];
      if (binding) mapped.set(binding, id);
    }
    const pressed = new Set<string>();
    const held = new Map<string, { binding: string; direction: -1 | 1 }>();
    let direction: ScrollDirection = 0;
    let focused = document.hasFocus();
    const blocked = () => !focused || document.hidden || !!document.querySelector(suspendedSelector)
      || !!document.activeElement?.closest(editingSelector);
    const scroll = (next: ScrollDirection) => { direction = next; latest.current.onScroll(next); };
    const stop = () => {
      if (direction !== 0 || held.size) scroll(0);
      held.clear();
    };
    const updateScroll = () => {
      let up = false, down = false;
      for (const hold of held.values()) { if (hold.direction < 0) up = true; else down = true; }
      const next: ScrollDirection = up === down ? 0 : up ? -1 : 1;
      if (next !== direction) scroll(next);
    };
    const keydown = (event: KeyboardEvent) => {
      if (blocked()) { stop(); return; }
      if (event.defaultPrevented || event.repeat || pressed.has(event.code)) return;
      if (event.target instanceof Element && (event.target.closest(editingSelector)
        || (['Space', 'Enter', 'NumpadEnter'].includes(event.code) && event.target.closest('button, a, [role="button"]')))) return;
      const binding = shortcutFromEvent(event);
      const action = binding ? mapped.get(binding) : undefined;
      if (!binding || !action) return;
      event.preventDefault();
      pressed.add(event.code);
      if (action === 'scrollUp' || action === 'scrollDown') {
        held.set(event.code, { binding, direction: action === 'scrollUp' ? -1 : 1 });
        updateScroll();
      } else {
        stop();
        latest.current.onAction(action);
      }
    };
    const keyup = (event: KeyboardEvent) => {
      pressed.delete(event.code);
      // macOS browsers can omit the other key's keyup while Cmd is held.
      if ((event.code === 'MetaLeft' || event.code === 'MetaRight') && !event.metaKey) pressed.clear();
      for (const [code, hold] of held) {
        const parts = hold.binding.split('+');
        if (code === event.code || (parts.includes('Ctrl') && !event.ctrlKey) || (parts.includes('Alt') && !event.altKey)
          || (parts.includes('Shift') && !event.shiftKey) || (parts.includes('Meta') && !event.metaKey)) held.delete(code);
      }
      updateScroll();
    };
    const blur = () => { focused = false; stop(); pressed.clear(); };
    const focus = () => { focused = true; pressed.clear(); };
    const checkContext = () => { if (blocked()) stop(); };
    const visibility = () => { if (document.hidden) { stop(); pressed.clear(); } };
    const timer = window.setInterval(() => {
      if (blocked()) { stop(); return; }
      if (direction) scroll(direction);
    }, 200);
    const observer = new MutationObserver(checkContext);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'class', 'data-assigning', 'aria-modal', 'role', 'contenteditable'] });
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    window.addEventListener('pagehide', blur);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('focusin', checkContext);
    return () => {
      stop();
      clearInterval(timer);
      observer.disconnect();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pagehide', blur);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('focusin', checkContext);
    };
  }, [bindings, enabled]);
}
