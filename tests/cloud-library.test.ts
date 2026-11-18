import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, unlinkSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Library } from '../server/library';
import { CloudLibrary } from '../server/cloud-library';
const roots: string[] = [], libraries: Library[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), 'prmta-cloud-')); roots.push(d); return d; };
const local = () => { const l = new Library(dir()); libraries.push(l); return l; };
const draft = (title = 'VR Script') => ({ id: randomUUID(), title, content: 'My story.', folder: '', tags: [], favorite: false, deleted: false, notes: '' });
const txt = (folder: string) => readdirSync(folder).filter(f => f.endsWith('.txt'));
afterEach(() => { libraries.splice(0).forEach(l => l.close()); roots.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
it('keeps exactly one readable TXT on save/rename, removes it on trash, restores it explicitly', () => {
  const cache = local(), folder = dir(), cloud = new CloudLibrary(cache, folder, dir()); cloud.sync();
  let s = cloud.save(draft(), []); expect(txt(folder)).toEqual(['VR Script.txt']);
  s = cloud.save({ ...s, title: 'New title' }, s.heads); expect(txt(folder)).toEqual(['New title.txt']);
  s = cloud.save({ ...s, deleted: true }, s.heads); expect(txt(folder)).toEqual([]);
  cloud.sync(); expect(cache.get(s.id)?.deleted).toBe(true);
  cloud.save({ ...s, deleted: false }, s.heads); expect(txt(folder)).toEqual(['New title.txt']);
  expect(cache.history(s.id).length).toBeGreaterThanOrEqual(4);
});
it('opens existing TXT files, imports edits and deletions, rejects an outdated editor save', () => {
  const cache = local(), folder = dir(); writeFileSync(join(folder, 'Existing.txt'), 'First');
  const cloud = new CloudLibrary(cache, folder, dir()); cloud.sync(); const first = cache.list()[0];
  writeFileSync(join(folder, 'Existing.txt'), 'Changed elsewhere');
  expect(() => cloud.save({ ...first, content: 'Stale' }, first.heads)).toThrow(/changed/i);
  expect(cache.get(first.id)?.content).toBe('Changed elsewhere');
  unlinkSync(join(folder, 'Existing.txt')); cloud.sync(); expect(cache.get(first.id)?.deleted).toBe(true);
  expect(txt(folder)).toEqual([]);
});
it('preserves colliding names and never publishes local history to the cloud', () => {
  const cache = local(), folder = dir(), cloud = new CloudLibrary(cache, folder, dir()); cloud.sync();
  cloud.save(draft('Same'), []); cloud.save(draft('Same'), []);
  expect(txt(folder).length).toBe(2); expect(readdirSync(folder).some(f => f.endsWith('.prmpt.json'))).toBe(false);
});
it('migrates old versions only after a local backup, excluding trashed scripts', () => {
  const old = local(), folder = dir(), backup = dir(); let s = old.save(draft(), []);
  s = old.save({ ...s, title: 'Final name' }, s.heads);
  const deleted = old.save(draft('Deleted'), []); old.save({ ...deleted, deleted: true }, deleted.heads); old.sync(folder);
  const before = readdirSync(folder); const cache = local(), cloud = new CloudLibrary(cache, folder, backup); cloud.sync();
  expect(txt(folder)).toEqual(['Final name.txt']); expect(readFileSync(join(folder, 'Final name.txt'), 'utf8')).toBe(s.content);
  expect(readdirSync(folder).filter(f => f.endsWith('.prmpt.json'))).toEqual([]);
  expect(readdirSync(join(backup, readdirSync(backup)[0])).sort()).toEqual(before.sort());
  expect(cache.get(s.id)?.title).toBe('Final name');
});
it('does not delete cached scripts when the folder is unavailable', () => {
  const cache = local(), folder = dir(), cloud = new CloudLibrary(cache, folder, dir()); cloud.sync(); const s = cloud.save(draft(), []);
  rmSync(folder, { recursive: true }); expect(() => cloud.sync()).toThrow(); expect(cache.get(s.id)?.deleted).toBe(false);
});
it('keeps the file when changing only title capitalization', () => {
  const cache = local(), folder = dir(), cloud = new CloudLibrary(cache, folder, dir()); cloud.sync();
  const s = cloud.save(draft('Title'), []); cloud.save({ ...s, title: 'TITLE' }, s.heads);
  expect(txt(folder)).toHaveLength(1); expect(readFileSync(join(folder, txt(folder)[0]), 'utf8')).toBe(s.content);
});
it('reports unsuitable TXT files without blocking valid scripts or erasing them', () => {
  const cache = local(), folder = dir(), cloud = new CloudLibrary(cache, folder, dir()); cloud.sync(); const s = cloud.save(draft(), []);
  writeFileSync(join(folder, 'Too long.txt'), 'x'.repeat(500001));
  expect(cloud.sync().errors).toHaveLength(1);
  cloud.save({ ...s, title: '.notes', content: 'Updated safely' }, s.heads);
  expect(readFileSync(join(folder, 'notes.txt'), 'utf8')).toBe('Updated safely');
});
it('recovers an interrupted rename without losing identity or metadata', () => {
  const cache = local(), folder = dir(), cloud = new CloudLibrary(cache, folder, dir()); cloud.sync(); const s = cloud.save({ ...draft('Old'), notes: 'Keep notes' }, []);
  const next = { ...s, title: 'New' };
  cache.setSetting('cloudWrite', { draft: next, expectedHeads: s.heads, oldFile: 'Old.txt', file: 'New.txt', oldContent: s.content });
  writeFileSync(join(folder, 'New.txt'), s.content);
  new CloudLibrary(cache, folder, dir()).sync();
  expect(txt(folder)).toEqual(['New.txt']); expect(cache.get(s.id)?.notes).toBe('Keep notes'); expect(cache.get(s.id)?.title).toBe('New');
});
it('resumes verified legacy cleanup and refuses to erase files edited since backup', () => {
  const old = local(), folder = dir(), backupRoot = dir(); old.save(draft(), []); old.sync(folder);
  const cache = local(), cloud = new CloudLibrary(cache, folder, backupRoot); cloud.sync();
  const backup = cache.getSetting<string>('legacyBackup', ''), files = readdirSync(backup);
  for (const file of files.slice(1)) copyFileSync(join(backup, file), join(folder, file));
  cache.setSetting('legacyCleanup', { backup, files }); cloud.sync(); expect(txt(folder)).toEqual(['VR Script.txt']);
  const name = files.find(f => f.endsWith('.txt'))!; writeFileSync(join(folder, name), 'Changed after backup');
  cache.setSetting('legacyCleanup', { backup, files }); expect(() => cloud.sync()).toThrow(/changed during migration/);
  expect(readFileSync(join(folder, name), 'utf8')).toBe('Changed after backup');
});
it('rejects conflicting legacy heads before publishing files or repeatedly backing up', () => {
  const folder = dir(), a = local(), b = local(), backup = dir(); const first = a.save(draft(), []);
  a.sync(folder); b.sync(folder); a.save({ ...first, content: 'A' }, first.heads); b.save({ ...first, deleted: true }, first.heads); a.sync(folder); b.sync(folder);
  const before = readdirSync(folder), cloud = new CloudLibrary(local(), folder, backup);
  expect(() => cloud.sync()).toThrow(/legacy version conflicts/); expect(() => cloud.sync()).toThrow(/legacy version conflicts/);
  expect(readdirSync(folder)).toEqual(before); expect(readdirSync(backup)).toEqual([]);
});
it('keeps a conflicting interrupted draft recoverable without locking future sync', () => {
  const cache = local(), folder = dir(), cloud = new CloudLibrary(cache, folder, dir()); cloud.sync(); const s = cloud.save(draft('Old'), []);
  cache.setSetting('cloudWrite', { draft: { ...s, title: 'Wanted', content: 'My draft' }, expectedHeads: s.heads, oldFile: 'Old.txt', file: 'Wanted.txt', oldContent: s.content });
  writeFileSync(join(folder, 'Old.txt'), 'New external version');
  expect(() => cloud.sync()).toThrow(/Recovered drafts/);
  expect(cache.getSetting<any[]>('recoveredCloudDrafts', [])[0].content).toBe('My draft');
  cloud.sync(); expect(cache.get(s.id)?.content).toBe('New external version');
  cloud.save(draft('Another'), []); expect(txt(folder).sort()).toEqual(['Another.txt', 'Old.txt']);
});
it('does not repeat backups when a partially migrated current file was edited', () => {
  const old = local(), folder = dir(), backups = dir(); old.save(draft(), []); old.sync(folder);
  const cache = local(), cloud = new CloudLibrary(cache, folder, backups); cloud.sync();
  const backup = cache.getSetting<string>('legacyBackup', '');
  for (const file of readdirSync(backup)) copyFileSync(join(backup, file), join(folder, file));
  writeFileSync(join(folder, 'VR Script.txt'), 'Newer edit'); const before = readdirSync(backups);
  expect(() => cloud.sync()).toThrow(/edited current file/); expect(() => cloud.sync()).toThrow(/edited current file/);
  expect(readdirSync(backups)).toEqual(before); expect(readFileSync(join(folder, 'VR Script.txt'), 'utf8')).toBe('Newer edit');
});
