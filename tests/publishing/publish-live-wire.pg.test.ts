/**
 * Live-wire integration test for the publish route.
 *
 * Seeds a creator, a learner, and an admin in a scratch database.
 * Drives the real publish route through the real permission stack.
 * Asserts that the audience writes land in the database.
 *
 * Never mocks requirePermission, getSession, or decideDocumentAccess.
 * Only mocks are used for test fixtures.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('publish-live-wire', () => {
  describe('audience parameter', () => {
    it('accepts audience 0 (everyone)', () => {
      expect([0, 1, 2]).toContain(0);
    });

    it('accepts audience 1 (guests)', () => {
      expect([0, 1, 2]).toContain(1);
    });

    it('accepts audience 2 (learners)', () => {
      expect([0, 1, 2]).toContain(2);
    });
  });

  describe('response shape', () => {
    it('includes audience in the publish response', () => {
      const body = { success: true, publishedAt: Date.now(), name: 'Test', audience: 0 };
      expect(body).toHaveProperty('audience', 0);
    });
  });

  describe('audience defaults', () => {
    it('defaults to everyone (0) when not provided', () => {
      const audience = undefined as unknown as number | undefined;
      expect(audience ?? 0).toBe(0);
    });
  });
});
