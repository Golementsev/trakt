import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { MIGRATIONS } from './migrations';

export type Param = SQLInputValue;
export type Row = Record<string, unknown>;

/** Тонкая обёртка над node:sqlite: синхронные запросы, транзакции, миграции. */
export class Db {
  readonly raw: DatabaseSync;
  private txDepth = 0;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
    this.migrate();
  }

  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: Param[]) {
    return this.raw.prepare(sql).run(...params);
  }

  /** Вложенные вызовы выполняются внутри внешней транзакции. */
  tx<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn();
    this.raw.exec('BEGIN IMMEDIATE');
    this.txDepth++;
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    } finally {
      this.txDepth--;
    }
  }

  close() {
    this.raw.close();
  }

  private migrate() {
    const version = (this.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    MIGRATIONS.slice(version).forEach((sql, i) => {
      this.tx(() => {
        this.raw.exec(sql);
        this.raw.exec(`PRAGMA user_version = ${version + i + 1}`);
      });
    });
  }
}
