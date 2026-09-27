import { splitTaskKeys } from '../lib/format';

/** Текст события с выделенными номерами задач. */
export function EventText({ text }: { text: string }) {
  return (
    <>
      {splitTaskKeys(text).map((p, i) => (p.key ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}
    </>
  );
}
