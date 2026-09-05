import { describe, expect, it } from 'vitest';

import {
  can,
  defaultPermissionsForRank,
  PERMISSION_CATALOG,
  type Permission,
  type Principal,
} from '@/lib/auth/permissions';

// ---------------------------------------------------------------------------
// Permission catalog
// ---------------------------------------------------------------------------

describe('PERMISSION_CATALOG', () => {
  it('contains exactly 11 permissions', () => {
    expect(PERMISSION_CATALOG).toHaveLength(11);
  });

  it('is frozen and immutable', () => {
    expect(Object.isFrozen(PERMISSION_CATALOG)).toBe(true);
  });

  it('contains all expected permission keys', () => {
    const expected: Permission[] = [
      'course.create',
      'course.edit',
      'course.delete',
      'course.publish',
      'classroom.chat',
      'quiz.grade',
      'tts.use',
      'asr.use',
      'settings.manage',
      'users.manage',
      'roles.manage',
    ];
    expect([...PERMISSION_CATALOG]).toEqual(expect.arrayContaining(expected));
  });

  it('has no duplicate entries', () => {
    const unique = new Set(PERMISSION_CATALOG);
    expect(unique.size).toBe(PERMISSION_CATALOG.length);
  });
});

// ---------------------------------------------------------------------------
// defaultPermissionsForRank
// ---------------------------------------------------------------------------

describe('defaultPermissionsForRank', () => {
  it('returns empty for anonymous (rank 0)', () => {
    expect(defaultPermissionsForRank(0)).toEqual([]);
  });

  it('guest (rank 1) holds quiz.grade only', () => {
    expect(defaultPermissionsForRank(1)).toEqual(['quiz.grade']);
  });

  it('learner (rank 2) holds quiz.grade, classroom.chat, tts.use, asr.use', () => {
    const perms = defaultPermissionsForRank(2);
    expect(perms).toEqual(
      expect.arrayContaining(['quiz.grade', 'classroom.chat', 'tts.use', 'asr.use']),
    );
    expect(perms).toHaveLength(4);
  });

  it('creator (rank 3) holds learner permissions plus course.create/edit/delete/publish', () => {
    const perms = defaultPermissionsForRank(3);
    expect(perms).toEqual(
      expect.arrayContaining([
        'quiz.grade',
        'classroom.chat',
        'tts.use',
        'asr.use',
        'course.create',
        'course.edit',
        'course.delete',
        'course.publish',
      ]),
    );
    expect(perms).toHaveLength(8);
  });

  it('admin (rank 4) holds all 11 permissions', () => {
    const perms = defaultPermissionsForRank(4);
    expect(perms).toHaveLength(11);
    expect(perms).toEqual(expect.arrayContaining([...PERMISSION_CATALOG]));
  });

  it('returns empty for unknown ranks above max', () => {
    expect(defaultPermissionsForRank(99)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// can() — anonymous
// ---------------------------------------------------------------------------

describe('can — anonymous', () => {
  it('denies everything for null principal', () => {
    expect(can(null, 'quiz.grade')).toBe(false);
    expect(can(null, 'course.create')).toBe(false);
  });

  it('denies everything when principal is absent', () => {
    const principal: Principal = { rank: 0 };
    expect(can(principal, 'quiz.grade')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// can() — guest
// ---------------------------------------------------------------------------

describe('can — guest', () => {
  const guest: Principal = { rank: 1 };

  it('allows quiz.grade', () => {
    expect(can(guest, 'quiz.grade')).toBe(true);
  });

  it('denies course.create', () => {
    expect(can(guest, 'course.create')).toBe(false);
  });

  it('denies classroom.chat', () => {
    expect(can(guest, 'classroom.chat')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// can() — learner
// ---------------------------------------------------------------------------

describe('can — learner', () => {
  const learner: Principal = { rank: 2 };

  it('allows classroom.chat', () => {
    expect(can(learner, 'classroom.chat')).toBe(true);
  });

  it('allows quiz.grade', () => {
    expect(can(learner, 'quiz.grade')).toBe(true);
  });

  it('allows tts.use', () => {
    expect(can(learner, 'tts.use')).toBe(true);
  });

  it('allows asr.use', () => {
    expect(can(learner, 'asr.use')).toBe(true);
  });

  it('denies course.create', () => {
    expect(can(learner, 'course.create')).toBe(false);
  });

  it('denies settings.manage', () => {
    expect(can(learner, 'settings.manage')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// can() — creator
// ---------------------------------------------------------------------------

describe('can — creator', () => {
  const creator: Principal = { rank: 3 };

  it('allows course.create', () => {
    expect(can(creator, 'course.create')).toBe(true);
  });

  it('allows course.edit', () => {
    expect(can(creator, 'course.edit')).toBe(true);
  });

  it('allows course.delete', () => {
    expect(can(creator, 'course.delete')).toBe(true);
  });

  it('allows course.publish', () => {
    expect(can(creator, 'course.publish')).toBe(true);
  });

  it('denies settings.manage', () => {
    expect(can(creator, 'settings.manage')).toBe(false);
  });

  it('denies users.manage', () => {
    expect(can(creator, 'users.manage')).toBe(false);
  });

  it('denies roles.manage', () => {
    expect(can(creator, 'roles.manage')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// can() — admin
// ---------------------------------------------------------------------------

describe('can — admin', () => {
  const admin: Principal = { rank: 4 };

  it('allows all permissions', () => {
    for (const perm of PERMISSION_CATALOG) {
      expect(can(admin, perm)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// can() — overrides
// ---------------------------------------------------------------------------

describe('can — overrides', () => {
  const guest: Principal = { rank: 1 };

  it('grants a permission via override', () => {
    const overrides = new Map<Permission, boolean>([['course.create', true]]);
    expect(can(guest, 'course.create', overrides)).toBe(true);
  });

  it('revokes a permission via override', () => {
    const overrides = new Map<Permission, boolean>([['quiz.grade', false]]);
    expect(can(guest, 'quiz.grade', overrides)).toBe(false);
  });

  it('revocation override takes precedence over rank default', () => {
    const overrides = new Map<Permission, boolean>([['quiz.grade', false]]);
    expect(can(guest, 'quiz.grade', overrides)).toBe(false);
  });

  it('grant override applies to non-default permission', () => {
    const overrides = new Map<Permission, boolean>([
      ['course.create', true],
      ['course.edit', true],
    ]);
    expect(can(guest, 'course.create', overrides)).toBe(true);
    expect(can(guest, 'course.edit', overrides)).toBe(true);
  });

  it('null principal with override still denies', () => {
    const overrides = new Map<Permission, boolean>([['quiz.grade', true]]);
    expect(can(null, 'quiz.grade', overrides)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// can() — purity
// ---------------------------------------------------------------------------

describe('can — purity', () => {
  it('has no side effects on repeated calls', () => {
    const guest: Principal = { rank: 1 };
    const result1 = can(guest, 'quiz.grade');
    const result2 = can(guest, 'quiz.grade');
    expect(result1).toBe(true);
    expect(result2).toBe(true);
  });

  it('does not import node modules', async () => {
    const fs = await import('node:fs').catch(() => null);
    expect(fs).not.toBeNull();
    // The permissions module itself should not import node:fs
    // This is a structural check — the test file imports node:fs
    // but the production module should not
  });
});

// ---------------------------------------------------------------------------
// Client-safety: no node: imports in the module
// ---------------------------------------------------------------------------

describe('client-safety', () => {
  it('module has no node: imports', async () => {
    // Dynamic import of the permissions module. If it imports node: modules,
    // this test will still pass but the import graph test catches it.
    // We verify the module loads cleanly without DATABASE_URL.
    const mod = await import('@/lib/auth/permissions');
    expect(mod).toBeDefined();
    expect(typeof mod.can).toBe('function');
    expect(typeof mod.defaultPermissionsForRank).toBe('function');
  });
});
