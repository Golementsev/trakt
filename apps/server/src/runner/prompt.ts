import {
  getProjectRow,
  getStatusRow,
  getTaskRow,
  getTypeRow,
  listFields,
  listSubtasks,
  readFieldValues,
  taskKey,
  type Ctx,
} from '../domain';

const show = (v: unknown) => (v === true ? 'да' : v === null || v === undefined ? '' : String(v));

/**
 * Промпт для агента: задача, описание, поля «видно агенту», сабтаски, условие готовности
 * и как отчитываться через MCP. Имя агента передаётся явно — так доска узнаёт, что это
 * тот же агент, которого она запустила и за которым держит задачу.
 */
export function buildPrompt(
  ctx: Ctx,
  opts: { taskId: string; subtaskId: string | null; agentName: string; cwd: string },
): string {
  const t = getTaskRow(ctx, opts.taskId);
  const p = getProjectRow(ctx, t.project_id);
  const key = taskKey(ctx, t);
  const values = readFieldValues(ctx, t.id);
  const fields = listFields(ctx, t.type_id)
    .filter((f) => f.visibleToAgent && show(values[f.id]))
    .map((f) => `### ${f.name}\n${show(values[f.id])}`);
  const subtasks = listSubtasks(ctx, t.id);
  const current = subtasks.find((s) => s.id === opts.subtaskId);
  const agent = JSON.stringify(opts.agentName);

  const lines = [
    `Ты — агент на канбан-доске «Тракт». Задача ${key} «${t.title}» (проект «${p.name}», тип «${getTypeRow(ctx, t.type_id).name}», статус «${getStatusRow(ctx, t.status_id).name}»).`,
    `Рабочая папка: ${opts.cwd}`,
    '',
    '## Описание',
    t.description.trim() || '(нет)',
    ...(fields.length ? ['', ...fields] : []),
  ];

  if (subtasks.length) {
    lines.push(
      '',
      '## Сабтаски',
      ...subtasks.map(
        (s) =>
          `- [${s.done ? 'x' : ' '}] ${s.title}${s.id === opts.subtaskId ? '   ← твоя сабтаска' : ''} (id: ${s.id})`,
      ),
    );
  }

  lines.push('', '## Условие готовности', p.dod.trim() || '(не задано)', '');

  if (current) {
    lines.push(
      '## Что сделать сейчас',
      `Только сабтаску «${current.title}» (id: ${current.id}). Остальные сабтаски не трогай — их запустят отдельно.`,
      '',
      '## Как отчитываться',
      `У тебя есть MCP-сервер доски trakt. Во ВСЕХ вызовах передавай agent: ${agent}.`,
      `- log_progress(subtask: "${current.id}", text) — по ходу работы, коротко: что делаешь и что получилось.`,
      `- В конце complete_subtask(subtask: "${current.id}", report) с кратким отчётом (что изменено, ссылка на PR если есть).`,
      `- Если не получается — fail_subtask(subtask: "${current.id}", reason) и add_comment(task: "${key}", text) с вопросом человеку.`,
      '- Задачу по статусам не двигай: после последней сабтаски доска переведёт её сама.',
    );
  } else {
    lines.push(
      '## Что сделать',
      'Задачу целиком' +
        (subtasks.length
          ? ', по открытым сабтаскам по порядку.'
          : '. Если она большая — разбей её через add_subtask.'),
      '',
      '## Как отчитываться',
      `У тебя есть MCP-сервер доски trakt. Во ВСЕХ вызовах передавай agent: ${agent}.`,
      '- Для каждой сабтаски: start_subtask → работа → log_progress по ходу → complete_subtask с отчётом.',
      `- Когда условие готовности выполнено — move_task(task: "${key}", status, note) в следующий разрешённый статус.`,
      `- Если нужен человек — add_comment(task: "${key}", text) с вопросом.`,
    );
  }
  return lines.join('\n');
}
