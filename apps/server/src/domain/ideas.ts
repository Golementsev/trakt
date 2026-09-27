import type { CreateIdeaInput, Idea } from '@trakt/shared';
import { notFound, type Ctx } from './context';
import { notify } from './events';
import { getProjectRow } from './projects';

interface IdeaRow {
  id: string;
  project_id: string | null;
  text: string;
  ai_text: string | null;
  created_at: string;
}

const toIdea = (r: IdeaRow): Idea => ({
  id: r.id,
  projectId: r.project_id,
  text: r.text,
  aiText: r.ai_text,
  createdAt: r.created_at,
});

/** Идеи из кнопки «+»: мысль и (опционально) ответ AI. Новые сверху. */
export function listIdeas(ctx: Ctx, projectId: string, limit = 50): Idea[] {
  return ctx.db
    .all<IdeaRow>(
      'SELECT * FROM ideas WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
      projectId,
      limit,
    )
    .map(toIdea);
}

export function createIdea(ctx: Ctx, projectId: string, input: CreateIdeaInput): Idea {
  getProjectRow(ctx, projectId);
  const id = ctx.newId();
  ctx.db.run(
    'INSERT INTO ideas (id, project_id, text, ai_text, created_at) VALUES (?, ?, ?, ?, ?)',
    id,
    projectId,
    input.text.trim(),
    input.aiText?.trim() || null,
    ctx.now(),
  );
  notify(ctx, { projectId, actor: 'you', kind: 'idea.added' });
  return toIdea(ctx.db.get<IdeaRow>('SELECT * FROM ideas WHERE id = ?', id)!);
}

export function deleteIdea(ctx: Ctx, id: string) {
  const r = ctx.db.get<IdeaRow>('SELECT * FROM ideas WHERE id = ?', id);
  if (!r) throw notFound('Идея');
  ctx.db.run('DELETE FROM ideas WHERE id = ?', id);
  notify(ctx, { projectId: r.project_id, actor: 'you', kind: 'idea.deleted' });
}
