import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard. The client hook must never pull in Node-only
 * modules (node:fs, node:path, js-yaml, etc.) through its import
 * graph. This test does a static walk of the import tree rooted at
 * lib/hooks/use-site-branding.ts and asserts no server-only imports.
 */

const ROOT = resolve(import.meta.dirname, '../../..');

const NODE_PREFIXES = ['node:', 'fs', 'path', 'child_process', 'os', 'crypto'];
const SERVER_PACKAGES = ['js-yaml'];

function walkImports(filePath: string, visited = new Set<string>()): string[] {
  if (visited.has(filePath)) return [];
  visited.add(filePath);

  const violations: string[] = [];
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    // File not found — skip (might be a package import)
    return [];
  }

  const importRegex = /from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const specifier = match[1];

    // Check for node: prefix
    if (NODE_PREFIXES.some((p) => specifier.startsWith(p))) {
      violations.push(`${filePath} imports '${specifier}'`);
      continue;
    }

    // Check for server-only packages
    if (SERVER_PACKAGES.includes(specifier)) {
      violations.push(`${filePath} imports '${specifier}'`);
      continue;
    }

    // Resolve relative imports and recurse
    if (specifier.startsWith('.') || specifier.startsWith('@/')) {
      const resolved = specifier.startsWith('@/')
        ? resolve(ROOT, specifier.slice(2))
        : resolve(filePath, '..', specifier);
      // Try common extensions
      for (const ext of ['', '.ts', '.tsx', '.js', '.jsx']) {
        const candidate = resolved.endsWith(ext) ? resolved : resolved + ext;
        if (!visited.has(candidate)) {
          violations.push(...walkImports(candidate, visited));
          break;
        }
        // Also try index files
        const indexCandidate = resolved + '/index' + ext;
        if (!visited.has(indexCandidate)) {
          violations.push(...walkImports(indexCandidate, visited));
          break;
        }
      }
    }
  }

  return violations;
}

describe('Client import graph safety', () => {
  it('use-site-branding.ts has no node: or server-only imports in its graph', () => {
    const hookPath = resolve(ROOT, 'lib/hooks/use-site-branding.ts');
    const violations = walkImports(hookPath);

    expect(violations).toEqual([]);
  });
});
