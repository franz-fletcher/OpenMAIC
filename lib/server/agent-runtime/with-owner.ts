import { getSession } from '@/lib/auth';
import { resolveRequestOwnerId } from './owner';

type OwnerHandler = (ownerId: string, responseHeaders: Headers) => Promise<Response>;

/**
 * Resolve the owner identity and run a handler with its response
 * headers.
 *
 * If the request carries a valid session, the authenticated user id
 * (`user:<userId>`) is threaded as the owner. The anonymous cookie
 * identity applies only when the request carries no session cookie at
 * all. A request with a cookie but a failed session lookup returns 401
 * rather than silently falling back to anon, preventing ownership
 * corruption on the first PUT after a cold boot.
 *
 * The Set-Cookie minted by resolveRequestOwnerId must ride every response,
 * including 4xx and 5xx: a client that retries after an error keeps the same
 * owner partition, while a 500 that dropped the cookie would silently make
 * the retry a different anonymous owner.
 */
export async function withRequestOwnerId(
  req: Pick<Request, 'headers'>,
  handler: OwnerHandler,
): Promise<Response> {
  const responseHeaders = new Headers();

  // Try to get the authenticated session. If present, use user:<id>.
  // The anonymous cookie identity applies only when the request carries
  // no session cookie at all. A request with a cookie but a failed
  // session lookup must not silently resolve to anon, because that
  // corrupts ownership on the first PUT after a cold boot.
  let ownerId: string;
  const cookieHeader = req.headers.get('cookie');
  const hasSessionCookie = cookieHeader?.includes('better-auth.session_token=') ?? false;
  try {
    const session = await getSession(req.headers);
    if (session) {
      ownerId = `user:${session.userId}`;
    } else if (hasSessionCookie) {
      // Cookie present but session invalid or expired. Do not fall back
      // to anon. Propagate a 401 so the client re-authenticates.
      throw new Response(JSON.stringify({ error: 'session_invalid' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    } else {
      ownerId = resolveRequestOwnerId(req, responseHeaders);
    }
  } catch (error) {
    // If the error is a Response (typed 401 from above), re-throw it.
    if (error instanceof Response) throw error;
    // Session lookup failed for an unexpected reason. Only fall back to
    // anon when there is no session cookie.
    if (hasSessionCookie) {
      throw new Response(JSON.stringify({ error: 'session_lookup_failed' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    ownerId = resolveRequestOwnerId(req, responseHeaders);
  }

  try {
    return await handler(ownerId, responseHeaders);
  } catch (error) {
    console.error('[agent-runtime] request failed under an owner', error);
    return new Response('Internal Server Error', { status: 500, headers: responseHeaders });
  }
}
