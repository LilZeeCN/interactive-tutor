/**
 * Escape SQL LIKE wildcards (% and _) in user-provided strings
 * to prevent unintended pattern matching.
 */
export function escapeLIKE(str: string): string {
  return str.replace(/[%_]/g, c => `[${c}]`);
}
