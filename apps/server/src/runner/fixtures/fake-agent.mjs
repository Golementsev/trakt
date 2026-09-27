// Поддельный агент для тестов раннера: читает промпт из stdin, печатает прогресс и выходит.
// Аргументы: exit=<код> sleep=<мс> json (печатать в формате claude stream-json)
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a) => a.split('='))
    .map(([k, v]) => [k, v ?? true]),
);
let prompt = '';
process.stdin.on('data', (c) => (prompt += c));
process.stdin.on('end', async () => {
  const firstLine = prompt.split('\n')[0];
  if (args.json) {
    console.log(JSON.stringify({ type: 'system', subtype: 'init' }));
    console.log(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Читаю задачу' }] } }),
    );
    console.log(JSON.stringify({ type: 'result', result: `Сделал ${process.env.TRAKT_TASK}` }));
  } else {
    console.log(`task=${process.env.TRAKT_TASK} agent=${process.env.TRAKT_AGENT}`);
    console.log(firstLine.slice(0, 60));
    console.error('warn: stderr тоже в лог');
  }
  if (args.sleep) await new Promise((r) => setTimeout(r, Number(args.sleep)));
  process.exit(Number(args.exit ?? 0));
});
