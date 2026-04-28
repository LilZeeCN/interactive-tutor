import { describe, it, expect } from 'vitest';
import { parseJSON } from '../services/parseJSON.js';

describe('parseJSON', () => {
  it('parses valid JSON directly', () => {
    expect(parseJSON('{"key": "value"}')).toEqual({ key: 'value' });
  });

  it('parses valid JSON array', () => {
    expect(parseJSON('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('extracts JSON from markdown code block', () => {
    const input = 'Here is the result:\n```json\n{"name": "test"}\n```';
    expect(parseJSON(input)).toEqual({ name: 'test' });
  });

  it('extracts JSON from code block without language tag', () => {
    const input = '```\n{"name": "test"}\n```';
    expect(parseJSON(input)).toEqual({ name: 'test' });
  });

  it('extracts raw array from text', () => {
    const input = 'Some text before [{"a": 1}, {"b": 2}] and after';
    expect(parseJSON(input)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('extracts raw object from text', () => {
    const input = 'Result: {"x": 42} end';
    expect(parseJSON(input)).toEqual({ x: 42 });
  });

  it('throws on completely invalid input', () => {
    expect(() => parseJSON('no json here')).toThrow('Could not parse JSON');
  });

  it('handles nested JSON in code block', () => {
    const input = '```\n[{"week": 1, "topic": "intro"}]\n```';
    expect(parseJSON(input)).toEqual([{ week: 1, topic: 'intro' }]);
  });
});
