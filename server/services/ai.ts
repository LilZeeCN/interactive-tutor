import { Anthropic } from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { decrypt } from './crypto.js';
import { getDb } from '../db.js';
import { dbAll } from '../db-types.js';
import { estimateTokens, truncateMessages } from './tokens.js';
import { CHAT_PER_MESSAGE_CAP, CHAT_MIN_HISTORY } from './tokenBudgets.js';

export type ApiProvider = 'anthropic' | 'openai';

// Domestic API hosts that should bypass any system HTTP proxy
const DOMESTIC_HOSTS = [
  'bigmodel.cn', 'zhipuai.cn', 'deepseek.com',
  'moonshot.cn', 'siliconflow.cn', 'dashscope.aliyuncs.com',
  'qwenlm.ai', 'aliyuncs.com', 'minimax.chat', 'minimaxi.com',
  'hailuoai.com', 'stepfun.com', 'yiyan.baidu.com', 'api.lingyiwanwu.com',
];

function isDomesticUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return DOMESTIC_HOSTS.some(d => host === d || host.endsWith('.' + d));
  } catch { return false; }
}

let cachedAnthropicClient: Anthropic | null = null;
let cachedOpenAIClient: OpenAI | null = null;
let cachedSettings: { api_url: string; api_key: string; model: string; api_provider: ApiProvider } | null = null;

// Known OpenAI-compatible API domains for auto-detection
const OPENAI_DOMAINS = [
  'bigmodel.cn', 'zhipuai.cn', 'deepseek.com', 'openai.com', 'api.openai.com',
  'siliconflow.cn', 'moonshot.cn', 'dashscope.aliyuncs.com',
  'qwenlm.ai', 'together.ai', 'groq.com', 'fireworks.ai',
  'minimax.chat', 'minimaxi.com', 'hailuoai.com',
  'stepfun.com', 'yiyan.baidu.com', 'api.lingyiwanwu.com',
];

export function detectProvider(apiUrl: string, explicitProvider?: string): ApiProvider {
  if (explicitProvider && explicitProvider !== 'auto') return explicitProvider as ApiProvider;
  try {
    const host = new URL(apiUrl).hostname.toLowerCase();
    if (OPENAI_DOMAINS.some((d) => host === d || host.endsWith('.' + d))) return 'openai';
  } catch { /* ignore */ }
  return 'anthropic';
}

function getAISettings(): { api_url: string; api_key: string; model: string; api_provider: ApiProvider } {
  const rows = dbAll<{ key: string; value: string }>('SELECT key, value FROM settings');

  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  let apiKey = '';
  try {
    apiKey = settings.api_key ? decrypt(settings.api_key) : '';
  } catch (e) {
    const db = getDb();
    const stored = db.prepare("SELECT value FROM settings WHERE key = 'api_key'").get() as { value: string } | undefined;
    console.error(`[ai] API Key decrypt failed. stored value prefix: ${(stored?.value || '').slice(0, 30)}, error: ${(e as Error).message}`);
    cachedAnthropicClient = null;
    cachedOpenAIClient = null;
    cachedSettings = null;
    throw new Error('API Key 解密失败，请重新在设置中保存 API Key');
  }

  const apiProvider = detectProvider(settings.api_url || '', settings.api_provider);

  return {
    api_url: settings.api_url || '',
    api_key: apiKey,
    model: settings.model || '',
    api_provider: apiProvider,
  };
}

let lastSettingsFetch: { settings: ReturnType<typeof getAISettings>; timestamp: number } | null = null;

function getCachedAISettings(): ReturnType<typeof getAISettings> {
  const now = Date.now();
  if (lastSettingsFetch && now - lastSettingsFetch.timestamp < 5000) {
    return lastSettingsFetch.settings;
  }
  const settings = getAISettings();
  lastSettingsFetch = { settings, timestamp: now };
  return settings;
}

function getAnthropicClient(): Anthropic {
  const settings = getCachedAISettings();

  if (cachedAnthropicClient && cachedSettings &&
    cachedSettings.api_url === settings.api_url &&
    cachedSettings.api_key === settings.api_key &&
    cachedSettings.api_provider === settings.api_provider) {
    return cachedAnthropicClient;
  }

  if (!settings.api_key) {
    throw new Error('请先在设置中配置 API Key');
  }

  cachedAnthropicClient = new Anthropic({
    apiKey: settings.api_key,
    baseURL: settings.api_url || undefined,
  });
  cachedSettings = settings;

  return cachedAnthropicClient;
}

function getOpenAIClient(): OpenAI {
  const settings = getCachedAISettings();

  if (cachedOpenAIClient && cachedSettings &&
    cachedSettings.api_url === settings.api_url &&
    cachedSettings.api_key === settings.api_key &&
    cachedSettings.api_provider === settings.api_provider) {
    return cachedOpenAIClient;
  }

  if (!settings.api_key) {
    throw new Error('请先在设置中配置 API Key');
  }

  // For domestic URLs, temporarily clear proxy env to prevent hangs.
  // Save and restore to avoid affecting concurrent requests.
  let savedProxy: Map<string, string | undefined> | undefined;
  if (settings.api_url && isDomesticUrl(settings.api_url)) {
    const proxyVars = ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY'];
    savedProxy = new Map();
    for (const v of proxyVars) {
      savedProxy.set(v, process.env[v]);
      delete process.env[v];
    }
  }

  try {
    // Normalize: strip trailing slash to avoid double-slash in path
    const baseURL = settings.api_url ? settings.api_url.replace(/\/+$/, '') : undefined;
    cachedOpenAIClient = new OpenAI({
      apiKey: settings.api_key,
      baseURL,
    });
  } finally {
    if (savedProxy) {
      for (const [k, val] of savedProxy) {
        if (val !== undefined) process.env[k] = val;
        else delete process.env[k];
      }
    }
  }
  cachedSettings = settings;

  return cachedOpenAIClient;
}

function getModel(): string {
  const settings = getCachedAISettings();
  if (settings.model) return settings.model;
  return settings.api_provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-20250514';
}

function isContextLengthError(err: any): boolean {
  const msg = (err?.message || '').toLowerCase();
  return (
    msg.includes('context_length_exceeded') ||
    msg.includes('context window') ||
    msg.includes('too many tokens') ||
    msg.includes('reduce the length') ||
    msg.includes('maximum context length') ||
    msg.includes('token limit') ||
    msg.includes('max_length') ||
    msg.includes('maximum number of tokens')
  );
}

export interface ChatParams {
  systemPrompt: string;
  messages: { role: string; content: string }[];
  topicTitle?: string;
}

/**
 * Stream chat using official SDK streaming APIs.
 * Supports both Anthropic and OpenAI-compatible APIs.
 */
export async function sendChatMessage(
  params: ChatParams,
  onChunk: (text: string, kind?: 'reasoning' | 'content') => void,
  onDone: (fullText: string) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  const settings = getCachedAISettings();
  if (!settings.api_key) throw new Error('请先在设置中配置 API Key');

  const model = getModel();
  const provider = settings.api_provider;
  let messages = params.messages;

  console.log('[ai] sendChatMessage provider:', provider, 'model:', model, 'api_url:', settings.api_url);

  try {
    const fullText = provider === 'openai'
      ? await streamOpenAI(settings, model, params, messages, onChunk, abortSignal)
      : await streamAnthropic(settings, model, params, messages, onChunk, abortSignal);

    if (!abortSignal?.aborted) {
      onDone(fullText);
    }
  } catch (err: any) {
    if (isContextLengthError(err) && messages.length > 2) {
      console.log('[ai] Context length exceeded, truncating and retrying...');
      const systemTokens = estimateTokens(params.systemPrompt);
      const currentTokens = estimateTokens(messages.map((m) => m.content).join(''));
      const newBudget = Math.max(CHAT_MIN_HISTORY, Math.floor((systemTokens + currentTokens) / 2) - systemTokens);
      messages = truncateMessages(messages, newBudget, CHAT_PER_MESSAGE_CAP);
      if (messages.length === 0) messages = params.messages.slice(-1);

      // Retry streaming with truncated history instead of falling back to single-message generateText
      const fullText = provider === 'openai'
        ? await streamOpenAI(settings, model, params, messages, onChunk, abortSignal)
        : await streamAnthropic(settings, model, params, messages, onChunk, abortSignal);
      if (!abortSignal?.aborted) {
        onDone(fullText);
      }
    } else {
      throw err;
    }
  }
}

/** Stream using OpenAI SDK (works with any OpenAI-compatible API) */
async function streamOpenAI(
  settings: ReturnType<typeof getCachedAISettings>,
  model: string,
  params: ChatParams,
  messages: { role: string; content: string }[],
  onChunk: (text: string, kind?: 'reasoning' | 'content') => void,
  abortSignal?: AbortSignal
): Promise<string> {
  const client = getOpenAIClient();
  let stream;
  try {
    stream = await client.chat.completions.create({
      model,
      max_tokens: 4096,
      stream: true,
      messages: [
        { role: 'system', content: params.systemPrompt },
        ...messages.map(m => ({ role: (m.role === 'tutor' ? 'assistant' : m.role) as 'user' | 'assistant', content: m.content })),
      ],
    }, { signal: abortSignal ?? undefined, timeout: 120_000 });
  } catch (err: any) {
    console.error('[ai] streamOpenAI create() failed:', err.message, err.status);
    throw err;
  }

  let fullText = '';
  let fullReasoning = '';
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta as any;
    if (delta?.reasoning_content) {
      fullReasoning += delta.reasoning_content;
      onChunk(delta.reasoning_content, 'reasoning');
    }
    if (delta?.content) {
      fullText += delta.content;
      onChunk(delta.content, 'content');
    }
  }

  console.log('[ai] Stream done (openai), content length:', fullText.length, 'reasoning length:', fullReasoning.length);
  return fullText;
}

/** Stream using Anthropic SDK (supports extended thinking / reasoning) */
async function streamAnthropic(
  settings: ReturnType<typeof getCachedAISettings>,
  model: string,
  params: ChatParams,
  messages: { role: string; content: string }[],
  onChunk: (text: string, kind?: 'reasoning' | 'content') => void,
  abortSignal?: AbortSignal
): Promise<string> {
  const client = getAnthropicClient();

  // Determine if model supports extended thinking
  const thinkingModels = ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'];
  const useThinking = thinkingModels.some(m => model.includes(m));

  const stream = client.messages.stream({
    model,
    max_tokens: useThinking ? 16384 : 4096,
    ...(useThinking ? { thinking: { type: 'enabled', budget_tokens: 10000 } } : {}),
    system: params.systemPrompt,
    messages: messages.map(m => ({ role: (m.role === 'tutor' ? 'assistant' : m.role) as 'user' | 'assistant', content: m.content })),
  });

  // Forward abort signal
  if (abortSignal) {
    const onAbort = () => { stream.abort(); };
    if (abortSignal.aborted) { stream.abort(); throw new Error('Aborted'); }
    abortSignal.addEventListener('abort', onAbort, { once: true });
    stream.on('end', () => abortSignal.removeEventListener('abort', onAbort));
  }

  let fullText = '';
  let fullReasoning = '';

  stream.on('text', (text) => {
    fullText += text;
    onChunk(text, 'content');
  });

  // Capture thinking/reasoning content if available
  stream.on('thinking', (thinking) => {
    fullReasoning += thinking;
    onChunk(thinking, 'reasoning');
  });

  // Wait for stream to complete — this throws on API errors
  await stream.finalMessage();

  console.log('[ai] Stream done (anthropic), content length:', fullText.length, 'reasoning length:', fullReasoning.length);
  return fullText;
}

export async function generateText(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 4096,
  abortSignal?: AbortSignal
): Promise<string> {
  const settings = getCachedAISettings();
  const model = getModel();

  let isDone = false;
  let lastChunkTime = Date.now();
  const timeoutMs = 30000;
  let watchdog: NodeJS.Timeout;

  const promise = new Promise<string>(async (resolve, reject) => {
    watchdog = setInterval(() => {
      if (isDone) {
        clearInterval(watchdog);
        return;
      }
      if (Date.now() - lastChunkTime > timeoutMs) {
        isDone = true;
        clearInterval(watchdog);
        reject(new Error('API 响应超时 (超过30秒未收到数据)，请检查网络或更换模型'));
      }
    }, 2000);

    try {
      let fullText = '';
      if (settings.api_provider === 'openai') {
        const client = getOpenAIClient();
        const stream = await client.chat.completions.create({
          model,
          max_tokens: maxTokens,
          stream: true,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }, { signal: abortSignal ?? undefined });
        
        for await (const chunk of stream) {
          lastChunkTime = Date.now();
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) fullText += delta;
        }
      } else {
        const client = getAnthropicClient();
        const thinkingModels = ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'];
        const useThinking = thinkingModels.some(m => model.includes(m));

        const stream = client.messages.stream({
          model,
          max_tokens: maxTokens,
          ...(useThinking ? { thinking: { type: 'enabled', budget_tokens: Math.min(10000, maxTokens - 1000) } } : {}),
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        });

        if (abortSignal) {
          const onAbort = () => stream.abort();
          if (abortSignal.aborted) { stream.abort(); throw new Error('Aborted'); }
          abortSignal.addEventListener('abort', onAbort, { once: true });
          stream.on('end', () => abortSignal.removeEventListener('abort', onAbort));
        }

        stream.on('text', (text) => {
          lastChunkTime = Date.now();
          fullText += text;
        });
        stream.on('thinking', () => {
          lastChunkTime = Date.now();
        });

        await stream.finalMessage();
      }
      
      isDone = true;
      clearInterval(watchdog);
      resolve(fullText);
    } catch (err) {
      isDone = true;
      clearInterval(watchdog);
      reject(err);
    }
  });

  return promise;
}

export function invalidateAISettingsCache(): void {
  lastSettingsFetch = null;
  cachedAnthropicClient = null;
  cachedOpenAIClient = null;
  cachedSettings = null;
}
