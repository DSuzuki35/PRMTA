import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { draftSchema, revisionSchema, type Draft, type Revision, type Script } from '../shared/model';
import { ConflictError, Library } from './library';

const entrySchema = draftSchema.omit({ content: true, deleted: true }).extend({ file: z.string().min(1).max(240) });
const manifestSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema).max(10000) });
type Entry = z.infer<typeof entrySchema>;
const same = (a: Draft, b: Draft) => JSON.stringify(draftSchema.parse(a)) === JSON.stringify(draftSchema.parse(b));
const metadata = (s: Draft, file: string): Entry => entrySchema.parse({ ...s, file });
const safeName = (title: string) => {
  let name = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 120) || 'Untitled script';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return name;
};

/** Current TXT files are authoritative. SQLite and revision TXT files stay local. */
export class CloudLibrary {
  readonly folder: string;
  private mapping: Record<string, string>;
  private textCache = new Map<string, { stamp: string; content: string }>();
  constructor(readonly library: Library, folder: string, private backups: string) {
    this.folder = resolve(folder); this.mapping = library.getSetting('cloudFiles', {});
  }
  private path(file: string) {
    if (basename(file) !== file || /[<>:"/\\|?*\x00-\x1f]/.test(file) || !file.toLowerCase().endsWith('.txt') || file.startsWith('.')) throw new Error('Invalid cloud filename');
    const path = join(this.folder, file);
    if (existsSync(path) && !lstatSync(path).isFile()) throw new Error('Cloud script must be a regular TXT file');
    return path;
  }
  private checkFolder() {
    if (!existsSync(this.folder) || !lstatSync(this.folder).isDirectory()) throw new Error('Cloud folder is unavailable. Your local recovery copy has been kept.');
    const internal = join(this.folder, '.prmta');
    if (existsSync(internal) && !lstatSync(internal).isDirectory()) throw new Error('Invalid .prmta metadata directory');
  }
  private manifestPath() { return join(this.folder, '.prmta', 'library.json'); }
  private readManifest(): Entry[] {
    const path = this.manifestPath(); if (!existsSync(path)) return [];
    if (!lstatSync(path).isFile() || lstatSync(path).size > 10_000_000) throw new Error('Invalid cloud metadata file');
    const entries = manifestSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).entries;
    const ids = new Set(), files = new Set();
    for (const e of entries) { this.path(e.file); if (ids.has(e.id) || files.has(e.file.toLowerCase())) throw new Error('Duplicate cloud metadata identity'); ids.add(e.id); files.add(e.file.toLowerCase()); }
    return entries.sort((a, b) => a.file.localeCompare(b.file, 'en'));
  }
  private writeManifest(entries: Entry[]) {
    this.checkFolder(); mkdirSync(join(this.folder, '.prmta'), { recursive: true });
    this.atomic(this.manifestPath(), JSON.stringify({ version: 1, entries: [...entries].sort((a, b) => a.file.localeCompare(b.file, 'en')) }, null, 2));
  }
  private atomic(path: string, text: string) {
    const temp = `${path}.${randomUUID()}.tmp`;
    try { writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx' }); renameSync(temp, path); }
    finally { if (existsSync(temp)) unlinkSync(temp); }
  }
  private filename(title: string, except?: string) {
    const used = new Set(readdirSync(this.folder).filter(f => f !== except).map(f => f.toLowerCase()));
    const name = safeName(title); let file = `${name}.txt`, n = 2;
    while (used.has(file.toLowerCase())) file = `${name} (${n++}).txt`;
    return file;
  }
  private migrateLegacy() {
    this.finishLegacyCleanup();
    const legacy = readdirSync(this.folder).filter(f => /^[a-f\d-]{36}\.[a-f\d-]{36}\.prmpt\.json$/i.test(f));
    if (!legacy.length) return;
    const revisions: Revision[] = [], files: string[] = [];
    for (const file of legacy) {
      const path = join(this.folder, file);
      if (!lstatSync(path).isFile() || lstatSync(path).size > 2_000_000) throw new Error('Invalid legacy metadata');
      const meta = JSON.parse(readFileSync(path, 'utf8'));
      const identity = revisionSchema.pick({ id: true, revision: true }).parse(meta);
      if (file !== `${identity.id}.${identity.revision}.prmpt.json`) throw new Error('Legacy filename does not match its identity');
      const textFile = `${identity.id}.${identity.revision}.txt`, textPath = this.path(textFile);
      if (lstatSync(textPath).size > 2_000_000) throw new Error('Legacy script too large');
      const content = readFileSync(textPath, 'utf8');
      if (meta.content !== undefined && meta.content !== content) throw new Error('Legacy text and metadata differ');
      revisions.push(revisionSchema.parse({ ...meta, content })); files.push(file, textFile);
    }
    const parents = new Set(revisions.flatMap(r => r.parents));
    const heads = revisions.filter(r => !parents.has(r.revision));
    if (new Set(heads.map(r => r.id)).size !== heads.length) throw new Error('Resolve legacy version conflicts in the previous library before converting this folder. No legacy files were removed.');
    // Validate and preserve the complete history locally before removing anything.
    this.library.importRevisions(revisions);
    const entries = this.readManifest();
    for (const r of heads.filter(r => !r.deleted)) {
      const entry = entries.find(e => e.id === r.id);
      if (entry && existsSync(this.path(entry.file)) && readFileSync(this.path(entry.file), 'utf8') !== r.content) throw new Error('Migration found an edited current file. Resolve it before retrying; original versions remain in local history.');
    }
    const backup = join(resolve(this.backups), `legacy-${Date.now()}-${randomUUID().slice(0, 8)}`);
    mkdirSync(backup, { recursive: true });
    for (const file of files) {
      const source = join(this.folder, file), target = join(backup, file);
      copyFileSync(source, target);
      if (!readFileSync(source).equals(readFileSync(target))) throw new Error('Legacy backup verification failed');
    }
    for (const r of heads.filter(r => !r.deleted)) {
      let entry = entries.find(e => e.id === r.id);
      if (entry) {
        // A resumed migration must never overwrite a file that was edited meanwhile.
        if (existsSync(this.path(entry.file)) && readFileSync(this.path(entry.file), 'utf8') !== r.content) throw new Error('Migration found an edited current file. Original versions are backed up locally.');
      } else {
        entry = metadata(r, this.filename(r.title)); entries.push(entry);
        this.writeManifest(entries); // Identity survives interruption before TXT publication.
      }
      if (!existsSync(this.path(entry.file))) writeFileSync(this.path(entry.file), r.content, { flag: 'wx', encoding: 'utf8' });
    }
    this.writeManifest(entries);
    // Persist the verified cleanup plan locally, so interruption cannot turn
    // orphaned historical TXT files into new scripts on the next startup.
    this.library.setSetting('legacyCleanup', { backup, files });
    this.finishLegacyCleanup();
    this.library.setSetting('legacyBackup', backup);
  }
  private finishLegacyCleanup() {
    const plan = this.library.getSetting<{ backup: string; files: string[] } | null>('legacyCleanup', null);
    if (!plan) return;
    const location = relative(resolve(this.backups), resolve(plan.backup));
    if (!location || location.startsWith('..') || location.includes(':')) throw new Error('Invalid legacy backup location');
    for (const file of plan.files) {
      if (!/^[a-f\d-]{36}\.[a-f\d-]{36}\.(txt|prmpt\.json)$/i.test(file)) throw new Error('Invalid legacy cleanup filename');
      const source = join(this.folder, file), backup = join(plan.backup, file);
      if (!lstatSync(backup).isFile()) throw new Error('Missing verified legacy backup');
      if (existsSync(source)) {
        if (!lstatSync(source).isFile() || !readFileSync(source).equals(readFileSync(backup))) throw new Error('Legacy file changed during migration; original backup retained.');
        unlinkSync(source);
      }
    }
    this.library.setSetting('legacyBackup', plan.backup); this.library.setSetting('legacyCleanup', null);
  }
  sync() {
    this.checkFolder(); this.finishWrite(); this.migrateLegacy();
    const oldEntries = this.readManifest(), entries: Entry[] = [];
    const byFile = new Map(oldEntries.map(e => [e.file.toLowerCase(), e]));
    const scripts = this.library.list(), byId = new Map(scripts.map(s => [s.id, s]));
    // Read the entire snapshot first. Read errors must never look like deletions.
    const files = readdirSync(this.folder).filter(f => !f.startsWith('.') && f.toLowerCase().endsWith('.txt'));
    for (const file of this.textCache.keys()) if (!files.includes(file)) this.textCache.delete(file);
    const errors: string[] = [], invalid = new Set<string>();
    const snapshot: { file: string; content: string }[] = [];
    for (const file of files) try {
      if (/^[a-f\d-]{36}\.[a-f\d-]{36}\.txt$/i.test(file)) throw new Error('Waiting for legacy metadata');
      const path = this.path(file), stat = lstatSync(path);
      if (stat.size > 2_000_000) throw new Error('TXT file is too large');
      const stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`, cached = this.textCache.get(file);
      const content = cached?.stamp === stamp ? cached.content : readFileSync(path, 'utf8');
      if (content.length > 500000) throw new Error('TXT exceeds 500,000 characters');
      if (!file.slice(0, -4).trim()) throw new Error('TXT filename needs a title');
      this.textCache.set(file, { stamp, content }); snapshot.push({ file, content });
    } catch (e) { errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`); invalid.add(file.toLowerCase()); }
    let imported = 0;
    const present = new Set<string>();
    for (const { file, content } of snapshot) {
      const old = byFile.get(file.toLowerCase());
      const remembered = Object.entries(this.mapping).find(([, f]) => f === file)?.[0];
      const id = old?.id ?? remembered ?? randomUUID(), previous = byId.get(id);
      const draft = draftSchema.parse({ ...(old ?? previous ?? {}), id, title: old?.title ?? file.slice(0, -4).trim().slice(0, 200), content, deleted: false });
      if (!previous || !same(previous, draft)) { this.library.save(draft, previous?.heads ?? []); imported++; }
      present.add(id); entries.push(metadata(draft, file)); this.mapping[id] = file;
    }
    for (const e of oldEntries) if (invalid.has(e.file.toLowerCase())) { entries.push(e); present.add(e.id); }
    for (const s of scripts) if (!s.deleted && this.mapping[s.id] && !present.has(s.id) && !invalid.has(this.mapping[s.id].toLowerCase())) { this.library.save({ ...s, deleted: true }, s.heads); imported++; }
    entries.sort((a, b) => a.file.localeCompare(b.file, 'en'));
    if (JSON.stringify(entries) !== JSON.stringify(oldEntries)) this.writeManifest(entries);
    this.library.setSetting('cloudFiles', this.mapping);
    return { errors, imported, exported: 0 };
  }
  save(input: Draft, expectedHeads: string[]): Script {
    this.sync(); const draft = draftSchema.parse(input), old = this.library.get(draft.id);
    if (JSON.stringify(old?.heads ?? []) !== JSON.stringify([...expectedHeads].sort())) throw new ConflictError('Script changed elsewhere. Reload or save your text as a copy.');
    if (old && same(old, draft)) return old;
    const entries = this.readManifest(), oldEntry = entries.find(e => e.id === draft.id);
    const oldFile = oldEntry?.file;
    const file = old && old.title === draft.title && oldFile ? oldFile : this.filename(draft.title, oldFile);
    if (oldFile && readFileSync(this.path(oldFile), 'utf8') !== old?.content) throw new ConflictError('Script changed during save. Refresh and try again.');
    this.library.setSetting('cloudWrite', { draft, expectedHeads, oldFile, file, oldContent: old?.content });
    return this.finishWrite()!;
  }
  private finishWrite(): Script | null {
    const pending = this.library.getSetting<{ draft: Draft; expectedHeads: string[]; oldFile?: string; file: string; oldContent?: string } | null>('cloudWrite', null);
    if (!pending) return null;
    const { draft, expectedHeads, oldFile, file, oldContent } = pending;
    const recover = () => {
      const recovered = this.library.getSetting<Draft[]>('recoveredCloudDrafts', []);
      recovered.push({ ...draft, id: randomUUID(), title: `${draft.title.slice(0, 175)} (Recovered draft)`, deleted: false });
      this.library.setSetting('recoveredCloudDrafts', recovered); this.library.setSetting('cloudWrite', null);
      return new ConflictError('Cloud file changed during an interrupted save. Your draft is available in Settings > Recovered drafts.');
    };
    let sameFile = oldFile === file;
    if (oldFile && !sameFile && existsSync(this.path(oldFile)) && existsSync(this.path(file))) {
      const source = lstatSync(this.path(oldFile), { bigint: true }), target = lstatSync(this.path(file), { bigint: true });
      if (source.ino !== 0n && source.dev === target.dev && source.ino === target.ino) {
        // APFS and NTFS can resolve different capitalization to one entry. OS
        // labels cannot tell us a volume's case rules. Distinct hard-link names
        // also share an inode, so keep treating those as separate destinations.
        const names = readdirSync(this.folder);
        sameFile = !(names.includes(oldFile) && names.includes(file));
      }
    }
    if (oldFile && existsSync(this.path(oldFile))) {
      const actual = readFileSync(this.path(oldFile), 'utf8');
      if (actual !== oldContent && !(sameFile && actual === draft.content)) throw recover();
    }
    if (!draft.deleted) {
      if (!sameFile && existsSync(this.path(file)) && readFileSync(this.path(file), 'utf8') !== draft.content) throw recover();
      if (!existsSync(this.path(file)) || readFileSync(this.path(file), 'utf8') !== draft.content) this.atomic(this.path(file), draft.content);
    }
    const entries = this.readManifest();
    this.writeManifest([...entries.filter(e => e.id !== draft.id), ...(!draft.deleted ? [metadata(draft, file)] : [])]);
    if (oldFile && (draft.deleted || !sameFile) && existsSync(this.path(oldFile))) unlinkSync(this.path(oldFile));
    this.mapping[draft.id] = file; this.library.setSetting('cloudFiles', this.mapping);
    const current = this.library.get(draft.id);
    let saved: Script;
    try { saved = current && same(current, draft) ? current : this.library.save(draft, expectedHeads); }
    catch (e) { if (e instanceof ConflictError) throw recover(); throw e; }
    this.library.setSetting('cloudWrite', null); return saved;
  }
}
