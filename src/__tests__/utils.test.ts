import { describe, it, expect } from 'vitest';
import { cn } from '../lib/utils';

describe('cn (classname merge utility)', () => {
  it('returns a single class string', () => {
    expect(cn('bg-red-500')).toBe('bg-red-500');
  });

  it('merges multiple class strings', () => {
    expect(cn('bg-red-500', 'text-white', 'p-4')).toBe('bg-red-500 text-white p-4');
  });

  it('handles conditional classes (falsy values are dropped)', () => {
    expect(cn('base', false && 'hidden', undefined, null, 'visible')).toBe('base visible');
  });

  it('handles object syntax for conditional classes', () => {
    expect(cn('base', { active: true, disabled: false })).toBe('base active');
  });

  it('handles array of class values', () => {
    expect(cn(['px-2', 'py-1'], 'font-bold')).toBe('px-2 py-1 font-bold');
  });

  it('resolves Tailwind conflicts via tailwind-merge (last wins)', () => {
    // bg-red-500 and bg-blue-500 conflict — tailwind-merge keeps the last one
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500');
  });

  it('resolves Tailwind conflicts across different styles', () => {
    // px-2 / px-4 conflict, py-1 is kept
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });

  it('handles empty input gracefully', () => {
    expect(cn()).toBe('');
  });

  it('handles only falsy inputs', () => {
    expect(cn(false, null, undefined, '')).toBe('');
  });
});
