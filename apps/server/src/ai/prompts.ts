/** Промпты AI-функций доски и разбор ответов. */

export function splitPrompt(task: { title: string; description: string; fields?: string[] }): string {
  return [
    'Разбей задачу канбан-доски на 3–5 сабтасок, каждую из которых может выполнить AI-агент за один заход.',
    `Задача: «${task.title}».`,
    task.description.trim() ? `Описание: ${task.description.trim()}` : '',
    ...(task.fields ?? []),
    'Верни только JSON-массив строк на русском, каждая строка до 70 символов, без пояснений.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Достать список сабтасок из ответа модели (JSON-массив, возможно в обёртке из текста). */
export function parseSubtasks(answer: string): string[] {
  const start = answer.indexOf('[');
  const end = answer.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const arr = JSON.parse(answer.slice(start, end + 1)) as unknown;
      if (Array.isArray(arr)) {
        const items = arr
          .map((x) => (typeof x === 'string' ? x : (x as { title?: unknown })?.title))
          .filter((x): x is string => typeof x === 'string' && !!x.trim())
          .map((x) => x.trim().slice(0, 200));
        if (items.length) return items.slice(0, 6);
      }
    } catch {
      /* ниже — разбор строками */
    }
  }
  // запасной путь: список строками «- …» / «1. …»
  return answer
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•—]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 2 && !l.startsWith('[') && !l.startsWith(']'))
    .slice(0, 6);
}

export function ideaPrompt(project: string, tasks: string[], text: string): string {
  return [
    `Ты помощник в простой AI-канбан-доске проекта «${project}». На доске задачи:`,
    tasks.length ? tasks.join('\n') : '(задач пока нет)',
    '',
    `Запрос или черновик мысли пользователя: «${text}».`,
    'Развей мысль в 2–4 коротких предложениях и предложи 2–3 конкретные задачи строками, начинающимися с «— ». Пиши по-русски, простым текстом без markdown.',
  ].join('\n');
}
