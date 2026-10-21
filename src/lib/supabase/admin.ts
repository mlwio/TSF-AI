import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { requireEnv } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * SERVER-ONLY Supabase client using the service_role key.
 *
 * The service_role key bypasses Row Level Security, so this must never be
 * imported into a Client Component or referenced with a NEXT_PUBLIC_ prefix.
 * It is intentionally NOT re-exported from any file that the browser imports.
 *
 * Created lazily and memoised, because module-level env access would run at
 * build time and throw when .env.local is not present.
 */
let cached: SupabaseClient<Database> | null = null;

export function getAdminClient(): SupabaseClient<Database> {
  if (!cached) {
    cached = createClient<Database>(
      requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          // The service role has no user session; skip the auth machinery.
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }

  return cached;
}
