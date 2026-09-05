/**
 * Integration gate: drives the real quiz-grade and chat route stacks with
 * MINIMAL_MODE=true against a hermetic scratch PostgreSQL database.
 *
 * The test provisions its own scratch database, runs the ensure chain there,
 * seeds roles there, creates a verified user via the in-process auth server,
 * and calls the real route handlers directly (no HTTP to a dev server).
 *
 * Mocks ONLY callLLM at the model boundary. The guard seam
 * (requirePermission, getSession) is never mocked.
 *
 * Gate: LIVE_OK
 */

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const PG_URL = process.env.PG_CONTRACT_URL;
const SCRATCH_DB = `live_wire_test_${Date.now()}`;

// Skip entire suite when the gate env is not set
describe.skipIf(!PG_URL || process.env.MINIMAL_MODE !== 'true')(
  'live-wire: MINIMAL_MODE guard on real routes',
  () => {
    let pool: Pool;
    let guestToken: string | undefined;
    let guestUserId: string;

    beforeAll(async () => {
      // 1. Create scratch database from the maintenance DB
      const adminPool = new Pool({ connectionString: PG_URL });
      await adminPool.query(`CREATE DATABASE "${SCRATCH_DB}"`);
      await adminPool.end();

      // 2. Point DATABASE_URL at the scratch DB for all runtime modules.
      // Provide model + dummy key so resolveModelFromRequest succeeds.
      // callLLM is mocked anyway; the model value and API key are irrelevant.
      process.env.DATABASE_URL = PG_URL!.replace(/\/[^/?]+$/, `/${SCRATCH_DB}`);
      process.env.DEFAULT_MODEL = 'openai/gpt-4o-mini';
      process.env.OPENAI_API_KEY = 'sk-test-dummy-key';

      pool = new Pool({ connectionString: process.env.DATABASE_URL });

      // 3. Ensure auth schema (idempotent) on the scratch DB
      const { ensureAuthSchema } = await import('@/lib/auth/schema');
      await ensureAuthSchema(pool);

      // 4. Seed system roles
      await pool.query(`
        INSERT INTO roles (id, name, rank, "isSystem")
        VALUES
          ('role-guest', 'guest', 1, true),
          ('role-learner', 'learner', 2, true),
          ('role-creator', 'creator', 3, true),
          ('role-admin', 'admin', 4, true)
        ON CONFLICT (name) DO UPDATE SET rank = EXCLUDED.rank;
      `);

      // 5. Create in-process auth server
      const { createAuthServer } = await import('@/lib/auth/server');
      const auth = createAuthServer({ pool, secret: 'dev-secret-change-me' });

      // 6. Sign up through better-auth API (creates user + account in correct format)
      const email = `live-wire-guest-${Date.now()}@test.example`;
      const signUpResp = await auth.apiCall('/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'live-wire-guest', email, password: 'TestPassword123!' }),
      });
      const signUpData = (await signUpResp.json()) as Record<string, unknown>;
      const newUser = signUpData.user as Record<string, unknown> | undefined;
      expect(newUser).toBeDefined();
      guestUserId = String(newUser!.id);

      // 7. Manually verify the email (bypass better-auth verification flow)
      await pool.query(`UPDATE "user" SET "emailVerified" = true WHERE id = $1`, [guestUserId]);

      // 8. Assign guest role (may already be assigned by better-auth hook)
      await pool.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, 'role-guest')
         ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
        [guestUserId],
      );

      // 9. Sign in to get session token
      const signInResp = await auth.apiCall('/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'TestPassword123!' }),
      });
      // Extract the signed session cookie from the Set-Cookie header.
      // better-auth signs the raw token before putting it in the cookie.
      // The raw token from the JSON body won't match the DB lookup.
      const setCookie = signInResp.headers.get('set-cookie') ?? '';
      const cookieMatch = setCookie.match(/better-auth\.session_token=([^;]+)/);
      guestToken = cookieMatch ? cookieMatch[1] : undefined;
      expect(guestToken).toBeDefined();
    });

    afterAll(async () => {
      // Clean up test data
      if (guestUserId && pool) {
        await pool.query('DELETE FROM quiz_grade_quota WHERE user_id = $1', [guestUserId]);
        await pool.query('DELETE FROM user_roles WHERE user_id = $1', [guestUserId]);
        await pool.query('DELETE FROM session WHERE "userId" = $1', [guestUserId]);
        await pool.query('DELETE FROM account WHERE "userId" = $1', [guestUserId]);
        await pool.query('DELETE FROM "user" WHERE id = $1', [guestUserId]);
      }

      // Close the local test pool first
      if (pool) await pool.end();

      // Close the cached app-side pool so no connections to the scratch DB remain.
      // This prevents unhandled errors when we terminate connections below.
      const { resetServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
      await resetServerPersistenceProvider();

      // Point DATABASE_URL back at the maintenance DB so that
      // getServerPersistenceProvider creates a new provider for the new URL.
      process.env.DATABASE_URL = PG_URL;

      // Drop the scratch database. Give the DB a moment for cached
      // connections to close, then force-terminate any stragglers.
      await new Promise((r) => setTimeout(r, 200));
      const adminPool = new Pool({ connectionString: PG_URL });
      await adminPool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [SCRATCH_DB],
      );
      await adminPool.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
      await adminPool.end();
    });

    it('anonymous caller receives 403 on chat route when MINIMAL_MODE=true', async () => {
      const { POST } = await import('@/app/api/chat/route');

      const request = new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [],
          storeState: { stage: 'chat', scenes: [], currentSceneId: null, mode: 'interactive' },
          config: { agentIds: ['test'] },
        }),
      });

      const response = await (POST as Function)(request);
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.code).toBe('permission_denied');
    });

    it('guest grades 5 quizzes, 6th returns 429 quota_exhausted', async () => {
      // Mock callLLM at the model boundary only
      const mockCallLLM = vi.fn().mockResolvedValue({
        text: JSON.stringify({ score: 8, comment: 'Good answer.' }),
      });

      vi.doMock('@/lib/ai/llm', () => ({ callLLM: mockCallLLM }));

      const { POST } = await import('@/app/api/quiz-grade/route');

      const makeRequest = () =>
        new Request('http://localhost/api/quiz-grade', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `better-auth.session_token=${guestToken}`,
          },
          body: JSON.stringify({
            question: 'What is 2+2?',
            userAnswer: '4',
            points: 10,
          }),
        });

      // First 5 should succeed
      for (let i = 0; i < 5; i++) {
        const response = await (POST as Function)(makeRequest());
        expect(response.status).toBe(200);
      }

      // 6th should return 429
      const response6 = await (POST as Function)(makeRequest());
      expect(response6.status).toBe(429);
      const body6 = await response6.json();
      expect(body6.code).toBe('quota_exhausted');

      vi.doUnmock('@/lib/ai/llm');
    });
  },
);
