import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));

vi.mock('@/lib/auth/index', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    requirePermission: mocks.mockRequirePermission,
  };
});

describe('requirePermissionIfMinimalMode — flag-off parity', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.MINIMAL_MODE;
    delete process.env.MINIMAL_MODE;
    mocks.mockRequirePermission.mockReset();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.MINIMAL_MODE;
    else process.env.MINIMAL_MODE = original;
  });

  it('returns immediately without calling requirePermission when flag is unset', async () => {
    const { requirePermissionIfMinimalMode } = await import('@/lib/auth/permissions-server');
    const headers = new Headers();

    await requirePermissionIfMinimalMode(headers, 'course.create');

    expect(mocks.mockRequirePermission).not.toHaveBeenCalled();
  });

  it('returns immediately when MINIMAL_MODE is explicitly false', async () => {
    process.env.MINIMAL_MODE = 'false';
    const { requirePermissionIfMinimalMode } = await import('@/lib/auth/permissions-server');
    const headers = new Headers();

    await requirePermissionIfMinimalMode(headers, 'classroom.chat');

    expect(mocks.mockRequirePermission).not.toHaveBeenCalled();
  });

  it('does not touch the database or session', async () => {
    const { requirePermissionIfMinimalMode } = await import('@/lib/auth/permissions-server');
    const headers = new Headers();

    await requirePermissionIfMinimalMode(headers, 'tts.use');

    expect(mocks.mockRequirePermission).not.toHaveBeenCalled();
  });
});
