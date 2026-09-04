import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createTransport } from 'nodemailer';

const mocks = vi.hoisted(() => {
  const sentEmails: Array<{ to: string; url: string }> = [];
  return {
    sentEmails,
    createTransport: vi.fn(() => ({
      sendMail: vi.fn(async (opts: { to: string; html: string }) => {
        sentEmails.push({ to: opts.to, url: opts.html });
      }),
    })) as unknown as typeof createTransport,
    Resend: vi.fn(function () {
      return {
        emails: {
          send: vi.fn(async (opts: { to: string; html: string }) => {
            sentEmails.push({ to: opts.to, url: opts.html });
          }),
        },
      };
    }),
  };
});

import { createMailer, sendVerificationLink } from '@/lib/auth/mailer';

describe('createMailer', () => {
  beforeEach(() => {
    mocks.sentEmails.length = 0;
    vi.clearAllMocks();
  });

  it('selects console transport when MAIL_TRANSPORT is unset', () => {
    const mailer = createMailer({});
    expect(mailer.transport).toBe('console');
  });

  it('selects smtp transport when MAIL_TRANSPORT=smtp', () => {
    const mailer = createMailer(
      {
        MAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'smtp.test.com',
        SMTP_PORT: '587',
        SMTP_USER: 'user',
        SMTP_PASS: 'pass',
        MAIL_FROM: 'test@test.com',
      },
      { createTransport: mocks.createTransport },
    );
    expect(mailer.transport).toBe('smtp');
  });

  it('selects resend transport when MAIL_TRANSPORT=resend', () => {
    const mailer = createMailer(
      {
        MAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: 're_test_key',
        MAIL_FROM: 'test@test.com',
      },
      { Resend: mocks.Resend as never },
    );
    expect(mailer.transport).toBe('resend');
  });
});

describe('sendVerificationLink', () => {
  beforeEach(() => {
    mocks.sentEmails.length = 0;
    vi.clearAllMocks();
  });

  it('sends verification link via console transport', async () => {
    const mailer = createMailer({});
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendVerificationLink(mailer, 'user@test.com', 'http://localhost/verify?token=abc');

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('sends verification link via smtp transport', async () => {
    const mailer = createMailer(
      {
        MAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'smtp.test.com',
        SMTP_PORT: '587',
        SMTP_USER: 'user',
        SMTP_PASS: 'pass',
        MAIL_FROM: 'test@test.com',
      },
      { createTransport: mocks.createTransport },
    );

    await sendVerificationLink(mailer, 'user@test.com', 'http://localhost/verify?token=abc');

    expect(mocks.createTransport).toHaveBeenCalled();
    expect(mocks.sentEmails).toHaveLength(1);
    expect(mocks.sentEmails[0].to).toBe('user@test.com');
  });

  it('sends verification link via resend transport', async () => {
    const mailer = createMailer(
      {
        MAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: 're_test_key',
        MAIL_FROM: 'test@test.com',
      },
      { Resend: mocks.Resend as never },
    );

    await sendVerificationLink(mailer, 'user@test.com', 'http://localhost/verify?token=abc');

    expect(mocks.Resend).toHaveBeenCalled();
    expect(mocks.sentEmails).toHaveLength(1);
    expect(mocks.sentEmails[0].to).toBe('user@test.com');
  });
});
