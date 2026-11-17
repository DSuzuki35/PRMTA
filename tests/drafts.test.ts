import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { recoverDraft } from '../src/drafts';
import type { Script } from '../shared/model';
const script: Script = { id: randomUUID(), revision: randomUUID(), parents: [], heads: [randomUUID()], title: 'Saved title', content: 'Saved words', updatedAt: new Date().toISOString(), folder: '', tags: [], notes: '', favorite: false, deleted: false, conflict: false };
it('recovers old drafts with missing optional fields and an unfinished title', () => {
  const recovered = recoverDraft(script, JSON.stringify({ id: script.id, heads: script.heads, title: '', content: 'Unsaved words' }));
  expect(recovered.content).toBe('Unsaved words'); expect(recovered.title).toBe(''); expect(recovered.tags).toEqual([]);
});
it('does not let malformed draft data crash the editor', () => {
  expect(recoverDraft(script, '{broken')).toBe(script);
  expect(recoverDraft(script, JSON.stringify({ ...script, tags: 'not an array' }))).toBe(script);
  expect(recoverDraft(script, JSON.stringify({ ...script, id: randomUUID() }))).toBe(script);
});
