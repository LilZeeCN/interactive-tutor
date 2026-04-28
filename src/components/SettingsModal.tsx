import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Settings, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/api';

const PROVIDERS = [
  { value: 'auto', label: '自动检测' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI 兼容' },
] as const;

const OPENAI_DOMAINS = [
  'bigmodel.cn', 'deepseek.com', 'openai.com', 'api.openai.com',
  'siliconflow.cn', 'moonshot.cn', 'zhipuai.cn', 'dashscope.aliyuncs.com',
  'qwenlm.ai', 'together.ai', 'groq.com', 'fireworks.ai',
  'minimax.chat', 'minimaxi.com', 'hailuoai.com',
  'stepfun.com', 'yiyan.baidu.com', 'api.lingyiwanwu.com',
];

const PRESET_PROVIDERS = [
  { label: '智谱 GLM', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', icon: '🟣' },
  { label: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', icon: '🔵' },
  { label: 'Kimi', url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', icon: '🌙' },
  { label: 'MiniMax', url: 'https://api.minimax.chat/v1', model: 'MiniMax-Text-01', icon: '🟡' },
  { label: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo', icon: '🟠' },
  { label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o', icon: '🟢' },
  { label: 'Anthropic', url: '', model: 'claude-sonnet-4-20250514', icon: '🟤' },
  { label: '硅基流动', url: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct', icon: '🔷' },
  { label: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', icon: '⚡' },
] as const;

function detectProvider(url: string): string {
  if (!url) return 'anthropic';
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (OPENAI_DOMAINS.some((d) => host === d || host.endsWith('.' + d))) return 'openai';
  } catch { /* ignore */ }
  return 'anthropic';
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [apiProvider, setApiProvider] = useState('auto');
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      apiFetch('/api/settings')
        .then((data: any) => {
          setApiProvider(data.api_provider || 'auto');
          setApiUrl(data.api_url || '');
          setApiKey('');
          setModel(data.model || '');
          setTestResult(null);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  const handleUrlChange = useCallback((url: string) => {
    setApiUrl(url);
    if (apiProvider === 'auto') {
      const detected = detectProvider(url);
      if (detected === 'openai') {
        // Auto-set model for known providers
        if (!model || model === 'claude-sonnet-4-20250514') {
          const preset = PRESET_PROVIDERS.find(p => p.url && url.includes(new URL(p.url).hostname));
          if (preset) setModel(preset.model);
        }
      }
    }
  }, [apiProvider, model]);

  const getEffectiveProvider = useCallback((): string => {
    if (apiProvider === 'auto') return detectProvider(apiUrl);
    return apiProvider;
  }, [apiProvider, apiUrl]);

  const placeholders = {
    apiUrl: getEffectiveProvider() === 'openai'
      ? '输入 API 地址，或点击下方快捷配置'
      : 'https://api.anthropic.com（留空使用默认）',
    apiKey: getEffectiveProvider() === 'openai'
      ? '输入 API Key'
      : 'sk-ant-...（输入新的 Key 覆盖已有配置）',
    model: getEffectiveProvider() === 'openai'
      ? '点击快捷配置自动填入，或手动输入模型名称'
      : 'claude-sonnet-4-20250514',
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = {
        api_url: apiUrl,
        api_provider: apiProvider,
        model,
      };
      if (apiKey) body.api_key = apiKey;

      const data: any = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (data.success) {
        setTestResult({ success: true, message: '设置已保存' });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err?.message || '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Save first if there's a new key or provider change
      if (apiKey || apiProvider !== 'auto') {
        await apiFetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey, api_url: apiUrl, model, api_provider: apiProvider }),
        });
      }

      const data: any = await apiFetch('/api/settings/test', { method: 'POST' });
      setTestResult({ success: data.success, message: data.success ? data.message : data.error });
    } catch (err: any) {
      setTestResult({ success: false, message: err?.message || '连接失败，请检查网络' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-bg-surface border border-white/10 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl"
          >
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/5 rounded-xl">
                  <Settings className="w-5 h-5 text-white/70" />
                </div>
                <h2 className="text-xl font-semibold">API 设置</h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white"
                aria-label="关闭设置"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <p className="text-sm text-white/50">
                配置 AI API。支持 Claude、GLM、DeepSeek、OpenAI 等服务。
              </p>

              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">API 提供商</label>
                <select
                  value={apiProvider}
                  onChange={(e) => setApiProvider(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all text-sm appearance-none cursor-pointer"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value} className="bg-bg-surface text-white">
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">快捷配置</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_PROVIDERS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        if (p.url) {
                          setApiUrl(p.url);
                          setApiProvider('openai');
                        } else {
                          setApiUrl('');
                          setApiProvider('anthropic');
                        }
                        if (!model || model === 'claude-sonnet-4-20250514' || model === 'glm-4-flash' || model === 'deepseek-chat') {
                          setModel(p.model);
                        }
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
                        apiUrl === p.url
                          ? 'bg-white/10 border-white/30 text-white'
                          : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {p.icon} {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">API URL</label>
                <input
                  type="text"
                  value={apiUrl}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder={placeholders.apiUrl}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={placeholders.apiKey}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">模型名称</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={placeholders.model}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all font-mono text-sm"
                />
              </div>

              {testResult && (
                <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm ${
                  testResult.success
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                }`}>
                  {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  {testResult.message}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing}
                  className="px-5 py-3 rounded-xl font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors flex items-center gap-2"
                >
                  {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  测试连接
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-3 rounded-xl bg-white text-black font-medium hover:bg-white/90 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.1)] flex items-center gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  保存设置
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
