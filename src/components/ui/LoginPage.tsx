import { useState } from 'react';
import { apiFetch } from '../../lib/api';

interface LoginPageProps {
  configured: boolean;
  onAuth: (token: string) => void;
}

export function LoginPage({ configured, onAuth }: LoginPageProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!configured && password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    if (password.length < 4) {
      setError('密码长度不能少于4位');
      return;
    }

    setLoading(true);
    try {
      const endpoint = configured ? '/api/auth/login' : '/api/auth/setup';
      const data = await apiFetch<{ token: string }>(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      onAuth(data.token);
    } catch (err: any) {
      setError(err.message || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#050505] text-white items-center justify-center">
      <div className="w-full max-w-sm px-6">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Interactive Tutor</h1>
          <p className="text-white/40 text-sm mt-2">
            {configured ? '请输入密码登录' : '首次使用，请设置密码'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入密码"
              className="w-full px-4 py-3 bg-white/[0.06] border border-white/[0.08] rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-white/20 transition-colors"
              autoFocus
            />
          </div>

          {!configured && (
            <div>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="确认密码"
                className="w-full px-4 py-3 bg-white/[0.06] border border-white/[0.08] rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-white/20 transition-colors"
              />
            </div>
          )}

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-white/[0.1] hover:bg-white/[0.15] disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? '处理中...' : configured ? '登录' : '设置密码'}
          </button>
        </form>
      </div>
    </div>
  );
}
