import { expect, it } from 'vitest';
import { registerUpdateSave, prepareForUpdate } from '../src/updateSafety';

it('waits for outstanding editor saves before allowing installation', async () => {
  let release!: () => void; let finished = false;
  const unregister = registerUpdateSave(() => new Promise<void>(resolve => { release = resolve; }));
  const preparation = prepareForUpdate().then(() => { finished = true; });
  await Promise.resolve(); expect(finished).toBe(false); release(); await preparation;
  expect(finished).toBe(true); unregister();
});
it('blocks installation when an editor save fails', async () => {
  const unregister = registerUpdateSave(async () => { throw new Error('disk full'); });
  await expect(prepareForUpdate()).rejects.toThrow('disk full'); unregister();
});
it('replaces a stale unmounted editor without letting its cleanup remove the new save', async () => {
  const old = registerUpdateSave(async () => { throw new Error('stale conflict'); }, 'cloud:script');
  let saved = false;
  const current = registerUpdateSave(async () => { saved = true; }, 'cloud:script');
  await prepareForUpdate(); expect(saved).toBe(true);
  saved = false; old(); await prepareForUpdate(); expect(saved).toBe(true); current();
});
