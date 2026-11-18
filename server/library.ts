import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { draftSchema, revisionSchema, type Draft, type Script, type Revision } from '../shared/model';

export class ConflictError extends Error { status = 409; }
/**
 * Iterative DFS (no call-stack depth limit). Invalid if a cycle exists or a parent belongs to another script.
 * Parents missing from the graph are tolerated: they may arrive in a later sync.
 */
export function validChain(graph: Map<string, Revision>, id: string, revisions: Revision[]): boolean {
  const visiting = new Set<string>(), visited = new Set<string>();
  for (const root of revisions) {
    if (visited.has(root.revision)) continue;
    const stack: { key: string; parents: string[]; next: number }[] = [{ key: root.revision, parents: root.parents, next: 0 }];
    visiting.add(root.revision);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.next >= frame.parents.length) { visiting.delete(frame.key); visited.add(frame.key); stack.pop(); continue; }
      const key = frame.parents[frame.next++];
      if (visiting.has(key)) return false;
      if (visited.has(key)) continue;
      const revision = graph.get(key); if (!revision) continue;
      if (revision.id !== id) return false;
      visiting.add(key); stack.push({ key, parents: revision.parents, next: 0 });
    }
  }
  return true;
}
export class Library {
  private db: DatabaseSync;
  private closed = false;
  private listCache: { version: number; scripts: Script[] } | null = null;
  readonly dir: string;
  constructor(dir: string) {
    this.dir = resolve(dir); mkdirSync(this.dir, { recursive: true });
    this.db = new DatabaseSync(join(this.dir, 'library.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS revisions (revision TEXT PRIMARY KEY, script TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS script_idx ON revisions(script); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  }
  private all(): Revision[] {
    return this.db.prepare('SELECT data FROM revisions').all().map(r => JSON.parse(r.data as string));
  }
  private heads(versions: Revision[]): Revision[] {
    const parents = new Set(versions.flatMap(v => v.parents));
    return versions.filter(v => !parents.has(v.revision)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.revision.localeCompare(a.revision));
  }
  private script(versions: Revision[]): Script {
    const heads = this.heads(versions);
    return { ...heads[0], heads: heads.map(h => h.revision).sort(), conflict: heads.length > 1 };
  }
  save(input: Draft, expectedHeads: string[]): Script {
    const draft = draftSchema.parse(input);
    const history = this.history(draft.id); const heads = this.heads(history).map(h => h.revision).sort();
    if (JSON.stringify(heads) !== JSON.stringify([...expectedHeads].sort())) throw new ConflictError('Script changed elsewhere. Reload or save your text as a copy.');
    const revision: Revision = { ...draft, revision: randomUUID(), parents: heads, updatedAt: new Date().toISOString() };
    this.insert(revision);
    return this.script([...history, revision]);
  }
  private insert(revision: Revision) {
    this.listCache = null; // invalidate even if a step below throws part-way
    this.publish(join(this.dir, 'scripts'), revision);
    this.db.prepare('INSERT INTO revisions(revision,script,data) VALUES (?,?,?)').run(revision.revision, revision.id, JSON.stringify(revision));
    this.listCache = null;
  }
  private dataVersion(): number {
    return Number((this.db.prepare('PRAGMA data_version').get() as Record<string, unknown>).data_version);
  }
  /** Loads one script (current head, with heads/conflict info) or undefined if unknown. */
  get(id: string): Script | undefined {
    const versions = this.history(id);
    return versions.length ? this.script(versions) : undefined;
  }
  private publish(folder: string, revision: Revision) {
    mkdirSync(folder, { recursive: true });
    const stem = `${revision.id}.${revision.revision}`;
    const publishFile = (name: string, data: string) => {
      const target = join(folder, name); if (existsSync(target)) return;
      const temp = `${target}.${randomUUID()}.tmp`;
      writeFileSync(temp, data, { encoding: 'utf8', flag: 'wx' }); renameSync(temp, target);
    };
    publishFile(`${stem}.txt`, revision.content);
    const { content: _content, ...metadata } = revision;
    // The metadata is published last; import retries incomplete cloud deliveries.
    publishFile(`${stem}.prmpt.json`, JSON.stringify(metadata, null, 2));
  }
  list(): Script[] {
    // data_version changes when another connection/process commits, so external writers also invalidate the cache.
    const version = this.dataVersion();
    if (!this.listCache || this.listCache.version !== version) {
      const grouped = new Map<string, Revision[]>();
      for (const r of this.all()) { const list = grouped.get(r.id) ?? []; list.push(r); grouped.set(r.id, list); }
      const scripts = [...grouped.values()].map(v => this.script(v)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      this.listCache = { version, scripts };
    }
    return structuredClone(this.listCache.scripts); // callers get private copies
  }
  history(id: string): Revision[] {
    return this.db.prepare('SELECT data FROM revisions WHERE script=?').all(id).map(r => JSON.parse(r.data as string) as Revision).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  importRevisions(revisions: Revision[]) {
    const known = new Map(this.all().map(r => [r.revision, r]));
    const graph = new Map(known);
    for (const input of revisions) {
      const r = revisionSchema.parse(input), old = known.get(r.revision);
      if (old && JSON.stringify(old) !== JSON.stringify(r)) throw new Error('Revision collision');
      graph.set(r.revision, r);
    }
    for (const id of new Set(revisions.map(r => r.id))) if (!validChain(graph, id, [...graph.values()].filter(r => r.id === id))) throw new Error('Invalid revision chain');
    for (const r of revisions) if (!known.has(r.revision)) this.insert(revisionSchema.parse(r));
  }
  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return row ? JSON.parse(row.value as string) : fallback;
  }
  setSetting(key: string, value: unknown) {
    this.db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  }
  sync(folder: string): { errors: string[]; imported: number; exported: number } {
    const report = { errors: [] as string[], imported: 0, exported: 0 };
    if (!folder) return report;
    const root = resolve(folder);
    if (root === this.dir) throw new Error('Choose a separate sync folder, not the active database directory.');
    mkdirSync(root, { recursive: true });
    const known = new Map(this.all().map(r => [r.revision, r]));
    const pending = new Map<string, Revision>();
    for (const file of readdirSync(root).filter(f => f.endsWith('.prmpt.json'))) {
      try {
        const path = join(root, file);
        if (statSync(path).size > 2000000) throw new Error('File too large');
        const metadata = JSON.parse(readFileSync(path, 'utf8'));
        const identity = revisionSchema.pick({ id: true, revision: true }).parse(metadata);
        const textPath = join(root, `${identity.id}.${identity.revision}.txt`);
        if (metadata.content === undefined && statSync(textPath).size > 2000000) throw new Error('Text file too large');
        const revision = revisionSchema.parse({ ...metadata, content: metadata.content ?? readFileSync(textPath, 'utf8') });
        if (revision.parents.includes(revision.revision)) throw new Error('Invalid self-parent');
        const existing = known.get(revision.revision) ?? pending.get(revision.revision);
        if (existing && JSON.stringify(existing) !== JSON.stringify(revision)) throw new Error('Revision collision');
        if (!existing) pending.set(revision.revision, revision);
      } catch (error) { report.errors.push(`${file}: ${error instanceof Error ? error.message.slice(0, 160) : 'Invalid file'}`); }
    }
    const graph = new Map([...known, ...pending]); const rejected = new Set<string>();
    const byScript = new Map<string, Revision[]>();
    for (const r of graph.values()) { const list = byScript.get(r.id) ?? []; list.push(r); byScript.set(r.id, list); }
    for (const id of new Set([...pending.values()].map(r => r.id))) {
      if (!validChain(graph, id, byScript.get(id) ?? [])) { rejected.add(id); report.errors.push(`${id}: Invalid revision chain; incoming versions were not imported.`); }
    }
    for (const revision of pending.values()) if (!rejected.has(revision.id)) { this.insert(revision); known.set(revision.revision, revision); report.imported++; }
    for (const revision of known.values()) {
      const target = join(root, `${revision.id}.${revision.revision}.prmpt.json`);
      if (existsSync(target) && existsSync(join(root, `${revision.id}.${revision.revision}.txt`))) continue;
      try {
        this.publish(root, revision); report.exported++;
      } catch (error) { report.errors.push(`Export: ${String(error)}`); }
    }
    return report;
  }
  close() { if (!this.closed) { this.db.close(); this.closed = true; } }
}
