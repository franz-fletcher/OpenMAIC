/**
 * Invite validation route. Read-only lookup of an invite code.
 *
 * GET: validates the code and returns the invite info (email, role, expiry).
 * Returns 404 for invalid, expired, used, or revoked codes.
 *
 * No auth required. The code itself is the credential.
 */
import { NextRequest } from 'next/server';
import { lookupInvite } from '@/lib/auth/invites';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get('code');

  if (!code) {
    return Response.json(
      { success: false, code: 'MISSING_CODE', message: 'Invite code is required' },
      { status: 400 },
    );
  }

  try {
    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const invite = await lookupInvite(pool, code);

    if (!invite) {
      return Response.json(
        { success: false, code: 'INVALID_INVITE', message: 'Invite is invalid or has expired' },
        { status: 404 },
      );
    }

    return Response.json({
      success: true,
      invite: {
        email: invite.email,
        roleName: invite.roleName,
        expiresAt: invite.expiresAt.toISOString(),
      },
    });
  } catch {
    return Response.json(
      { success: false, code: 'SERVER_ERROR', message: 'Failed to validate invite' },
      { status: 500 },
    );
  }
}
