import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { encrypt, decrypt } from '../services/crypto.js';
import { invalidateAISettingsCache, detectProvider } from '../services/ai.js';
import { dbGet, dbAll } from '../db-types.js';

// Validate api_url to prevent SSRF — block internal/private hosts
function isValidApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    // Block obvious internal addresses
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return false;
    // Block IPv6-mapped IPv4
    if (/^::ffff:\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
    // Block private/reserved ranges
    if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.')) return false;
    // 172.16.0.0/12 range
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
    // Block common internal hostnames
    if (host === 'host.docker.internal' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    return true;
  } catch {
    return false;
  }
}

export const settingsRouter = Router();

// GET /api/settings - get current settings (key masked)
settingsRouter.get('/', (_req: Request, res: Response) => {
  const rows = dbAll<{ key: string; value: string }>('SELECT key, value FROM settings');

  const settings: Record<string, string> = {};
  for (const row of rows) {
    if (row.key === 'api_key') {
      // Decrypt if encrypted, then mask for display
      let raw = '';
      try {
        raw = row.value ? decrypt(row.value) : '';
      } catch {
        // Key changed or corrupt ciphertext — treat as empty so user can re-enter
        raw = '';
      }
      if (raw && raw.length > 8) {
        settings[row.key] = raw.slice(0, 4) + '****' + raw.slice(-4);
      } else if (raw) {
        settings[row.key] = '****';
      } else {
        settings[row.key] = '';
      }
    } else {
      settings[row.key] = row.value;
    }
  }

  res.json(settings);
});

// PUT /api/settings - save settings
settingsRouter.put('/', (req: Request, res: Response) => {
  const db = getDb();
  const { api_url, api_key, model, api_provider } = req.body;

  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
  );

  if (api_url !== undefined) {
    if (api_url && !isValidApiUrl(api_url)) {
      res.status(400).json({ error: 'API 地址无效：不允许使用内网地址' });
      return;
    }
    upsert.run('api_url', api_url, api_url);
  }
  if (api_key !== undefined) upsert.run('api_key', encrypt(api_key), encrypt(api_key));
  if (model !== undefined) upsert.run('model', model, model);
  if (api_provider !== undefined) upsert.run('api_provider', api_provider, api_provider);

  // Invalidate AI cache so next request picks up new settings immediately
  invalidateAISettingsCache();

  res.json({ success: true });
});

// POST /api/settings/test - test API connection
settingsRouter.post('/test', async (_req: Request, res: Response) => {
  const db = getDb();
  const row = dbGet("SELECT value FROM settings WHERE key = 'api_key'");
  const apiUrlRow = dbGet("SELECT value FROM settings WHERE key = 'api_url'");
  const modelRow = dbGet("SELECT value FROM settings WHERE key = 'model'");
  const providerRow = dbGet("SELECT value FROM settings WHERE key = 'api_provider'");

  if (!row?.value) {
    res.status(400).json({ error: '请先配置 API Key' });
    return;
  }

  try {
    let apiKey: string;
    try {
      apiKey = decrypt(row.value);
    } catch {
      res.status(400).json({ success: false, error: 'API Key 解密失败，请重新配置 API Key' });
      return;
    }

    const rawProvider = providerRow?.value || 'auto';
    const apiUrl = apiUrlRow?.value || '';
    const provider = detectProvider(apiUrl, rawProvider);
    const baseURL = apiUrl || undefined;
    const model = modelRow?.value || 'default';
    console.log('[settings/test] provider:', provider, 'rawProvider:', rawProvider, 'apiUrl:', apiUrl);

    if (provider === 'openai') {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({
        apiKey,
        baseURL: baseURL || undefined,
      });

      const response = await client.chat.completions.create({
        model: model === 'default' ? 'gpt-4o' : model,
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Hello, please reply with "OK".' }],
      });

      res.json({ success: true, message: `连接成功！模型: ${model}`, response: response.choices[0]?.message?.content });
    } else {
      const { Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({
        apiKey,
        baseURL: baseURL || undefined,
      });

      const response = await client.messages.create({
        model: model === 'default' ? 'claude-sonnet-4-20250514' : model,
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Hello, please reply with "OK".' }],
      });

      res.json({ success: true, message: `连接成功！模型: ${model}`, response: response.content[0] });
    }
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || '连接失败' });
  }
});
