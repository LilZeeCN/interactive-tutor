import { useRef, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { getAuthToken } from '../lib/api';

export function useTerminal(sessionPrefix: string, cwd?: string) {
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const retryCountRef = useRef(0);
  const generationRef = useRef(0);
  const maxRetries = 5;

  const cleanup = () => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    retryCountRef.current = 0;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      wsRef.current.close();
    }
    wsRef.current = null;
    termRef.current?.dispose();
    termRef.current = null;
  };

  const connectWs = useCallback((term: XTerm, token: string, authToken: string, sessionId: string, isCurrentGen: () => boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const baseParams = `token=${token}&auth=${encodeURIComponent(authToken)}&sessionId=${sessionId}`;
    const wsUrl = cwd
      ? `${wsProto}//${window.location.host}/ws/terminal?${baseParams}&cwd=${encodeURIComponent(cwd)}`
      : `${wsProto}//${window.location.host}/ws/terminal?${baseParams}`;
    const ws = new WebSocket(wsUrl);

    wsRef.current = ws;

    ws.onopen = () => {
      if (!isCurrentGen()) return;
      retryCountRef.current = 0;
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      term.write('\x1b[38;2;100;255;218m● Connected\x1b[0m\r\n');
    };
    ws.onmessage = (e) => {
      if (!isCurrentGen()) return;
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'output') term.write(msg.data);
        if (msg.type === 'exit') term.write('\r\n\x1b[38;2;255;100;100m[Terminal closed]\x1b[0m\r\n');
      } catch {}
    };
    ws.onerror = () => {
      if (!isCurrentGen()) return;
      term.write('\r\n\x1b[38;2;255;100;100m● WebSocket error \u2014 terminal unavailable\x1b[0m\r\n');
    };
    ws.onclose = (e) => {
      if (!isCurrentGen()) return;
      wsRef.current = null;

      // Don't reconnect on auth failure
      if (e.code === 4001) {
        term.write('\r\n\x1b[38;2;255;100;100m● Authentication failed\x1b[0m\r\n');
        return;
      }

      // Attempt reconnection with exponential backoff
      if (retryCountRef.current < maxRetries) {
        retryCountRef.current += 1;
        const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 8000);
        term.write(`\r\n\x1b[38;2;255;200;50m● Connection lost, reconnecting in ${delay / 1000}s (attempt ${retryCountRef.current}/${maxRetries})...\x1b[0m\r\n`);
        setTimeout(() => {
          if (!isCurrentGen()) return;
          connectWs(term, token, authToken, sessionId, isCurrentGen);
        }, delay);
      } else {
        term.write('\r\n\x1b[38;2;255;100;100m● Reconnection failed. Please refresh the page.\x1b[0m\r\n');
      }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    });
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    });
  }, [sessionPrefix, cwd]);

  const terminalRef = useCallback((node: HTMLDivElement | null) => {
    cleanup();
    if (!node) return;

    // Bump generation — only this generation's async work should proceed
    generationRef.current += 1;
    const myGen = generationRef.current;
    const isCurrentGen = () => generationRef.current === myGen;

    const term = new XTerm({
      theme: { background: '#050505', foreground: '#ededed', cursor: '#ededed', cursorAccent: '#050505', selectionBackground: 'rgba(255,255,255,0.2)' },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(node);

    requestAnimationFrame(() => { try { fitAddon.fit(); } catch {} });
    term.write('\x1b[38;2;100;255;218m● Terminal ready\x1b[0m\r\n');

    termRef.current = term;

    (async () => {
      let token = '';
      let authToken = '';
      try {
        authToken = await getAuthToken();
        if (!isCurrentGen()) return;

        const termRes = await fetch('/api/terminal-token', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!isCurrentGen()) return;

        const termData = await termRes.json();
        token = termData.token || '';
      } catch {
        if (!isCurrentGen()) return;
        term.write('\r\n\x1b[38;2;255;100;100m● Failed to get terminal token\x1b[0m\r\n');
        return;
      }

      if (!isCurrentGen()) return;

      const sessionId = `${sessionPrefix}-${Date.now()}`;
      connectWs(term, token, authToken, sessionId, isCurrentGen);
    })();

    const observer = new ResizeObserver(() => { try { fitAddon.fit(); } catch {} });
    observer.observe(node);
    observerRef.current = observer;
  }, [sessionPrefix, cwd, connectWs]);

  const writeToTerminal = (cmd: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data: cmd + '\n' }));
    }
  };

  return { terminalRef, writeToTerminal };
}
