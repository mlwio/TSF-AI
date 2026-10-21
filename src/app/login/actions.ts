'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  DASHBOARD_SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  dashboardPassword,
  passwordMatches,
  sessionTokenFor,
} from '@/lib/auth';

export interface LoginState {
  error: string | null;
}

export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const password = dashboardPassword();

  // Log only the presence, not the value, for security
  if (!password) {
    console.error('[login] ADMIN_API_KEY is missing from process.env');
    return {
      error:
        'ADMIN_API_KEY is still missing on the server. Please check Vercel Settings > Environment Variables, ensure "Production" is checked, and then REDEPLOY your project.',
    };
  }

  const submitted = formData.get('password');
  const candidate = typeof submitted === 'string' ? submitted : '';

  if (!candidate || !passwordMatches(candidate)) {
    return { error: 'Incorrect password.' };
  }

  const store = await cookies();
  store.set(DASHBOARD_SESSION_COOKIE, sessionTokenFor(password), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  redirect('/');
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(DASHBOARD_SESSION_COOKIE);

  redirect('/login');
}
