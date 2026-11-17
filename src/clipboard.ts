export async function copyText(text: string): Promise<void> {
  if (window.desktop?.copyText) { await window.desktop.copyText(text); return; }
  try { await navigator.clipboard.writeText(text); return; } catch { /* HTTP LAN/browser fallback, still invoked by a user gesture. */ }
  const previous = document.activeElement as HTMLElement | null;
  const field = document.createElement('textarea'); field.value = text; field.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.append(field); field.select();
  try { if (!document.execCommand('copy')) throw new Error('Clipboard access denied. Select the link and copy it manually.'); }
  finally { field.remove(); previous?.focus(); }
}
