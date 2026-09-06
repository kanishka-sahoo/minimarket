/** Only configured deployment origins are trusted, never a request's Host header. */
export function resolveOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const configured =
    env.APP_ORIGIN ||
    (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined) ||
    env.RENDER_EXTERNAL_URL ||
    'http://localhost:4000';
  const url = new URL(configured);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path, query, or credentials.');
  return url.origin;
}
