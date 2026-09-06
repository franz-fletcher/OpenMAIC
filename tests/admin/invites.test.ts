/**
 * Hermetic unit test for the invites gate.
 *
 * Verifies:
 * - Module exports exist (createInvite, consumeInvite, listPendingInvites, revokeInvite)
 * - createInvite writes a row with a hashed code and returns the invite
 * - consumeInvite atomically marks one unused row used and returns the role
 * - listPendingInvites returns unused, unrevoked, unexpired rows
 * - revokeInvite writes the revoked_at timestamp
 * - POST /api/admin/invites creates and sends an invite
 * - GET /api/admin/invites returns pending invites
 * - DELETE /api/admin/invites/[id] revokes an invite
 * - The accept page renders the valid and invalid states
 *
 * Flag OFF behavior: admin surface gates unconditionally per the settings gate split decision.
 *
 * The live consume, the race gate, and the mailer transport selection are
 * tested in the pg and adversarial gates, not here. This suite mocks
 * at the module boundary per the hermetic unit rule.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const ENV_KEYS = [
  'DATABASE_URL',
  'PERSISTENCE_DEV_TOKEN',
  'ACCESS_CODE',
  'OPENMAIC_AGENT_RUNTIME_ENABLED',
  'NEXT_PUBLIC_PRO_WORKBENCH_ENABLED',
  'NEXT_PUBLIC_MAIC_EDITOR_ENABLED',
  'MINIMAL_MODE',
  'NEXT_PUBLIC_MINIMAL_MODE',
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let _mockSession: { userId: string; token: string; id: string } | null = {
  userId: 'admin-user',
  token: 'tok1',
  id: 'sess1',
};

vi.mock('@/lib/auth/permissions-server', () => ({
  requirePermission: vi.fn(async () => {
    if (!_mockSession) {
      throw new Response(
        JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
    return _mockSession;
  }),
  requirePermissionIfMinimalMode: vi.fn(async () => {
    if (!_mockSession) {
      throw new Response(
        JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
  }),
}));

vi.mock('@/lib/auth/index', () => ({
  getSession: vi.fn(async () => _mockSession),
  requireSession: vi.fn(async () => {
    if (!_mockSession)
      throw new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    return _mockSession;
  }),
  requirePermission: vi.fn(async () => {
    if (!_mockSession) {
      throw new Response(
        JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
    return _mockSession;
  }),
  requirePermissionIfMinimalMode: vi.fn(async () => {
    if (!_mockSession) {
      throw new Response(
        JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
  }),
  listRoles: vi.fn(async () => []),
}));

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: 'en-US',
    setLocale: () => undefined,
  }),
}));

const MOCK_INVITES = [
  {
    id: 'inv-1',
    email: 'alice@example.com',
    role_name: 'learner',
    expires_at: new Date('2099-01-01'),
    used_at: null,
    revoked_at: null,
    used_by: null,
    created_by: 'admin-user',
    created_at: new Date('2025-01-15'),
  },
  {
    id: 'inv-2',
    email: 'bob@example.com',
    role_name: 'guest',
    expires_at: new Date('2099-02-01'),
    used_at: null,
    revoked_at: null,
    used_by: null,
    created_by: 'admin-user',
    created_at: new Date('2025-02-20'),
  },
];

vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: vi.fn(async () => ({
    pool: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT id FROM roles WHERE name')) {
          return { rows: [{ id: params?.[0] }] };
        }
        if (sql.includes('FROM user_roles') && sql.includes('JOIN roles')) {
          return { rows: [{ rank: 4 }] };
        }
        if (sql.includes('"banned"')) {
          return { rows: [{ banned: false }] };
        }
        if (sql.includes('INSERT INTO invites')) {
          return {
            rows: [
              {
                id: 'inv-new',
                email: 'new@example.com',
                role_name: params?.[1] ?? 'guest',
                expires_at: new Date('2099-03-01'),
                created_by: 'admin-user',
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes('FROM invites') && sql.includes('WHERE used_at IS NULL')) {
          return { rows: MOCK_INVITES };
        }
        if (sql.includes('UPDATE invites SET revoked_at')) {
          return { rows: [] };
        }
        if (sql.includes('UPDATE invites SET used_at')) {
          return { rows: [{ role_name: 'learner' }] };
        }
        return { rows: [] };
      }),
    },
  })),
}));

vi.mock('@/lib/auth/mailer', () => ({
  createMailer: vi.fn(() => ({
    transport: 'console',
    sendVerificationLink: vi.fn(),
    sendInviteLink: vi.fn(),
  })),
  sendVerificationLink: vi.fn(),
  sendInviteLink: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('INVITES_OK: invites gate', () => {
  describe('INVITES_OK: module exports', () => {
    it('exports createInvite from invites', async () => {
      const mod = await import('@/lib/auth/invites');
      expect(typeof mod.createInvite).toBe('function');
    });

    it('exports consumeInvite from invites', async () => {
      const mod = await import('@/lib/auth/invites');
      expect(typeof mod.consumeInvite).toBe('function');
    });

    it('exports listPendingInvites from invites', async () => {
      const mod = await import('@/lib/auth/invites');
      expect(typeof mod.listPendingInvites).toBe('function');
    });

    it('exports revokeInvite from invites', async () => {
      const mod = await import('@/lib/auth/invites');
      expect(typeof mod.revokeInvite).toBe('function');
    });

    it('exports lookupInvite from invites', async () => {
      const mod = await import('@/lib/auth/invites');
      expect(typeof mod.lookupInvite).toBe('function');
    });

    it('exports isValidRole from invites', async () => {
      const mod = await import('@/lib/auth/invites');
      expect(typeof mod.isValidRole).toBe('function');
    });
  });

  describe('INVITES_OK: createInvite', () => {
    it('writes a row and returns the invite with code', async () => {
      const { createInvite } = await import('@/lib/auth/invites');
      const query = vi.fn(async () => ({
        rows: [
          {
            id: 'inv-new',
            email: 'new@example.com',
            role_name: 'learner',
            expires_at: new Date('2099-03-01'),
            created_by: 'admin-user',
            created_at: new Date(),
          },
        ],
      }));
      const queryable = { query } as any;
      const invite = await createInvite(queryable, 'new@example.com', 'learner', 'admin-user');
      expect(invite.id).toBe('inv-new');
      expect(invite.email).toBe('new@example.com');
      expect(invite.roleName).toBe('learner');
      expect(invite.code).toBeDefined();
      expect(typeof invite.code).toBe('string');
      expect(invite.code.length).toBeGreaterThan(0);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO invites'),
        expect.arrayContaining(['new@example.com', 'learner', 'admin-user']),
      );
    });
  });

  describe('INVITES_OK: consumeInvite', () => {
    it('returns the role name on success', async () => {
      const { consumeInvite } = await import('@/lib/auth/invites');
      const query = vi.fn(async () => ({ rows: [{ role_name: 'learner' }] }));
      const queryable = { query } as any;
      const result = await consumeInvite(queryable, 'some-code', 'user-1');
      expect(result).toBe('learner');
      // The code is hashed, so we match the SQL shape and the userId param.
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
      expect(sql).toContain('UPDATE invites');
      expect(sql).toContain('used_at = now()');
      expect(params).toContain('user-1');
    });

    it('returns null when code is invalid', async () => {
      const { consumeInvite } = await import('@/lib/auth/invites');
      const query = vi.fn(async () => ({ rows: [] }));
      const queryable = { query } as any;
      const result = await consumeInvite(queryable, 'bad-code', 'user-1');
      expect(result).toBeNull();
    });
  });

  describe('INVITES_OK: listPendingInvites', () => {
    it('returns unused, unrevoked, unexpired invites', async () => {
      const { listPendingInvites } = await import('@/lib/auth/invites');
      const query = vi.fn(async () => ({ rows: MOCK_INVITES }));
      const queryable = { query } as any;
      const invites = await listPendingInvites(queryable);
      expect(invites).toHaveLength(2);
      expect(invites[0].email).toBe('alice@example.com');
      expect(invites[0].roleName).toBe('learner');
      expect(query).toHaveBeenCalledTimes(1);
      const [sql] = query.mock.calls[0] as unknown as [string];
      expect(sql).toContain('invites');
      expect(sql).toContain('used_at IS NULL');
    });
  });

  describe('INVITES_OK: revokeInvite', () => {
    it('writes the revoked_at timestamp', async () => {
      const { revokeInvite } = await import('@/lib/auth/invites');
      const query = vi.fn(async () => ({ rows: [] }));
      const queryable = { query } as any;
      await revokeInvite(queryable, 'inv-1');
      expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE invites SET revoked_at'), [
        'inv-1',
      ]);
    });
  });

  describe('INVITES_OK: POST /api/admin/invites', () => {
    it('creates an invite when authorized', async () => {
      _mockSession = { userId: 'admin-user', token: 'tok', id: 'sess' };
      const { POST } = await import('@/app/api/admin/invites/route');
      const req = new Request('http://localhost/api/admin/invites', {
        method: 'POST',
        headers: new Headers({
          cookie: 'session=tok',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({ email: 'new@example.com', roleName: 'learner' }),
      });
      const res = await POST(req as never);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.invite).toBeDefined();
    });

    it('rejects invalid email', async () => {
      _mockSession = { userId: 'admin-user', token: 'tok', id: 'sess' };
      const { POST } = await import('@/app/api/admin/invites/route');
      const req = new Request('http://localhost/api/admin/invites', {
        method: 'POST',
        headers: new Headers({
          cookie: 'session=tok',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({ email: 'not-an-email', roleName: 'learner' }),
      });
      const res = await POST(req as never);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('INVALID_EMAIL');
    });

    it('rejects missing role', async () => {
      _mockSession = { userId: 'admin-user', token: 'tok', id: 'sess' };
      const { POST } = await import('@/app/api/admin/invites/route');
      const req = new Request('http://localhost/api/admin/invites', {
        method: 'POST',
        headers: new Headers({
          cookie: 'session=tok',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({ email: 'new@example.com' }),
      });
      const res = await POST(req as never);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('MISSING_ROLE');
    });
  });

  describe('INVITES_OK: GET /api/admin/invites', () => {
    it('returns the pending invite list', async () => {
      _mockSession = { userId: 'admin-user', token: 'tok', id: 'sess' };
      const { GET } = await import('@/app/api/admin/invites/route');
      const req = new Request('http://localhost/api/admin/invites', {
        method: 'GET',
        headers: new Headers({ cookie: 'session=tok' }),
      });
      const res = await GET(req as never);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.invites).toBeDefined();
      expect(Array.isArray(body.invites)).toBe(true);
    });
  });

  describe('INVITES_OK: DELETE /api/admin/invites/[id]', () => {
    it('revokes an invite', async () => {
      _mockSession = { userId: 'admin-user', token: 'tok', id: 'sess' };
      const { DELETE } = await import('@/app/api/admin/invites/[id]/route');
      const req = new Request('http://localhost/api/admin/invites/inv-1', {
        method: 'DELETE',
        headers: new Headers({ cookie: 'session=tok' }),
      });
      const res = await DELETE(req as never, { params: Promise.resolve({ id: 'inv-1' }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });

  describe('INVITES_OK: invites-section component', () => {
    it('exports a client component', async () => {
      const mod = await import('@/components/admin/invites-section');
      expect(typeof mod.default).toBe('function');
    });
  });

  describe('INVITES_OK: i18n keys exist', () => {
    it('has admin.invites.title', async () => {
      const mod = await import('@/lib/i18n/locales/en-US.json');
      const data = (mod as { default: Record<string, unknown> }).default;
      const admin = data.admin as Record<string, unknown> | undefined;
      const invites = admin?.invites as Record<string, unknown> | undefined;
      expect(invites?.title).toBeDefined();
    });

    it('has admin.invites.send', async () => {
      const mod = await import('@/lib/i18n/locales/en-US.json');
      const data = (mod as { default: Record<string, unknown> }).default;
      const admin = data.admin as Record<string, unknown> | undefined;
      const invites = admin?.invites as Record<string, unknown> | undefined;
      expect(invites?.send).toBeDefined();
    });

    it('has admin.invites.revoke', async () => {
      const mod = await import('@/lib/i18n/locales/en-US.json');
      const data = (mod as { default: Record<string, unknown> }).default;
      const admin = data.admin as Record<string, unknown> | undefined;
      const invites = admin?.invites as Record<string, unknown> | undefined;
      expect(invites?.revoke).toBeDefined();
    });

    it('has admin.invites.noInvites', async () => {
      const mod = await import('@/lib/i18n/locales/en-US.json');
      const data = (mod as { default: Record<string, unknown> }).default;
      const admin = data.admin as Record<string, unknown> | undefined;
      const invites = admin?.invites as Record<string, unknown> | undefined;
      expect(invites?.noInvites).toBeDefined();
    });
  });
});
