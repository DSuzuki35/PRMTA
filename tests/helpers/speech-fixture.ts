import assert from 'node:assert/strict';

// Public JFK fixture only; callers must never send user recordings to this check.
export function assertSpeechFixture(result: { ok: boolean; text: string; ms: number }) {
  assert.equal(result.ok, true, 'Native fixture transcription must succeed');
  assert.equal(typeof result.text, 'string');
  assert(Number.isFinite(result.ms) && result.ms >= 0, 'Invalid transcription timing');
  const words = result.text.trim().split(/\s+/).filter(Boolean);
  assert(words.length >= 3, 'The public speech fixture must produce a nonempty transcript');
  const tokens = new Set(result.text.toLowerCase().match(/[a-z]+/g) ?? []);
  assert(['ask', 'country', 'americans'].filter(word => tokens.has(word)).length >= 2, 'Transcript does not match the public JFK fixture');
  return { ms: result.ms, words: words.length, characters: result.text.length };
}
