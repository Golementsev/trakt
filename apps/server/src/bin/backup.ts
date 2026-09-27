import { resolve, dirname } from 'node:path';
import { Db } from '../db/db';
import { backupTo, createCtx } from '../domain';
import { dbPath } from '../paths';

// Копия базы в data/backups/trakt-ГГГГ-ММ-ДД-ЧЧММСС.db: npm run backup (можно при работающей доске)
const stamp = new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-'); // местное время
const target = resolve(dirname(dbPath), 'backups', `trakt-${stamp}.db`);
const db = new Db(dbPath);
console.log(`Копия базы: ${backupTo(createCtx(db), target)}`);
db.close();
