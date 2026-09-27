import { Db } from '../db/db';
import { createCtx, type Ctx } from './context';
import { createProject } from './projects';
import { listStatuses } from './statuses';
import { listTypes } from './taskTypes';

/** Контекст на базе в памяти + проект со стандартным набором. Только для тестов. */
export function setup(): {
  ctx: Ctx;
  projectId: string;
  statuses: string[];
  types: ReturnType<typeof listTypes>;
} {
  const ctx = createCtx(new Db(':memory:'));
  const p = createProject(ctx, { name: 'Checkout 2.0' });
  return {
    ctx,
    projectId: p.id,
    statuses: listStatuses(ctx, p.id).map((s) => s.id),
    types: listTypes(ctx, p.id),
  };
}
