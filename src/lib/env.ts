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
        `Set it in .env.local for local development, and in the host's ` +
        `environment variables for a deployment.`,
    );
  }

  return value;
}
