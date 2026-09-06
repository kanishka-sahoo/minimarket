import { randomBytes, createHash } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pool, assert } from './db.ts';
import { createAccount } from './exchange.ts';
import { resolveOrigin } from './config.ts';
export const origin = resolveOrigin();
const secure = origin.startsWith('https:');
const cookieOptions = { path: '/', httpOnly: true, secure, sameSite: 'lax' as const };
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const configuredAdmin = (email: string) =>
  (process.env.ADMIN_EMAILS ?? '')
    .toLowerCase()
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(email.toLowerCase());
export async function currentUser(req: FastifyRequest) {
  const token = req.cookies.session;
  if (!token) return null;
  const user =
    (
      await pool.query(
        'SELECT a.id,a.name,a.email,a.admin,a.cash,a.reserved,a.epoch,a.reset_used AS "resetUsed",a.subject LIKE \'test:%\' AS "testIdentity" FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now()',
        [hash(token)],
      )
    ).rows[0] ?? null;
  if (!user) return null;
  if (!user.testIdentity) {
    const admin = configuredAdmin(user.email);
    if (admin !== user.admin) {
      await pool.query('UPDATE accounts SET admin=$2 WHERE id=$1', [user.id, admin]);
      user.admin = admin;
    }
  }
  delete user.testIdentity;
  return user;
}
export async function authenticated(req: FastifyRequest) {
  const user = await currentUser(req);
  assert(user, 'Sign in to continue', 401);
  return user;
}
async function session(reply: FastifyReply, id: string) {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [hash(token), id],
  );
  reply.setCookie('session', token, { ...cookieOptions, maxAge: 30 * 86400 });
}
export async function registerAuth(app: FastifyInstance) {
  app.get('/api/me', async (req) => ({
    user: await currentUser(req),
    googleEnabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  }));
  app.get('/auth/google', async (_req, reply) => {
    assert(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      'Google sign-in is not configured on this installation',
      503,
    );
    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      origin + '/auth/google/callback',
    );
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    await pool.query('DELETE FROM oauth_states WHERE expires_at<now()');
    await pool.query(
      "INSERT INTO oauth_states(state_hash,verifier,expires_at) VALUES($1,$2,now()+interval '10 minutes')",
      [hash(state), verifier],
    );
    reply.setCookie('oauth_state', state, { ...cookieOptions, maxAge: 600 });
    return reply.redirect(
      client.generateAuthUrl({
        scope: ['openid', 'email', 'profile'],
        state,
        nonce: state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256' as never,
      }),
    );
  });
  app.get('/auth/google/callback', async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    assert(
      code && state && state === req.cookies.oauth_state,
      'Sign-in expired. Please try again.',
      400,
    );
    const pending = (
      await pool.query(
        'DELETE FROM oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING verifier',
        [hash(state)],
      )
    ).rows[0];
    assert(pending, 'Sign-in expired. Please try again.');
    reply.clearCookie('oauth_state', cookieOptions);
    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      origin + '/auth/google/callback',
    );
    const { tokens } = await client.getToken({ code, codeVerifier: pending.verifier });
    assert(tokens.id_token, 'Google did not return an identity');
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const p = ticket.getPayload();
    assert(
      p?.sub && p.email && p.email_verified && p.nonce === state,
      'Verified Google identity required',
      401,
    );
    const user = await createAccount(
      p.sub,
      p.email,
      p.name ?? p.email.split('@')[0],
      configuredAdmin(p.email),
    );
    await session(reply, user.id);
    return reply.redirect('/portfolio');
  });
  app.post('/api/logout', async (req, reply) => {
    if (req.cookies.session)
      await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hash(req.cookies.session)]);
    reply.clearCookie('session', cookieOptions);
    return { ok: true };
  });
  // Test-only login is unavailable in development and production, even if the flag is accidentally set.
  if (process.env.NODE_ENV === 'test' && process.env.ENABLE_TEST_AUTH === 'true')
    app.post('/api/test/login', async (req, reply) => {
      const { name, admin } = req.body as { name: string; admin?: boolean };
      assert(typeof name === 'string' && name.length < 80, 'Invalid test identity');
      const user = await createAccount(
        'test:' + name,
        name + '@example.test',
        name,
        admin === true,
      );
      await session(reply, user.id);
      return { user };
    });
}
