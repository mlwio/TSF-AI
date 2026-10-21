/**
 * Reads a required environment variable, failing loudly and early with a
 * message that tells you exactly what to do.
 *
 * Everything here is evaluated lazily (inside functions, at request time) so
 * that `next build` never explodes just because .env.local is absent.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        `Copy .env.local.example to .env.local and fill in the real value.`,
    );
  }

  return value;
}
