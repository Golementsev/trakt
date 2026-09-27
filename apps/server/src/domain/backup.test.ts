import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Db } from '../db/db';
import { backupTo, exportAll } from './backup';
import { createCtx } from './context';
import { listProjects } from './projects';
import { seedDemo } from './seed';

describe('backup', () => {
  it('exports every table as JSON', () => {
    const ctx = createCtx(new Db(':memory:'));
    seedDemo(ctx);
    const dump = exportAll(ctx);
    expect(dump.app).toBe('trakt');
    expect(dump.schemaVersion).toBe(1);
    expect(dump.tables.projects).toHaveLength(3);
    expect(dump.tables.tasks).toHaveLength(17);
    expect(Object.keys(dump.tables)).toContain('events');
  });

  it('writes a consistent copy of the database file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trakt-backup-'));
    const ctx = createCtx(new Db(join(dir, 'trakt.db')));
    seedDemo(ctx);
    const copy = backupTo(ctx, join(dir, 'backups', 'copy.db'));
    const restored = createCtx(new Db(copy));
    expect(listProjects(restored).map((p) => p.key)).toEqual(['PAY', 'MOB', 'OPS']);
  });
});
