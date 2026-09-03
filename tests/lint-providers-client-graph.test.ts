/**
 * Static guard that asserts lib/ai/providers.ts has no top-level static import
 * of a node-only package. The file sits in the client graph (settings store ->
 * ServerProvidersInit -> root layout), so any static `import ... from 'undici'`
 * or `import ... from 'node:*'` causes Turbopack to bundle the Node module for
 * the browser, producing "Cannot find module 'node:net'" at module evaluation.
 *
 * Dynamic `webpackIgnore` imports are the intended escape hatch and stay legal.
 * Type-only imports (`import type`) are erased at compile time and safe.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROVIDERS_PATH = resolve(__dirname, '../lib/ai/providers.ts');

/** Node-only specifiers that must never appear as a static value import. */
const FORBIDDEN_STATIC_SPECIFIERS = ['undici', 'node:net', 'node:tls'];

describe('providers client-graph guard', () => {
  const source = readFileSync(PROVIDERS_PATH, 'utf-8');
  const lines = source.split('\n');

  it('has no static top-level import of a node-only package', () => {
    const violations: { line: number; specifier: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      // Skip blank lines, comments.
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

      // Stop at first function or class declaration (end of top-level scope).
      if (/^(?:export\s+)?(?:async\s+)?(?:function|class)\s/.test(trimmed)) break;

      // Type-only imports are erased at compile time. Skip them.
      if (/^import\s+type\s/.test(trimmed)) continue;

      for (const spec of FORBIDDEN_STATIC_SPECIFIERS) {
        // Match: import ... from 'spec' or import { ... } from 'spec'
        const escapedSpec = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const importPattern = new RegExp(
          `^import\\s+(?:\\{[^}]*\\}\\s+from\\s+|[\\w*\\s,]+?\\s+from\\s+)['"]${escapedSpec}['"]`,
        );
        if (importPattern.test(trimmed)) {
          violations.push({ line: i + 1, specifier: spec });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('has no module-scope new UndiciAgent or new Agent instantiation', () => {
    const violations: { line: number }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      // Stop at first function or class declaration.
      if (/^(?:export\s+)?(?:async\s+)?(?:function|class)\s/.test(trimmed)) break;

      if (/^const\s+\w+\s*=\s*new\s+(?:UndiciAgent|Agent)\s*\(/.test(trimmed)) {
        violations.push({ line: i + 1 });
      }
    }

    expect(violations).toEqual([]);
  });

  it('allows dynamic webpackIgnore imports', () => {
    // The existing google proxy path and the new getter use this pattern.
    const dynamicImportPattern =
      /await\s+import\s*\(\s*\/\*\s*webpackIgnore:\s*true\s*\*\/\s*['"]undici['"]\s*\)/;
    expect(dynamicImportPattern.test(source)).toBe(true);
  });
});
