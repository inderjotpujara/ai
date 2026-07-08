import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Migration, migrate } from '../db/migrate.ts';
import type { SpaceMeta } from './types.ts';

const MEMORY_MIGRATIONS: Migration[] = [
  {
    name: 'init-spaces-and-documents',
    up: (db: Database) => {
      db.run(`CREATE TABLE IF NOT EXISTS spaces (
      name TEXT PRIMARY KEY, embed_model TEXT NOT NULL, embed_dim INTEGER NOT NULL,
      chunk_cap_tokens INTEGER NOT NULL, created_at INTEGER NOT NULL)`);
      db.run(`CREATE TABLE IF NOT EXISTS documents (
      space TEXT NOT NULL, source TEXT NOT NULL, hash TEXT NOT NULL, chunks INTEGER NOT NULL,
      at INTEGER NOT NULL, PRIMARY KEY (space, source))`);
    },
  },
];

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
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA busy_timeout = 5000');
    this.db.run('PRAGMA foreign_keys = ON');
    migrate(this.db, MEMORY_MIGRATIONS);
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

  seenDoc(space: string, source: string, hash: string): boolean {
    const r = this.db
      .query('SELECT hash FROM documents WHERE space = ? AND source = ?')
      .get(space, source) as DocRow | undefined;
    return !!r && r.hash === hash;
  }

  recordDoc(
    space: string,
    source: string,
    hash: string,
    chunks: number,
    at: number,
  ): void {
    this.db.run('INSERT OR REPLACE INTO documents VALUES (?,?,?,?,?)', [
      space,
      source,
      hash,
      chunks,
      at,
    ]);
  }

  clearDocsForSpace(space: string): void {
    this.db.run('DELETE FROM documents WHERE space = ?', [space]);
  }

  close(): void {
    this.db.close();
  }
}
