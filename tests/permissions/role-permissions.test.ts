import { describe, expect, it, vi } from 'vitest';

// Hermetic unit test — faked DB, no real PostgreSQL.
// Mirrors the mock pattern from tests/agent-runtime/stage-meta-routes.test.ts.

const mocks = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({
    pool: { query: mocks.mockQuery },
  }),
}));

import { resolvePermissionSet } from '@/lib/auth/permissions-server';
import type { Role } from '@/lib/auth/roles';

/** Create a fresh queryable for cache isolation between test groups. */
function freshQueryable() {
  return { query: mocks.mockQuery };
}

function fakeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'role-1',
    name: 'guest',
    rank: 1,
    isSystem: true,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolvePermissionSet — rank defaults
// ---------------------------------------------------------------------------

describe('resolvePermissionSet — rank defaults', () => {
  it('guest rank gets quiz.grade from defaults when DB has no overrides', async () => {
    const q = freshQueryable();
    mocks.mockQuery.mockResolvedValue({ rows: [] });
    const role = fakeRole({ name: 'guest', rank: 1 });
    const perms = await resolvePermissionSet(q, role);
    expect(perms.has('quiz.grade')).toBe(true);
    expect(perms.size).toBe(1);
  });

  it('learner rank gets four defaults when DB has no overrides', async () => {
    const q = freshQueryable();
    mocks.mockQuery.mockResolvedValue({ rows: [] });
    const role = fakeRole({ name: 'learner', rank: 2 });
    const perms = await resolvePermissionSet(q, role);
    expect(perms.has('quiz.grade')).toBe(true);
    expect(perms.has('classroom.chat')).toBe(true);
    expect(perms.has('tts.use')).toBe(true);
    expect(perms.has('asr.use')).toBe(true);
    expect(perms.size).toBe(4);
  });

  it('admin rank gets all eleven when DB has no overrides', async () => {
    const q = freshQueryable();
    mocks.mockQuery.mockResolvedValue({ rows: [] });
    const role = fakeRole({ name: 'admin', rank: 4 });
    const perms = await resolvePermissionSet(q, role);
    expect(perms.size).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// resolvePermissionSet — DB overrides
// ---------------------------------------------------------------------------

describe('resolvePermissionSet — DB overrides', () => {
  it('granted true adds a permission not in rank defaults', async () => {
    const q = freshQueryable();
    mocks.mockQuery.mockResolvedValue({
      rows: [{ permission: 'course.create', granted: true }],
    });
    const role = fakeRole({ name: 'guest', rank: 1 });
    const perms = await resolvePermissionSet(q, role);
    expect(perms.has('quiz.grade')).toBe(true);
    expect(perms.has('course.create')).toBe(true);
    expect(perms.size).toBe(2);
  });

  it('granted false removes a permission from rank defaults', async () => {
    const q = freshQueryable();
    mocks.mockQuery.mockResolvedValue({
      rows: [{ permission: 'quiz.grade', granted: false }],
    });
    const role = fakeRole({ name: 'guest', rank: 1 });
    const perms = await resolvePermissionSet(q, role);
    expect(perms.has('quiz.grade')).toBe(false);
    expect(perms.size).toBe(0);
  });

  it('multiple overrides merge correctly', async () => {
    const q = freshQueryable();
    mocks.mockQuery.mockResolvedValue({
      rows: [
        { permission: 'course.create', granted: true },
        { permission: 'course.edit', granted: true },
        { permission: 'quiz.grade', granted: false },
      ],
    });
    const role = fakeRole({ name: 'learner', rank: 2 });
    const perms = await resolvePermissionSet(q, role);
    expect(perms.has('course.create')).toBe(true);
    expect(perms.has('course.edit')).toBe(true);
    expect(perms.has('quiz.grade')).toBe(false);
    expect(perms.has('classroom.chat')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolvePermissionSet — per-request cache
// ---------------------------------------------------------------------------

describe('resolvePermissionSet — fresh merge (no cache)', () => {
  it('returns a new object on each call (no cross-request cache)', async () => {
    const q = freshQueryable();
    mocks.mockQuery.mockResolvedValue({ rows: [] });
    const role = fakeRole({ name: 'guest', rank: 1 });
    const first = await resolvePermissionSet(q, role);
    const second = await resolvePermissionSet(q, role);
    expect(first).not.toBe(second);
    expect(first).toStrictEqual(second);
  });

  it('returns different objects for different roles', async () => {
    const q = freshQueryable();
    mocks.mockQuery.mockResolvedValue({ rows: [] });
    const guest = fakeRole({ name: 'guest', rank: 1 });
    const learner = fakeRole({ name: 'learner', rank: 2, id: 'role-2' });
    const first = await resolvePermissionSet(q, guest);
    const second = await resolvePermissionSet(q, learner);
    expect(first).not.toBe(second);
    expect(first.size).toBe(1);
    expect(second.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// resolvePermissionSet — query shape
// ---------------------------------------------------------------------------

describe('resolvePermissionSet — query shape', () => {
  it('queries role_permissions with the role name', async () => {
    const q = freshQueryable();
    mocks.mockQuery.mockResolvedValue({ rows: [] });
    const role = fakeRole({ name: 'creator' });
    await resolvePermissionSet(q, role);
    expect(mocks.mockQuery).toHaveBeenCalledWith(expect.stringContaining('role_permissions'), [
      role.name,
    ]);
  });
});
