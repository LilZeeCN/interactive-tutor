import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

/**
 * Sanitize schema that allows KaTeX/MathML output while blocking XSS.
 * Extends the default rehype-sanitize schema to permit MathML elements and attributes.
 */
export const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    // MathML elements used by KaTeX
    'math', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mfrac', 'msqrt', 'mroot',
    'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover',
    'mtable', 'mtr', 'mtd', 'mrow', 'menclose', 'mspace', 'mpadded',
    'mfenced', 'mphantom', 'annotation', 'semantics',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...(defaultSchema.attributes?.['*'] || []),
      // Allow class and style on all elements (KaTeX uses both)
      'className',
    ],
    // Allow MathML attributes
    math: ['display', 'xmlns', 'mathvariant', 'mathsize', 'mathcolor'],
    mi: ['mathvariant'],
    mo: ['fence', 'stretchy', 'lspace', 'rspace', 'minsize', 'maxsize'],
    mfrac: ['linethickness', 'bevelled'],
    mtable: ['columnalign', 'rowspacing', 'columnspacing'],
    mtd: ['columnalign', 'rowspan', 'columnspan'],
    mtr: ['columnalign'],
    menclose: ['notation'],
    mspace: ['width', 'height', 'depth', 'linebreak'],
    mpadded: ['width', 'height', 'depth', 'lspace', 'voffset'],
    mfenced: ['open', 'close', 'separators'],
    annotation: ['encoding'],
  },
};

/** Rehype sanitize plugin configured for KaTeX compatibility */
export const sanitizePlugin = () => rehypeSanitize(sanitizeSchema);
