interface Props {
  agent?: boolean;
  small?: boolean;
  /** Подпись агента из ленты; для человека — «Вы». */
  name?: string;
}

export function Avatar({ agent, small, name }: Props) {
  const title = name ?? (agent ? 'Агент' : 'Вы');
  const cls = ['av', agent && 'ag', small && 'sm'].filter(Boolean).join(' ');
  return (
    <span className={cls} title={title}>
      {agent ? 'AI' : 'ВЫ'}
    </span>
  );
}
