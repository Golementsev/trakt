import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

interface Props {
  value: string;
  /** Сохранить. Для черновика зовётся на каждое изменение (live), иначе — при уходе из поля. */
  onCommit: (v: string) => void;
  live?: boolean;
  multiline?: boolean;
  className?: string;
  id?: string;
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

/**
 * Поле с автосохранением. Пока в фокусе — держит свой текст (чужие обновления
 * с сервера не перетирают ввод), после ухода из поля снова показывает серверное значение.
 */
export function Editable({ value, onCommit, live, multiline, ...rest }: Props) {
  const [text, setText] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);

  const common = {
    ...rest,
    value: text,
    onFocus: () => {
      focused.current = true;
    },
    onChange: (e: { target: { value: string } }) => {
      setText(e.target.value);
      if (live) onCommit(e.target.value);
    },
    onBlur: () => {
      focused.current = false;
      if (!live && text !== value) onCommit(text);
    },
  };
  return multiline ? <textarea {...common} /> : <input {...common} />;
}
