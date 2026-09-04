/**
 * Mailer transport for auth verification emails.
 *
 * Selects the transport by MAIL_TRANSPORT env: smtp (nodemailer), resend
 * (Resend SDK), or console fallback (logs the verification URL).
 */
import { createTransport } from 'nodemailer';

export interface MailerEnv {
  MAIL_TRANSPORT?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  MAIL_FROM?: string;
  RESEND_API_KEY?: string;
}

export interface Mailer {
  transport: 'console' | 'smtp' | 'resend';
  sendVerificationLink: (to: string, url: string) => Promise<void>;
}

/**
 * Creates a mailer with the selected transport.
 *
 * When MAIL_TRANSPORT is unset or unknown, falls back to console logging.
 */
export function createMailer(
  env: MailerEnv,
  deps: {
    createTransport?: typeof createTransport;
    Resend?: new (apiKey: string) => { emails: { send: (opts: unknown) => Promise<unknown> } };
  } = {},
): Mailer {
  const transport = (env.MAIL_TRANSPORT ?? 'console') as MailerEnv['MAIL_TRANSPORT'];
  const makeTransport = deps.createTransport ?? createTransport;

  if (transport === 'smtp') {
    return {
      transport: 'smtp',
      sendVerificationLink: async (to: string, url: string) => {
        const transporter = makeTransport({
          host: env.SMTP_HOST,
          port: Number(env.SMTP_PORT ?? 587),
          secure: Number(env.SMTP_PORT ?? 587) === 465,
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
        });

        await transporter.sendMail({
          from: env.MAIL_FROM ?? 'noreply@openmaic.com',
          to,
          subject: 'Verify your email address',
          html: `<p>Click the link to verify your email: <a href="${url}">Verify email</a></p>`,
        });
      },
    };
  }

  if (transport === 'resend') {
    const ResendClass = deps.Resend;
    if (!ResendClass) {
      throw new Error('Resend class not provided');
    }
    return {
      transport: 'resend',
      sendVerificationLink: async (to: string, url: string) => {
        const resend = new ResendClass(env.RESEND_API_KEY ?? '');

        await resend.emails.send({
          from: env.MAIL_FROM ?? 'noreply@openmaic.com',
          to,
          subject: 'Verify your email address',
          html: `<p>Click the link to verify your email: <a href="${url}">Verify email</a></p>`,
        });
      },
    };
  }

  // Console fallback: log the verification URL
  return {
    transport: 'console',
    sendVerificationLink: async (to: string, url: string) => {
      console.log(`[mailer] Verification link for ${to}: ${url}`);
    },
  };
}

/**
 * Sends a verification link through the selected mailer transport.
 */
export async function sendVerificationLink(mailer: Mailer, to: string, url: string): Promise<void> {
  await mailer.sendVerificationLink(to, url);
}
