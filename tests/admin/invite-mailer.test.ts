/**
 * Hermetic unit test for the invite-mailer gate.
 *
 * Verifies:
 * - createMailer with MAIL_TRANSPORT=console logs the invite link
 * - createMailer with MAIL_TRANSPORT=smtp creates a smtp transport with sendInviteLink
 * - createMailer with MAIL_TRANSPORT=resend creates a resend transport with sendInviteLink
 * - All transports implement the sendInviteLink method
 *
 * The gate extends the env-clear prefix with the mailer variables:
 * MAIL_TRANSPORT AUTH_SECRET RESEND_API_KEY SMTP_HOST SMTP_PORT
 * SMTP_USER SMTP_PASS MAIL_FROM
 */

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
  'MAIL_TRANSPORT',
  'AUTH_SECRET',
  'RESEND_API_KEY',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'MAIL_FROM',
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

describe('INVITE_MAILER_OK: invite-mailer gate', () => {
  describe('INVITE_MAILER_OK: console transport', () => {
    it('logs the invite link to console', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { createMailer } = await import('@/lib/auth/mailer');
      const mailer = createMailer({ MAIL_TRANSPORT: 'console' });
      await mailer.sendInviteLink('test@example.com', 'http://localhost/invite/accept?code=abc');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[mailer] Invite link for test@example.com'),
      );
      logSpy.mockRestore();
    });
  });

  describe('INVITE_MAILER_OK: smtp transport', () => {
    it('sends invite via smtp transport', async () => {
      const sendMail = vi.fn(async () => ({}));
      const createTransport = vi.fn(() => ({ sendMail })) as any;
      const { createMailer } = await import('@/lib/auth/mailer');
      const mailer = createMailer(
        {
          MAIL_TRANSPORT: 'smtp',
          SMTP_HOST: 'smtp.test.com',
          SMTP_PORT: '587',
          SMTP_USER: 'user',
          SMTP_PASS: 'pass',
          MAIL_FROM: 'test@example.com',
        },
        { createTransport },
      );
      await mailer.sendInviteLink('invitee@test.com', 'http://localhost/invite/accept?code=xyz');
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'invitee@test.com',
          subject: expect.stringContaining('invited'),
        }),
      );
    });
  });

  describe('INVITE_MAILER_OK: resend transport', () => {
    it('sends invite via resend transport', async () => {
      const send = vi.fn(async () => ({}));
      // The Resend mock must be a class (not an arrow fn) so it works with `new`.
      const Resend = vi.fn(function (this: any) {
        this.emails = { send };
      }) as any;
      const { createMailer } = await import('@/lib/auth/mailer');
      const mailer = createMailer(
        {
          MAIL_TRANSPORT: 'resend',
          RESEND_API_KEY: 're_test_key',
          MAIL_FROM: 'test@example.com',
        },
        { Resend },
      );
      await mailer.sendInviteLink('invitee@test.com', 'http://localhost/invite/accept?code=xyz');
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'invitee@test.com',
          subject: expect.stringContaining('invited'),
        }),
      );
    });
  });

  describe('INVITE_MAILER_OK: sendInviteLink export', () => {
    it('exports sendInviteLink from mailer', async () => {
      const mod = await import('@/lib/auth/mailer');
      expect(typeof mod.sendInviteLink).toBe('function');
    });
  });

  describe('INVITE_MAILER_OK: Mailer interface has sendInviteLink', () => {
    it('console mailer has sendInviteLink', async () => {
      const { createMailer } = await import('@/lib/auth/mailer');
      const mailer = createMailer({ MAIL_TRANSPORT: 'console' });
      expect(typeof mailer.sendInviteLink).toBe('function');
    });
  });
});
