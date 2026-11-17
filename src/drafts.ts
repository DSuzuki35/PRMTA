import { z } from 'zod';
import { draftSchema, type Script } from '../shared/model';
// Empty titles are allowed in drafts: validation happens on save, without losing text.
const cachedDraftSchema = draftSchema.extend({ title: z.string().max(200), heads: z.array(z.string().uuid()).max(100) });
export function recoverDraft(script: Script, json: string | null): Script {
  try { const parsed = cachedDraftSchema.safeParse(JSON.parse(json ?? 'null')); return parsed.success && parsed.data.id === script.id ? { ...script, ...parsed.data } : script; }
  catch { return script; }
}
