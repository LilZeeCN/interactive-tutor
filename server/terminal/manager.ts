import * as pty from 'node-pty';
import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';

// Only pass safe env vars to PTY to avoid leaking secrets
const SAFE_ENV_PREFIXES = ['HOME', 'PATH', 'LANG', 'TERM', 'SHELL', 'USER', 'LOGNAME', 'EDITOR', 'PAGER', 'LC_', 'XDG_', 'COLORTERM', 'NODE', 'NVM_', 'PNPM_HOME', 'GOPATH', 'CARGO_HOME', 'RUSTUP_HOME', 'PYTHONPATH', 'JAVA_HOME'];

function filterEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const safe: Record<string, string> = { TERM: 'xterm-256color' };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (SAFE_ENV_PREFIXES.some(prefix => key === prefix || key.startsWith(prefix))) {
      safe[key] = value;
    }
  }
  return safe;
}

interface TerminalSession {
  pty: pty.IPty | null;
  fallback: ChildProcess | null;
  ws: WebSocket;
}

export class TerminalManager {
  private sessions: Map<string, TerminalSession> = new Map();
  private static MAX_SESSIONS = 10;

  create(sessionId: string, ws: WebSocket, cwd?: string): void {
    if (this.sessions.size >= TerminalManager.MAX_SESSIONS && !this.sessions.has(sessionId)) {
      ws.send(JSON.stringify({ type: 'output', data: '\r\n\x1b[31mToo many terminal sessions. Close an existing session first.\x1b[0m\r\n' }));
      ws.close(4002, 'Max sessions reached');
      return;
    }
    this.destroy(sessionId);

    try {
      const shell = process.env.SHELL || '/bin/zsh';
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: cwd || process.cwd(),
        env: filterEnv(process.env),
      });

      ptyProcess.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data }));
        }
      });

      ptyProcess.onExit(({ exitCode }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'exit', exitCode }));
        }
        this.sessions.delete(sessionId);
      });

      this.sessions.set(sessionId, { pty: ptyProcess, fallback: null, ws });
    } catch {
      // node-pty failed — use child_process fallback
      console.log('node-pty unavailable, using child_process fallback for terminal');
      this.createFallback(sessionId, ws, cwd);
    }
  }

  private createFallback(sessionId: string, ws: WebSocket, cwd?: string): void {
    const shell = process.env.SHELL || '/bin/zsh';

    const child = spawn(shell, ['--login'], {
      cwd: cwd || process.cwd(),
      env: filterEnv(process.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Send welcome message
    const welcome = [
      '\x1b[38;2;100;255;218m● Fallback terminal (no pseudo-TTY)\x1b[0m\r\n',
      '\x1b[90mnode-pty unavailable on this system.\r\n',
      'Basic command execution works. Advanced features (tab completion, signals) may be limited.\x1b[0m\r\n\r\n',
    ].join('');
    ws.send(JSON.stringify({ type: 'output', data: welcome }));

    // Send prompt
    this.sendPrompt(child, ws);

    child.stdout.on('data', (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'output',
          data: `\x1b[31m${data.toString()}\x1b[0m`,
        }));
      }
    });

    child.on('exit', (code) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', exitCode: code ?? 1 }));
      }
      this.sessions.delete(sessionId);
    });

    const session: TerminalSession = { pty: null, fallback: child, ws };

    this.sessions.set(sessionId, session);
  }

  private sendPrompt(child: ChildProcess, ws: WebSocket): void {
    const cwd = child.spawnfile;
    const prompt = `\x1b[38;2;100;200;255m$\x1b[0m `;
    ws.send(JSON.stringify({ type: 'output', data: prompt }));
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.pty) {
      session.pty.write(data);
    } else if (session.fallback && session.fallback.stdin) {
      // For fallback: collect characters until Enter, then execute
      if (data === '\r' || data === '\n') {
        session.fallback.stdin.write('\n');
      } else if (data === '\x7f' || data === '\b') {
        // Backspace: we can't really handle this properly without a pty,
        // just pass it through
        session.fallback.stdin.write(data);
      } else if (data === '\x03') {
        // Ctrl+C: send SIGINT
        session.fallback.kill('SIGINT');
        // Send a new prompt after a short delay
        setTimeout(() => this.sendPrompt(session.fallback!, session.ws), 100);
      } else if (data === '\x04') {
        // Ctrl+D: send EOF
        session.fallback.stdin.end();
      } else {
        session.fallback.stdin.write(data);
      }
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session?.pty) {
      try {
        session.pty.resize(cols, rows);
      } catch {
        // ignore resize errors
      }
    }
    // No resize support for child_process fallback
  }

  destroy(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        session.pty?.kill();
        session.fallback?.kill();
      } catch {
        // ignore
      }
      this.sessions.delete(sessionId);
    }
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroy(id);
    }
  }
}
