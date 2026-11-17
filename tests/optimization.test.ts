import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Library } from '../server/library';
import { Session } from '../server/session';
import { alignTranscript } from '../shared/matcher';
import { tokenize } from '../shared/text';

const dirs: string[] = []; const libs: Library[] = [];
function dir() { const d = mkdtempSync(join(tmpdir(), 'prmpt-opt-')); dirs.push(d); return d; }
function lib(d = dir()) { const l = new Library(d); libs.push(l); return l; }
function draft() { return { id: randomUUID(), title: 'Test', content: 'Hallo Welt', folder: '', tags: ['video'], favorite: false, deleted: false, notes: '' }; }
afterEach(() => { libs.splice(0).forEach(l => l.close()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });

describe('cached transcript matching', () => {
  const script = 'Willkommen zu dem neuen Video. Heute zeigen wir unsere besten Tipps für den Start.\n\nZum Schluss danken wir allen fürs Zuschauen.';
  const cases: [string, number][] = [
    ['heute zeigen wir unsere besten tipps', 0], ['äh heute zeigen wir unsere besten tipps', 3],
    ['zum schluss danken wir allen', 5], ['Mein Hund möchte jetzt spazieren gehen', 6], ['wir', 0], ['', 4],
  ];
  it('gives identical results for token input and string input', () => {
    const tokens = tokenize(script);
    for (const [text, position] of cases) expect(alignTranscript(tokens, text, position)).toEqual(alignTranscript(script, text, position));
  });
  it('Session voice following matches the direct matcher', () => {
    const session = new Session(); session.load({ id: 'x', title: 't', content: script });
    session.command({ type: 'mode', mode: 'voice' }, 1000); session.command({ type: 'play' }, 1000);
    const expected = alignTranscript(script, cases[0][0], 0);
    session.command({ type: 'transcript', text: cases[0][0] }, 2000);
    expect(expected.matched).toBe(true);
    expect(session.snapshot().position).toBe(expected.position);
  });
  it('uses the new script after reload', () => {
    const session = new Session(); session.load({ id: 'a', title: 'a', content: 'eins zwei drei' });
    session.load({ id: 'b', title: 'b', content: 'alpha beta gamma delta epsilon zeta' });
    session.command({ type: 'mode', mode: 'voice' }, 1000); session.command({ type: 'play' }, 1000);
    session.command({ type: 'transcript', text: 'alpha beta gamma delta' }, 2000);
    expect(session.snapshot().position).toBe(alignTranscript('alpha beta gamma delta epsilon zeta', 'alpha beta gamma delta', 0).position);
    expect(session.snapshot().position).toBeGreaterThan(3 - 1);
  });
});

describe('library list cache and get', () => {
  it('reflects saves immediately and returns independent copies', () => {
    const l = lib(); const a = l.save(draft(), []);
    expect(l.list()[0].content).toBe('Hallo Welt');
    l.list()[0].content = 'mutated'; l.list()[0].heads.push('junk');
    expect(l.list()[0].content).toBe('Hallo Welt'); expect(l.list()[0].heads).toEqual(a.heads);
    l.save({ ...a, content: 'Neu' }, a.heads);
    expect(l.list()[0].content).toBe('Neu');
    const b = l.save(draft(), []); expect(l.list().map(s => s.id)).toContain(b.id); expect(l.list()).toHaveLength(2);
  });
  it('reflects imports from sync and writes by another connection', () => {
    const d = dir(); const l = lib(d), other = lib(d), cloud = dir();
    expect(l.list()).toHaveLength(0);
    const made = other.save(draft(), []);
    expect(l.list().map(s => s.id)).toEqual([made.id]);
    const source = lib(); const s = source.save(draft(), []); source.sync(cloud);
    expect(l.list()).toHaveLength(1); l.sync(cloud);
    expect(l.list().map(x => x.id)).toContain(s.id); expect(l.list()).toHaveLength(2);
  });
  it('get(id) loads a single script with head metadata', () => {
    const l = lib(); const a = l.save(draft(), []); const b = l.save({ ...a, content: 'Zwei' }, a.heads); l.save(draft(), []);
    const got = l.get(a.id)!; expect(got.content).toBe('Zwei'); expect(got.heads).toEqual(b.heads); expect(got.conflict).toBe(false);
    expect(l.get(randomUUID())).toBeUndefined();
  });
});

describe('iterative revision validation', () => {
  it('imports a very deep chain without a stack overflow', () => {
    const l = lib(), cloud = dir(); const a = l.save(draft(), []); const depth = 12000;
    let parent = a.revision;
    for (let i = 0; i < depth; i++) {
      const revision = randomUUID();
      writeFileSync(join(cloud, `${i}.prmpt.json`), JSON.stringify({ ...a, revision, parents: [parent], content: `v${i}`, updatedAt: new Date(Date.now() + i + 1).toISOString() }));
      parent = revision;
    }
    const result = l.sync(cloud);
    expect(result.errors).toEqual([]); expect(result.imported).toBe(depth);
    expect(l.get(a.id)!.heads).toEqual([parent]);
  }, 180000);
  it('still rejects cycles and cross-script parents', () => {
    const l = lib(), cloud = dir(); const a = l.save(draft(), []); const other = l.save(draft(), []);
    const b = randomUUID(), c = randomUUID(), d = randomUUID();
    writeFileSync(join(cloud, 'b.prmpt.json'), JSON.stringify({ ...a, revision: b, parents: [c], content: 'B' }));
    writeFileSync(join(cloud, 'c.prmpt.json'), JSON.stringify({ ...a, revision: c, parents: [b], content: 'C' }));
    writeFileSync(join(cloud, 'd.prmpt.json'), JSON.stringify({ ...other, revision: d, parents: [a.revision], content: 'D' }));
    const result = l.sync(cloud);
    expect(result.errors.length).toBe(2); expect(result.imported).toBe(0);
    expect(l.history(a.id)).toHaveLength(1); expect(l.history(other.id)).toHaveLength(1);
  });
});
