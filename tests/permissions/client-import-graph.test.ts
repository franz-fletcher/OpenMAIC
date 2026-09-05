import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard. The client hook use-permissions.ts must never pull
 * in Node-only modules (node:fs, node:path, etc.) or server-only
 * packages through its import graph. Mirrors the branding guard at
 * tests/branding/client-import-graph.test.ts.
 *
 * The server package list extends the branding guard with packages
 * known to be server-only: better-auth, kysely, js-yaml, and the
 * permissions-server module.
 */

const ROOT = resolve(import.meta.dirname, '../../..');

const NODE_PREFIXES = ['node:', 'fs', 'path', 'child_process', 'os', 'crypto'];
const SERVER_PACKAGES = ['js-yaml', 'better-auth', 'kysely'];
const SERVER_MODULES = [
  'lib/auth/permissions-server',
  'lib/auth/server',
  'lib/persistence/server-provider',
];

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

    // Check for server-only modules by path
    if (SERVER_MODULES.some((m) => specifier === `@/${m}` || specifier.endsWith(`/${m}`))) {
      violations.push(`${filePath} imports server module '${specifier}'`);
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
  it('use-permissions.ts has no node: or server-only imports in its graph', () => {
    const hookPath = resolve(ROOT, 'lib/hooks/use-permissions.ts');
    const violations = walkImports(hookPath);

    expect(violations).toEqual([]);
  });
});
