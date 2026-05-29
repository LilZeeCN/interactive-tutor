import { describe, it, expect } from 'vitest';
import { sanitizeSchema, sanitizePlugin } from '../lib/sanitize';

// ---------------------------------------------------------------------------
// sanitizeSchema  – schema object structure
// ---------------------------------------------------------------------------
describe('sanitizeSchema', () => {
  it('extends default schema with MathML tag names', () => {
    expect(sanitizeSchema.tagNames).toBeDefined();
    expect(Array.isArray(sanitizeSchema.tagNames)).toBe(true);

    // Core MathML elements used by KaTeX
    const mathmlTags = [
      'math', 'mi', 'mo', 'mn', 'ms', 'mtext',
      'mfrac', 'msqrt', 'mroot', 'msub', 'msup', 'msubsup',
      'munder', 'mover', 'munderover',
      'mtable', 'mtr', 'mtd', 'mrow', 'menclose',
      'mspace', 'mpadded', 'mfenced', 'mphantom',
      'annotation', 'semantics',
    ];
    for (const tag of mathmlTags) {
      expect(sanitizeSchema.tagNames).toContain(tag);
    }
  });

  it('includes default HTML tag names (not stripped)', () => {
    const common = ['div', 'span', 'p', 'a', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li'];
    for (const tag of common) {
      expect(sanitizeSchema.tagNames).toContain(tag);
    }
  });

  it('has attributes defined', () => {
    expect(sanitizeSchema.attributes).toBeDefined();
    expect(typeof sanitizeSchema.attributes).toBe('object');
    expect(sanitizeSchema.attributes).not.toBeNull();
  });

  it('allows className via wildcard attribute', () => {
    const wildcard = sanitizeSchema.attributes?.['*'];
    expect(wildcard).toBeDefined();
    expect(Array.isArray(wildcard)).toBe(true);
    expect(wildcard).toContain('className');
  });

  it('allows display and xmlns on <math>', () => {
    const mathAttrs = sanitizeSchema.attributes?.math;
    expect(mathAttrs).toBeDefined();
    expect(mathAttrs).toContain('display');
    expect(mathAttrs).toContain('xmlns');
  });

  it('allows MathML-specific attributes on mi (mathvariant)', () => {
    const miAttrs = sanitizeSchema.attributes?.mi;
    expect(miAttrs).toContain('mathvariant');
  });

  it('allows fence and stretchy on mo', () => {
    const moAttrs = sanitizeSchema.attributes?.mo;
    expect(moAttrs).toContain('fence');
    expect(moAttrs).toContain('stretchy');
  });

  it('allows mfrac attributes (linethickness, bevelled)', () => {
    const mfracAttrs = sanitizeSchema.attributes?.mfrac;
    expect(mfracAttrs).toContain('linethickness');
    expect(mfracAttrs).toContain('bevelled');
  });

  it('allows menclose notation', () => {
    const mencloseAttrs = sanitizeSchema.attributes?.menclose;
    expect(mencloseAttrs).toContain('notation');
  });

  it('allows mspace dimension attributes', () => {
    const mspaceAttrs = sanitizeSchema.attributes?.mspace;
    expect(mspaceAttrs).toContain('width');
    expect(mspaceAttrs).toContain('height');
    expect(mspaceAttrs).toContain('depth');
  });

  it('allows annotation encoding attribute', () => {
    const annAttrs = sanitizeSchema.attributes?.annotation;
    expect(annAttrs).toContain('encoding');
  });

  it('allows mtable/mtr/mtd layout attributes', () => {
    expect(sanitizeSchema.attributes?.mtable).toContain('columnalign');
    expect(sanitizeSchema.attributes?.mtr).toContain('columnalign');
    expect(sanitizeSchema.attributes?.mtd).toContain('columnalign');
  });
});

// ---------------------------------------------------------------------------
// sanitizePlugin  – returns a rehype plugin function
// ---------------------------------------------------------------------------
describe('sanitizePlugin', () => {
  it('returns a function (rehype plugin)', () => {
    const plugin = sanitizePlugin();
    expect(typeof plugin).toBe('function');
  });

  it('returns a fresh plugin on each call', () => {
    const a = sanitizePlugin();
    const b = sanitizePlugin();
    expect(a).not.toBe(b); // different function instances
  });
});

// ---------------------------------------------------------------------------
// Integration: sanitizePlugin with rehype-sanitize (import check)
// ---------------------------------------------------------------------------
describe('sanitizePlugin integration', () => {
  it('rehype-sanitize is importable', async () => {
    const mod = await import('rehype-sanitize');
    expect(typeof mod.default).toBe('function');
  });

  it('sanitizePlugin wraps rehypeSanitize with our schema', async () => {
    // The plugin is simply rehypeSanitize(sanitizeSchema) — verify it's callable
    const plugin = sanitizePlugin();
    // A rehype plugin is of the form (options?) => (tree) => undefined
    // When called with no tree, it returns a transformer
    expect(() => plugin({ type: 'root', children: [] })).not.toThrow();
  });
});
