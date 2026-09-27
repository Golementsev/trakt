import type { Ctx } from './context';
import { record } from './events';
import { createProject } from './projects';
import { listStatuses } from './statuses';
import { listTypes } from './taskTypes';
import { createTask, getTaskRow } from './tasks';

/** [номер, название, тип 0..3, статус 0..4, ведёт агент, сабтаски [название, готово], описание, поля по индексу] */
type DemoTask = [
  number,
  string,
  number,
  number,
  boolean,
  Array<[string, boolean?]>,
  string?,
  Record<number, string>?,
];

const DEMO: Array<{ name: string; key: string; tasks: DemoTask[] }> = [
  {
    name: 'Checkout 2.0',
    key: 'PAY',
    tasks: [
      [
        12,
        'Токенизация карты через новый SDK эквайера',
        0,
        2,
        true,
        [
          ['Обновить SDK до 4.2', true],
          ['Заменить вызовы tokenize() в CardForm'],
          ['Юнит-тесты на ошибки 3DS'],
          ['Проверить на стейдже с тестовой картой'],
        ],
        'Переходим на токены эквайера, чтобы не хранить номер карты. Старый метод оставить за флагом до конца месяца.',
        { 0: 'Карта сохраняется только как токен.\n3DS проходит в Chrome, Safari и Firefox.' },
      ],
      [
        14,
        'Кнопка Apple Pay на шаге доставки',
        0,
        1,
        false,
        [['Сверстать кнопку по гайдлайну'], ['Проверить домен в Apple Developer']],
        '',
        { 0: 'Кнопка видна только на устройствах с Apple Pay' },
      ],
      [
        15,
        'Двойное списание при повторном нажатии «Оплатить»',
        1,
        3,
        true,
        [['Воспроизвести на стейдже', true], ['Идемпотентный ключ на запрос', true], ['Ревью PR #481']],
        'Пользователь быстро жмёт кнопку дважды, приходят два списания.',
        { 0: '1. Корзина больше 1000 ₽\n2. Двойной клик по «Оплатить»', 1: 'prod, iOS Safari' },
      ],
      [
        17,
        'Сравнить комиссии трёх эквайеров для возвратов',
        2,
        2,
        true,
        [['Собрать тарифы', true], ['Свести в таблицу'], ['Рекомендация с рисками']],
        '',
        { 0: 'Какой эквайер дешевле при 8% возвратов?' },
      ],
      [18, 'Частичный возврат из админки', 0, 0, false, []],
      [
        19,
        'Удалить старый PaymentGatewayV1',
        3,
        0,
        true,
        [['Найти все вызовы'], ['Удалить модуль и фичефлаг']],
      ],
      [20, 'Apple Pay не показывается в Chrome на macOS', 1, 1, true, [['Проверить canMakePayments()']]],
      [21, 'Логи платёжного шлюза в единый формат', 3, 3, true, [['Схема логов', true], ['Ревью']]],
      [
        9,
        'Сохранённые карты в профиле',
        0,
        4,
        false,
        [
          ['Экран списка карт', true],
          ['Удаление карты', true],
        ],
      ],
      [11, 'Таймаут 3DS на медленной сети', 1, 4, true, [['Увеличить таймаут и добавить ретрай', true]]],
      [
        22,
        'Уведомление клиенту о статусе возврата',
        0,
        1,
        false,
        [['Шаблон письма'], ['Событие refund.updated']],
      ],
    ],
  },
  {
    name: 'Мобильное приложение',
    key: 'MOB',
    tasks: [
      [3, 'Новый онбординг из трёх экранов', 0, 2, false, [['Макеты экранов', true], ['Анимации переходов']]],
      [4, 'Краш при смене аватара на Android 12', 1, 1, true, [['Собрать стектрейсы из Sentry']]],
      [5, 'Почему уходят на втором экране', 2, 0, false, []],
      [6, 'Тёмная тема в профиле', 0, 3, true, [['Ревью PR #88']]],
    ],
  },
  {
    name: 'Внутренние инструменты',
    key: 'OPS',
    tasks: [
      [
        1,
        'Ускорить CI: кеш зависимостей',
        3,
        2,
        true,
        [['Замерить текущее время сборки', true], ['Включить кеш']],
      ],
      [2, 'Алерт на рост 5xx на чекауте', 0, 1, false, []],
    ],
  },
];

/** Заполнить пустую базу демо-проектами из макета. Возвращает false, если проекты уже есть. */
export function seedDemo(ctx: Ctx): boolean {
  if (ctx.db.get('SELECT 1 FROM projects LIMIT 1')) return false;
  ctx.db.tx(() => {
    for (const demo of DEMO) {
      const p = createProject(ctx, { name: demo.name, key: demo.key });
      const statuses = listStatuses(ctx, p.id);
      const types = listTypes(ctx, p.id);
      for (const [number, title, ti, si, agent, subs, description, fieldsByIndex] of demo.tasks) {
        const type = types[ti]!;
        const fields: Record<string, string> = {};
        for (const [i, v] of Object.entries(fieldsByIndex ?? {})) fields[type.fields[Number(i)]!.id] = v;
        const t = createTask(
          ctx,
          p.id,
          {
            title,
            typeId: type.id,
            statusId: statuses[si]!.id,
            description: description ?? '',
            fields,
            subtasks: subs.map(([s]) => s),
            agentOwned: agent,
          },
          'you',
          { skipRequired: true, number },
        );
        subs.forEach(([, done], i) => {
          if (done)
            ctx.db.run(
              "UPDATE subtasks SET done = 1, state = 'done' WHERE task_id = ? AND position = ?",
              t.id,
              i,
            );
        });
      }
    }
    // база была пустой: служебные «создали/отдали» от сида в ленте не нужны,
    // оставляем только пару событий агента, как в макете
    ctx.db.run('DELETE FROM events');
    const pay = ctx.db.get<{ id: string }>("SELECT id FROM projects WHERE key = 'PAY'")!;
    const task = (n: number) =>
      getTaskRow(
        ctx,
        ctx.db.get<{ id: string }>('SELECT id FROM tasks WHERE project_id = ? AND number = ?', pay.id, n)!.id,
      );
    record(ctx, {
      projectId: pay.id,
      taskId: task(12).id,
      actor: 'Агент',
      kind: 'subtask.done',
      summary: 'закрыл сабтаску в PAY-12',
      note: 'Обновить SDK до 4.2',
    });
    record(ctx, {
      projectId: pay.id,
      taskId: task(15).id,
      actor: 'Агент',
      kind: 'task.moved',
      summary: 'перевёл PAY-15 «В работе» → «Ревью»',
      note: 'Идемпотентный ключ добавлен, PR #481 открыт',
    });
  });
  return true;
}
