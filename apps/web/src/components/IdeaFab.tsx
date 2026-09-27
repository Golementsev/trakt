import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { generateIdea } from '../api/generate';
import { queryClient } from '../api/queries';
import { run, toast } from '../lib/toast';

const CHIPS: Array<[string, string]> = [
  ['Идея фичи', 'Предложи идею новой фичи для этого проекта'],
  ['Что отдать агенту', 'Какие задачи с доски можно целиком отдать агенту и почему?'],
  ['Риски', 'Назови главные риски по текущим задачам на доске'],
];

interface Props {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** «Сделать задачей»: открыть черновик. */
  onToTask: (title: string, description: string) => void;
}

/** Кнопка «+» справа снизу: мысль, генерация с AI, идеи, «Сделать задачей» (как в макете). */
export function IdeaFab({ projectId, projectName, open, onOpenChange, onToTask }: Props) {
  const [text, setText] = useState('');
  const [out, setOut] = useState<{ text: string; think?: boolean } | null>(null);
  const [aiText, setAiText] = useState('');
  const abort = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);

  const ideas = useQuery({
    queryKey: ['ideas', projectId],
    queryFn: () => api.ideas(projectId),
    enabled: open,
  });
  const refreshIdeas = () => void queryClient.invalidateQueries({ queryKey: ['ideas', projectId] });

  const reset = () => {
    setText('');
    setOut(null);
    setAiText('');
  };

  const generate = async (prompt?: string) => {
    const q = (prompt ?? text).trim() || 'Предложи идею новой фичи для этого проекта';
    if (prompt) setText(prompt);
    setOut({ text: 'Думаю…', think: true });
    setAiText('');
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    try {
      const full = await generateIdea(projectId, q, {
        signal: ctrl.signal,
        onText: (t) => {
          setAiText(t);
          setOut({ text: t });
        },
      });
      if (!full) setOut({ text: 'Пустой ответ. Попробуйте переформулировать.' });
    } catch (e) {
      // «Стоп» — оставляем то, что успело прийти
      if (ctrl.signal.aborted) setOut((o) => (o && !o.think ? o : { text: 'Остановлено' }));
      else {
        setAiText('');
        setOut({ text: e instanceof Error ? e.message : 'Не получилось сгенерировать. Попробуйте ещё раз.' });
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const currentAi = aiText;

  const save = async () => {
    const t = text.trim();
    if (!t && !currentAi) return;
    const idea = await run(api.createIdea(projectId, t || currentAi.slice(0, 120), currentAi || null));
    if (!idea) return;
    reset();
    refreshIdeas();
    toast('Сохранено в идеи');
  };

  const toTask = () => {
    const t = text.trim() || currentAi;
    if (!t) return;
    onToTask((t.split('\n')[0] ?? 'Идея').slice(0, 90), currentAi || t);
    onOpenChange(false);
    reset();
  };

  return (
    <>
      {open && (
        <div className="idea">
          <div className="ih">
            <b>Мысль или идея</b>
            <span className="spacer" />
            <span className="lbl">Контекст: {projectName}</span>
          </div>
          <div className="ib">
            <textarea
              className="in"
              rows={3}
              autoFocus
              placeholder="Запишите мысль или попросите AI что-то придумать…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="chips">
              {CHIPS.map(([label, prompt]) => (
                <button key={label} onClick={() => void generate(prompt)} disabled={busy}>
                  {label}
                </button>
              ))}
            </div>
            {out && <div className={`aiout ${out.think ? 'think' : ''}`}>{out.text}</div>}
            <div className="iact">
              <button className="btn agent" disabled={busy} onClick={() => void generate()}>
                ✦ Сгенерировать с AI
              </button>
              <button className="btn" onClick={() => void save()}>
                В идеи
              </button>
              <button className="btn" onClick={toTask}>
                Сделать задачей
              </button>
              {busy && (
                <button className="btn" onClick={() => abort.current?.abort()}>
                  Стоп
                </button>
              )}
            </div>
            {!!ideas.data?.length && (
              <div className="ideas">
                <span className="lbl">Сохранённые идеи</span>
                {ideas.data.slice(0, 6).map((idea) => (
                  <div className="it" key={idea.id}>
                    <span>{idea.text}</span>
                    <button
                      className="btn sm"
                      onClick={async () => {
                        onToTask(idea.text.split('\n')[0]!.slice(0, 90), idea.aiText || idea.text);
                        onOpenChange(false);
                        await run(api.deleteIdea(idea.id));
                        refreshIdeas();
                      }}
                    >
                      → задача
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <button
        className={`fab ${open ? 'open' : ''}`}
        aria-label="Новая мысль или идея"
        onClick={() => onOpenChange(!open)}
      >
        +
      </button>
    </>
  );
}
