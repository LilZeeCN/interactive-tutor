import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, Loader2, Sparkles, Terminal, ChevronDown, ChevronUp } from 'lucide-react';
import { apiFetch, authFetchInit } from '../lib/api';

interface RuntimeInfo {
  name: string;
  installed: boolean;
  version: string | null;
  path: string | null;
}

interface EnvironmentStatusProps {
  courseId: string;
}

const KEY_RUNTIMES = ['python3', 'node', 'java', 'go', 'rustc', 'conda', 'docker'];

export function EnvironmentStatus({ courseId }: EnvironmentStatusProps) {
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [setupInfo, setSetupInfo] = useState<{ commands: string[]; description: string } | null>(null);
  const [aiSetup, setAiSetup] = useState<{ description: string; commands: string[]; notes: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const loadEnvironment = useCallback(() => {
    apiFetch(`/api/courses/${courseId}/environment`)
      .then((data: any) => {
        setRuntimes(data.runtimes || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [courseId]);

  useEffect(() => { loadEnvironment(); }, [loadEnvironment]);

  const keyRuntimes = runtimes.filter(r => KEY_RUNTIMES.includes(r.name));
  const otherRuntimes = runtimes.filter(r => !KEY_RUNTIMES.includes(r.name));
  const installedCount = runtimes.filter(r => r.installed).length;

  const handleSetup = (runtime: string) => {
    apiFetch(`/api/courses/${courseId}/environment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runtime }),
    })
      .then((data: any) => setSetupInfo(data));
  };

  const handleAiSetup = async () => {
    setAiLoading(true);
    try {
      const authInit = await authFetchInit();
      const res = await fetch(`/api/courses/${courseId}/environment/setup`, {
        method: 'POST',
        headers: authInit.headers,
        body: JSON.stringify({ description: '配置实验开发环境' }),
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'done') {
              setAiSetup({ description: data.description, commands: data.commands, notes: data.notes });
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    setAiLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-white/40">
        <Loader2 className="w-3 h-3 animate-spin" />
        检测环境中...
      </div>
    );
  }

  return (
    <div className="border border-white/10 rounded-xl bg-bg-surface overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-white/50" />
          <span className="text-xs font-medium text-white/70">环境检测</span>
          <span className="text-xs text-white/30">{installedCount}/{runtimes.length} 已安装</span>
        </div>
        <div className="flex items-center gap-2">
          {expanded && (
            <button
              onClick={(e) => { e.stopPropagation(); handleAiSetup(); }}
              disabled={aiLoading}
              className="flex items-center gap-1 px-2 py-1 text-[10px] bg-indigo-500/20 text-indigo-300 rounded border border-indigo-500/30 disabled:opacity-50"
            >
              {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              AI 配置
            </button>
          )}
          {expanded ? <ChevronUp className="w-3 h-3 text-white/30" /> : <ChevronDown className="w-3 h-3 text-white/30" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/10 px-4 py-3 space-y-3">
          {/* AI Setup result */}
          {aiSetup && (
            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3 space-y-2">
              <p className="text-xs text-indigo-300 font-medium">{aiSetup.description}</p>
              <div className="space-y-1">
                {aiSetup.commands.map((cmd, i) => (
                  <code key={i} className="block text-[10px] text-white/60 bg-black/30 px-2 py-1 rounded font-mono">{cmd}</code>
                ))}
              </div>
              {aiSetup.notes && <p className="text-[10px] text-white/40">{aiSetup.notes}</p>}
            </div>
          )}

          {/* Key runtimes */}
          <div>
            <p className="text-[10px] text-white/30 mb-1.5 font-medium uppercase tracking-wider">常用运行时</p>
            <div className="grid grid-cols-1 gap-1">
              {keyRuntimes.map(r => (
                <div key={r.name} className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2">
                    {r.installed ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <XCircle className="w-3 h-3 text-red-400/50" />
                    )}
                    <span className="text-xs text-white/70">{r.name}</span>
                    {r.version && <span className="text-[10px] text-white/30">{r.version.split(' ').slice(0, 2).join(' ')}</span>}
                  </div>
                  {!r.installed && (
                    <button
                      onClick={() => handleSetup(r.name)}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300"
                    >配置</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Other runtimes */}
          {otherRuntimes.length > 0 && (
            <div>
              <p className="text-[10px] text-white/30 mb-1.5 font-medium uppercase tracking-wider">其他工具</p>
              <div className="grid grid-cols-2 gap-1">
                {otherRuntimes.map(r => (
                  <div key={r.name} className="flex items-center gap-1.5 py-0.5">
                    {r.installed ? (
                      <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400/60" />
                    ) : (
                      <XCircle className="w-2.5 h-2.5 text-white/10" />
                    )}
                    <span className="text-[10px] text-white/40">{r.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Setup commands */}
          {setupInfo && (
            <div className="bg-white/5 rounded-lg p-3 space-y-1.5">
              <p className="text-xs text-white/50">{setupInfo.description}</p>
              {setupInfo.commands.map((cmd, i) => (
                <code key={i} className="block text-[10px] text-white/60 bg-black/30 px-2 py-1 rounded font-mono">{cmd}</code>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
