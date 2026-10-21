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

  // Better to say the server is misconfigured than to pretend the password is
  // wrong and leave you guessing.
  if (!password) {
    return {
      error:
        'ADMIN_API_KEY is not set on this server. Add it to .env.local (or the Vercel project settings) and restart.',
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
