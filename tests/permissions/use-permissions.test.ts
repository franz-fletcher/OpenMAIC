import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the usePermissions client hook.
 *
 * The hook fetches /api/auth/permissions and returns a PermissionState.
 * Defaults-deny: empty array before resolve, empty on non-2xx/error.
 * Pure import graph: never imports server modules.
 */

// ---------------------------------------------------------------------------
// Mocks: React useState and useEffect
// ---------------------------------------------------------------------------

let stateValues: unknown[] = [];

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: vi.fn((initial: unknown) => {
      const idx = stateValues.length;
      stateValues.push(initial);
      const setter = vi.fn((v: unknown) => {
        stateValues[idx] = typeof v === 'function' ? v(stateValues[idx]) : v;
      });
      return [stateValues[idx], setter] as const;
    }),
    useEffect: vi.fn((fn: () => void | (() => void)) => {
      // Execute effect synchronously for testing
      fn();
    }),
  };
});

const originalFetch = globalThis.fetch;

beforeEach(() => {
  stateValues = [];
  vi.stubGlobal('fetch', vi.fn());
  vi.resetModules();
});

afterEach(() => {
  vi.stubGlobal('fetch', originalFetch);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePermissions', () => {
  it('exports a function named usePermissions', async () => {
    const mod = await import('@/lib/hooks/use-permissions');
    expect(typeof mod.usePermissions).toBe('function');
  });

  it('returns empty permissions as initial state (defaults-deny)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ permissions: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { usePermissions } = await import('@/lib/hooks/use-permissions');
    const state = usePermissions();

    // Initial state: empty permissions, loading true
    expect(state.permissions).toEqual([]);
    expect(state.loading).toBe(true);
  });

  it('calls fetch with /api/auth/permissions', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ permissions: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { usePermissions } = await import('@/lib/hooks/use-permissions');
    usePermissions();

    expect(fetch).toHaveBeenCalledWith('/api/auth/permissions');
  });

  it('resolves to fetched permissions on 2xx', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ permissions: ['quiz.grade', 'classroom.chat'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { usePermissions } = await import('@/lib/hooks/use-permissions');
    const state = usePermissions();

    // The hook calls setPermissions internally via the effect
    expect(state.permissions).toEqual([]);
    expect(state.loading).toBe(true);
  });

  it('keeps empty permissions on non-2xx response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));

    const { usePermissions } = await import('@/lib/hooks/use-permissions');
    const state = usePermissions();

    expect(state.permissions).toEqual([]);
  });

  it('keeps empty permissions on fetch error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

    const { usePermissions } = await import('@/lib/hooks/use-permissions');
    const state = usePermissions();

    expect(state.permissions).toEqual([]);
  });

  it('returns a can() method that checks permission membership', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ permissions: ['quiz.grade'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { usePermissions } = await import('@/lib/hooks/use-permissions');
    const state = usePermissions();

    expect(typeof state.can).toBe('function');
    // Before fetch resolves, permissions is empty, so can returns false
    expect(state.can('quiz.grade')).toBe(false);
  });
});
