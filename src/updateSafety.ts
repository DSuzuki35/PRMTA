// Keep unmounted editors registered until their final save succeeds. A failed
// save must still block an update after navigating from the library to Settings.
const saves = new Map<string | symbol, () => Promise<unknown>>();
export function registerUpdateSave(save: () => Promise<unknown>, key: string | symbol = Symbol()) {
  saves.set(key, save); return () => { if (saves.get(key) === save) saves.delete(key); };
}
export async function prepareForUpdate() {
  await Promise.all([...saves.values()].map(save => save()));
}
