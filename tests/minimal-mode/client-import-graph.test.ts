/**
 * Client import graph guard for the minimal-mode wrapper surface.
 *
 * Proves requirePermissionIfMinimalMode (and its home module
 * permissions-server) never leaks into client bundles through any
 * client-reachable module. Mirrors tests/permissions/client-import-graph.test.ts.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');

const NODE_PREFIXES = ['node:', 'fs', 'path', 'child_process', 'os', 'crypto'];
const SERVER_PACKAGES = ['js-yaml', 'better-auth', 'kysely'];
const SERVER_MODULES = [
  'lib/auth/permissions-server',
  'lib/auth/server',
  'lib/persistence/server-provider',
];

/**
 * Client-reachable modules that must never import server-only code.
 * These are the entry points the minimal-mode UI touches.
 */
const CLIENT_ENTRY_POINTS = [
  'lib/hooks/use-permissions.ts',
  'lib/config/feature-flags.ts',
] as const;

function walkImports(filePath: string, visited = new Set<string>()): string[] {
  if (visited.has(filePath)) return [];
  visited.add(filePath);

  const violations: string[] = [];
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const importRegex = /from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const specifier = match[1];

    if (NODE_PREFIXES.some((p) => specifier.startsWith(p))) {
      violations.push(`${filePath} imports '${specifier}'`);
      continue;
    }

    if (SERVER_PACKAGES.includes(specifier)) {
      violations.push(`${filePath} imports '${specifier}'`);
      continue;
    }

    if (SERVER_MODULES.some((m) => specifier === `@/${m}` || specifier.endsWith(`/${m}`))) {
      violations.push(`${filePath} imports server module '${specifier}'`);
      continue;
    }

    if (specifier.startsWith('.') || specifier.startsWith('@/')) {
      const resolved = specifier.startsWith('@/')
        ? resolve(ROOT, specifier.slice(2))
        : resolve(filePath, '..', specifier);
      for (const ext of ['', '.ts', '.tsx', '.js', '.jsx']) {
        const candidate = resolved.endsWith(ext) ? resolved : resolved + ext;
        if (!visited.has(candidate)) {
          violations.push(...walkImports(candidate, visited));
          break;
        }
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

describe('Minimal-mode client import graph safety', () => {
  for (const entryPoint of CLIENT_ENTRY_POINTS) {
    it(`${entryPoint} has no node: or server-only imports in its graph`, () => {
      const hookPath = resolve(ROOT, entryPoint);
      const violations = walkImports(hookPath);
      expect(violations).toEqual([]);
    });
  }
});
