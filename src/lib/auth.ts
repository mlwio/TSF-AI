import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Password gate for the dashboard.
 *
 * Deliberately kept free of any `next/*` imports: the same helpers are used by
 * the Proxy (which runs before routing) and by the Server Actions (which run
 * inside a route), and the Proxy docs warn against sharing modules with the
 * render code.
 *
 * The cookie never carries the password itself — it carries an HMAC derived
 * from it, so a stolen cookie cannot be replayed against /api/messages/send.
 */

export const DASHBOARD_SESSION_COOKIE = 'unified_inbox_session';

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/** Change this string to invalidate every existing session cookie. */
const SESSION_CONTEXT = 'unified-inbox-dashboard-v1';

/**
 * Fails closed: no password configured means no session can ever be valid.
 */
export function dashboardPassword(): string | null {
  const value = process.env.ADMIN_API_KEY || process.env.NEXT_SERVER_ADMIN_API_KEY;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function sessionTokenFor(password: string): string {
  return createHmac('sha256', password).update(SESSION_CONTEXT).digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}

export function passwordMatches(candidate: string): boolean {
  const password = dashboardPassword();
  return password !== null && constantTimeEquals(candidate, password);
}

export function isValidSessionToken(
  token: string | null | undefined,
): boolean {
  const password = dashboardPassword();
  if (!password || !token) return false;

  return constantTimeEquals(token, sessionTokenFor(password));
}
