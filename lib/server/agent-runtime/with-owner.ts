import { getSession } from '@/lib/auth';
import { resolveRequestOwnerId } from './owner';

type OwnerHandler = (ownerId: string, responseHeaders: Headers) => Promise<Response>;

/**
 * Resolve the owner identity and run a handler with its response
 * headers.
 *
 * If the request carries a valid session, the authenticated user id
 * (`user:<userId>`) is threaded as the owner. Otherwise the anonymous
 * cookie identity is used.
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
  // If not, fall back to the anonymous cookie.
  let ownerId: string;
  try {
    const session = await getSession(req.headers);
    if (session) {
      ownerId = `user:${session.userId}`;
    } else {
      ownerId = resolveRequestOwnerId(req, responseHeaders);
    }
  } catch {
    // Session lookup failed; fall back to anonymous identity.
    ownerId = resolveRequestOwnerId(req, responseHeaders);
  }

  try {
    return await handler(ownerId, responseHeaders);
  } catch (error) {
    console.error('[agent-runtime] request failed under an owner', error);
    return new Response('Internal Server Error', { status: 500, headers: responseHeaders });
  }
}
