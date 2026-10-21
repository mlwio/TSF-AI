import { NextResponse, type NextRequest } from 'next/server';

import { DASHBOARD_SESSION_COOKIE, isValidSessionToken } from '@/lib/auth';

/**
 * The dashboard holds every customer conversation, so the whole UI sits behind
 * a session cookie. This is the first line of defence only — Server Actions are
 * POSTs to the route they are used on and are skipped entirely by an excluded
 * matcher, so `src/app/actions.ts` re-checks the same cookie on every write.
 *
 * In Next 16 this file replaces `middleware.ts` and always runs on Node.js.
 */
export function proxy(request: NextRequest) {
  const token = request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value;

  if (isValidSessionToken(token)) {
    return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  /**
   * `/api` is excluded on purpose: the Meta webhook proves itself with an HMAC
   * signature and /api/messages/send with the x-admin-key header. `/login` is
   * excluded or the redirect would loop.
   */
  matcher: [
    '/((?!api|login|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)',
  ],
};
