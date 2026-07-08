import type { Database } from 'bun:sqlite';

export type Migration = { name: string; up: (db: Database) => void };

/** Apply migrations past the DB's user_version, in order, each in a transaction. Returns the new version. */
export function migrate(db: Database, migrations: Migration[]): number {
  const row = db.query('PRAGMA user_version').get() as { user_version: number };
  let version = row.user_version;
  for (let i = version; i < migrations.length; i++) {
    const m = migrations[i];
    if (!m) continue;
    const tx = db.transaction(() => {
      m.up(db);
    });
    tx();
    version = i + 1;
    db.run(`PRAGMA user_version = ${version}`);
  }
  return version;
}
