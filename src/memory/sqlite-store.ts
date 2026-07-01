import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SpaceMeta } from './types.ts';

type SpaceRow = {
  name: string;
  embed_model: string;
  embed_dim: number;
  chunk_cap_tokens: number;
  created_at: number;
};

type DocRow = {
  hash: string;
};

export class SqliteStore {
  private db: Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.run(`CREATE TABLE IF NOT EXISTS spaces (
      name TEXT PRIMARY KEY, embed_model TEXT NOT NULL, embed_dim INTEGER NOT NULL,
      chunk_cap_tokens INTEGER NOT NULL, created_at INTEGER NOT NULL)`);
    this.db.run(`CREATE TABLE IF NOT EXISTS documents (
      source TEXT PRIMARY KEY, hash TEXT NOT NULL, chunks INTEGER NOT NULL, at INTEGER NOT NULL)`);
  }

  getSpace(name: string): SpaceMeta | undefined {
    const r = this.db.query('SELECT * FROM spaces WHERE name = ?').get(name) as
      | SpaceRow
      | undefined;
    if (!r) return undefined;
    return {
      name: r.name,
      embedModel: r.embed_model,
      embedDim: r.embed_dim,
      chunkCapTokens: r.chunk_cap_tokens,
      createdAt: r.created_at,
    };
  }

  createSpace(m: SpaceMeta): void {
    this.db.run('INSERT OR REPLACE INTO spaces VALUES (?,?,?,?,?)', [
      m.name,
      m.embedModel,
      m.embedDim,
      m.chunkCapTokens,
      m.createdAt,
    ]);
  }

  listSpaces(): SpaceMeta[] {
    const rows = this.db.query('SELECT * FROM spaces').all() as SpaceRow[];
    return rows.map((r) => ({
      name: r.name,
      embedModel: r.embed_model,
      embedDim: r.embed_dim,
      chunkCapTokens: r.chunk_cap_tokens,
      createdAt: r.created_at,
    }));
  }

  seenDoc(source: string, hash: string): boolean {
    const r = this.db
      .query('SELECT hash FROM documents WHERE source = ?')
      .get(source) as DocRow | undefined;
    return !!r && r.hash === hash;
  }

  recordDoc(source: string, hash: string, chunks: number, at: number): void {
    this.db.run('INSERT OR REPLACE INTO documents VALUES (?,?,?,?)', [
      source,
      hash,
      chunks,
      at,
    ]);
  }

  close(): void {
    this.db.close();
  }
}
