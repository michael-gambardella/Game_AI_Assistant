import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { parse, serialize } from 'cookie';

/**
 * OAuth `state` for the account-linking flows (Discord, Twitch viewer, Twitch bot).
 *
 * The state is signed and expiring, and carries the Wingman username the link was started
 * for. The callback trusts that username only if:
 *   1. the HMAC signature checks out (nobody can craft a state naming someone else's account),
 *   2. it was issued for this flow (`purpose`) less than 10 minutes ago, and
 *   3. the same browser that started the flow presents the matching state cookie. That stops
 *      a leaked/intercepted state from being paired with someone else's authorization, and
 *      clearing the cookie in the callback makes each state single-use per browser.
 *
 * Everything lives in the signature and the user's cookie - no server memory - so the flow
 * survives restarts and works across multiple dynos.
 *
 * Login route:    const state = createOAuthState(username, 'discord');
 *                 bindOAuthStateToBrowser(res, 'discord', state);
 * Callback route: const username = verifyOAuthState(req.query.state, 'discord', req);
 *                 clearOAuthStateCookie(res, 'discord');
 */
const TTL_MS = 10 * 60 * 1000; // 10 minutes

const cookieName = (purpose: string) => `oauth_state_${purpose}`;
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

function sign(payload: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Adds a Set-Cookie header without overwriting any already set on the response. */
function appendSetCookie(res: NextApiResponse, cookie: string): void {
  const existing = res.getHeader('Set-Cookie');
  const list = Array.isArray(existing) ? existing.map(String) : existing ? [String(existing)] : [];
  res.setHeader('Set-Cookie', [...list, cookie]);
}

export function createOAuthState(username: string, purpose: string): string {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const expires = Date.now() + TTL_MS;
  const payload = `${purpose}.${nonce}.${expires}.${Buffer.from(username).toString('base64url')}`;
  return `${payload}.${sign(payload)}`;
}

/** Ties a state to this browser: the callback will only accept it alongside this cookie. */
export function bindOAuthStateToBrowser(res: NextApiResponse, purpose: string, state: string): void {
  appendSetCookie(res, serialize(cookieName(purpose), hash(state), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Lax: sent on the provider's top-level redirect back to our callback
    sameSite: 'lax',
    path: '/api',
    maxAge: TTL_MS / 1000,
  }));
}

/** Call in the callback once the state has been checked, so it can't be used again here. */
export function clearOAuthStateCookie(res: NextApiResponse, purpose: string): void {
  appendSetCookie(res, serialize(cookieName(purpose), '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api',
    maxAge: 0,
  }));
}

/**
 * Returns the username the state was issued for, or null if it's forged, tampered with,
 * expired, from another flow, or not presented by the browser that started the flow.
 */
export function verifyOAuthState(state: unknown, purpose: string, req: NextApiRequest): string | null {
  if (typeof state !== 'string') {
    return null;
  }
  const parts = state.split('.');
  if (parts.length !== 5) {
    return null;
  }
  const [statePurpose, nonce, expires, encodedUsername, signature] = parts;
  const payload = `${statePurpose}.${nonce}.${expires}.${encodedUsername}`;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null;
  }
  if (statePurpose !== purpose || !(Number(expires) > Date.now())) {
    return null;
  }

  // Same browser that started the flow
  const cookieValue = parse(req.headers.cookie || '')[cookieName(purpose)];
  const wanted = Buffer.from(hash(state));
  const got = Buffer.from(cookieValue || '');
  if (wanted.length !== got.length || !crypto.timingSafeEqual(wanted, got)) {
    return null;
  }

  const username = Buffer.from(encodedUsername, 'base64url').toString('utf8');
  return username || null;
}
