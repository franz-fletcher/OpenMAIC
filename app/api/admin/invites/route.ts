/**
 * Admin invite management routes. Gated by users.manage.
 *
 * POST: creates an invite for an email and role, sends the accept link.
 * GET: returns pending invites.
 *
 * The guard call is wrapped in the nested Response-rethrow catch so the
 * typed 403 survives both outer catch layers (the route catch and the
 * withRequestOwnerId callback catch).
 */
import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { createInvite, listPendingInvites, isValidRole } from '@/lib/auth/invites';
import { sendInviteLink } from '@/lib/auth/mailer';
import { createMailer } from '@/lib/auth/mailer';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

const DEFAULT_EXPIRY_DAYS = 7;

export async function POST(req: NextRequest): Promise<Response> {
  try {
    let session;
    try {
      session = await requirePermission(req.headers, 'users.manage');
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    const body = (await req.json()) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const roleName = typeof body.roleName === 'string' ? body.roleName.trim() : '';

    if (!email || !email.includes('@')) {
      return Response.json(
        { success: false, code: 'INVALID_EMAIL', message: 'A valid email is required' },
        { status: 400 },
      );
    }

    if (!roleName) {
      return Response.json(
        { success: false, code: 'MISSING_ROLE', message: 'Role name is required' },
        { status: 400 },
      );
    }

    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');

    if (!(await isValidRole(pool, roleName))) {
      return Response.json(
        { success: false, code: 'INVALID_ROLE', message: 'Role does not exist' },
        { status: 400 },
      );
    }

    const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const invite = await createInvite(pool, email, roleName, session.userId, expiresAt);

    // Build the accept URL and send through the mailer.
    const origin = new URL(req.url).origin;
    const acceptUrl = `${origin}/invite/accept?code=${invite.code}`;

    const mailerEnv = {
      MAIL_TRANSPORT: process.env.MAIL_TRANSPORT,
      SMTP_HOST: process.env.SMTP_HOST,
      SMTP_PORT: process.env.SMTP_PORT,
      SMTP_USER: process.env.SMTP_USER,
      SMTP_PASS: process.env.SMTP_PASS,
      MAIL_FROM: process.env.MAIL_FROM,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
    };
    const mailer = createMailer(mailerEnv);
    await sendInviteLink(mailer, email, acceptUrl);

    return Response.json({
      success: true,
      invite: {
        id: invite.id,
        email: invite.email,
        roleName: invite.roleName,
        expiresAt: invite.expiresAt.toISOString(),
        createdAt: invite.createdAt.toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    let session;
    try {
      session = await requirePermission(req.headers, 'users.manage');
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const invites = await listPendingInvites(pool);

    return Response.json({ success: true, invites });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
