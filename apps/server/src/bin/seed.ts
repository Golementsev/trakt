import { Db } from '../db/db';
import { createCtx, seedDemo } from '../domain';
import { dbPath } from '../paths';

// Заполняет пустую базу демо-проектами из макета: npm run seed
const db = new Db(dbPath);
console.log(
  seedDemo(createCtx(db)) ? `Демо-проекты добавлены в ${dbPath}` : 'В базе уже есть проекты — сид пропущен',
);
db.close();
