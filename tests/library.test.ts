import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Library } from '../server/library';

const dirs: string[] = []; const libs: Library[] = [];
function dir() { const d = mkdtempSync(join(tmpdir(), 'prmpt-test-')); dirs.push(d); return d; }
function lib(d = dir()) { const l = new Library(d); libs.push(l); return l; }
function draft() { return { id: randomUUID(), title: 'Test', content: 'Hallo Welt', folder: '', tags: ['video'], favorite: false, deleted: false, notes: '' }; }
afterEach(() => { libs.splice(0).forEach(l => l.close()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
describe('script library', () => {
  it('rejects cyclic revision batches without corrupting existing scripts', () => {
    const l = lib(), cloud = dir(); const a = l.save(draft(), []); const b = randomUUID(), c = randomUUID();
    writeFileSync(join(cloud, 'b.prmpt.json'), JSON.stringify({ ...a, revision: b, parents: [a.revision, c], content: 'B' }));
    writeFileSync(join(cloud, 'c.prmpt.json'), JSON.stringify({ ...a, revision: c, parents: [b], content: 'C' }));
    const result = l.sync(cloud);
    expect(result.errors.length).toBeGreaterThan(0); expect(l.list()[0].content).toBe('Hallo Welt'); expect(l.history(a.id)).toHaveLength(1);
  });
  it('stores script contents as ordinary UTF-8 TXT files locally and in the cloud folder', () => {
    const d = dir(); const l = lib(d); const cloud = dir(); l.save(draft(), []); l.sync(cloud);
    const localText = readdirSync(join(d, 'scripts')).find(f => f.endsWith('.txt'))!;
    const cloudText = readdirSync(cloud).find(f => f.endsWith('.txt'))!;
    expect(readFileSync(join(d, 'scripts', localText), 'utf8')).toBe('Hallo Welt');
    expect(readFileSync(join(cloud, cloudText), 'utf8')).toBe('Hallo Welt');
    const metadata = JSON.parse(readFileSync(join(cloud, readdirSync(cloud).find(f => f.endsWith('.prmpt.json'))!), 'utf8'));
    expect(metadata.content).toBeUndefined();
  });
  it('persists scripts and revision history across reopen', () => {
    const d = dir(); const l = lib(d); const a = l.save(draft(), []);
    l.save({ ...a, content: 'Neue Fassung' }, a.heads); l.close(); libs.splice(libs.indexOf(l), 1);
    const reopened = lib(d);
    expect(reopened.list()[0].content).toBe('Neue Fassung');
    expect(reopened.history(a.id)).toHaveLength(2);
  });
  it('rejects stale saves instead of overwriting another editor', () => {
    const l = lib(); const a = l.save(draft(), []); l.save({ ...a, title: 'New' }, a.heads);
    expect(() => l.save({ ...a, title: 'Stale' }, a.heads)).toThrow(/changed/i);
    expect(l.list()[0].title).toBe('New');
  });
  it('preserves divergent cloud edits and resolves with a multi-parent revision', () => {
    const cloud = dir(); const a = lib(); const b = lib(); const first = a.save(draft(), []);
    a.sync(cloud); b.sync(cloud);
    a.save({ ...first, content: 'Computer A' }, first.heads);
    b.save({ ...first, content: 'Computer B' }, first.heads);
    a.sync(cloud); b.sync(cloud); a.sync(cloud);
    const conflicting = a.list()[0]; expect(conflicting.conflict).toBe(true); expect(conflicting.heads).toHaveLength(2);
    const merged = a.save({ ...conflicting, content: 'Zusammengeführt' }, conflicting.heads);
    expect(merged.conflict).toBe(false);
    a.sync(cloud); b.sync(cloud); expect(b.list()[0].content).toBe('Zusammengeführt');
    expect(b.history(first.id)).toHaveLength(4);
  });
  it('reports malformed sync data while preserving valid scripts and trash', () => {
    const l = lib(); const cloud = dir(); const s = l.save(draft(), []);
    l.save({ ...s, deleted: true }, s.heads); l.sync(cloud);
    writeFileSync(join(cloud, 'broken.prmpt.json'), '{bad');
    const report = l.sync(cloud); expect(report.errors.length).toBeGreaterThan(0);
    expect(l.list()[0].deleted).toBe(true);
  });
});
