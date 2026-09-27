import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

/** Запустить команду через оболочку (cmd на Windows, sh на остальных). */
export function spawnShell(command: string, cwd: string, env: Record<string, string>): ChildProcess {
  return spawn(command, {
    cwd,
    shell: true,
    env: { ...process.env, ...env },
    windowsHide: true,
    // на posix — своя группа процессов, чтобы «Стоп» убил и детей оболочки
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Убить процесс вместе с потомками (оболочка запускает агента дочерним процессом). */
export function killTree(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

/** Делит поток на строки, отдаёт полные строки в onLine. */
export function lineSplitter(onLine: (line: string) => void) {
  let buf = '';
  return {
    push(chunk: Buffer | string) {
      buf += chunk.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
      // защита от бесконечной строки без переводов
      if (buf.length > 64_000) {
        onLine(buf);
        buf = '';
      }
    },
    flush() {
      if (buf) onLine(buf);
      buf = '';
    },
  };
}
