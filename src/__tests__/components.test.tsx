/**
 * Smoke tests for key UI components.
 *
 * @testing-library/react is NOT installed, so we keep these as import +
 * structural checks.  ErrorBoundary (a class component) is tested directly.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// ErrorBoundary  (class component — can test without render)
// ---------------------------------------------------------------------------
import { ErrorBoundary } from '../components/layout/ErrorBoundary';

describe('ErrorBoundary', () => {
  it('exports a React class component', () => {
    expect(typeof ErrorBoundary).toBe('function');
    // React class components have a prototype with render
    expect(typeof ErrorBoundary.prototype.render).toBe('function');
  });

  it('getDerivedStateFromError returns an error state', () => {
    const err = new Error('test error');
    const state = ErrorBoundary.getDerivedStateFromError(err);
    expect(state).toEqual({ hasError: true, error: err, resetCount: 0 });
  });

  it('can be instantiated in initial state', () => {
    const instance = new ErrorBoundary({ children: null });
    expect(instance.state.hasError).toBe(false);
    expect(instance.state.error).toBeNull();
    expect(instance.state.resetCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ToastProvider + useToast
// ---------------------------------------------------------------------------
describe('Toast components (import check)', () => {
  it('ToastProvider can be imported', async () => {
    const mod = await import('../components/ui/Toast');
    expect(typeof mod.ToastProvider).toBe('function');
  });

  it('useToast is exported', async () => {
    const mod = await import('../components/ui/Toast');
    expect(typeof mod.useToast).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// LoadingScreen + InlineLoader
// ---------------------------------------------------------------------------
describe('Loading screen components (import check)', () => {
  it('LoadingScreen can be imported', async () => {
    const mod = await import('../components/layout/LoadingScreen');
    expect(typeof mod.LoadingScreen).toBe('function');
  });

  it('InlineLoader can be imported', async () => {
    const mod = await import('../components/layout/LoadingScreen');
    expect(typeof mod.InlineLoader).toBe('function');
  });
});
