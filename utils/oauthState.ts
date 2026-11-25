import crypto from 'crypto';

/**
 * Signed, expiring OAuth `state` values that carry the Wingman username a link was started
 * for. The callback trusts the username only if the signature checks out, so nobody can
 * craft a state naming someone else's account (e.g. by building their own authorize URL).
 *
 * Stateless (HMAC with JWT_SECRET), so it works across dynos and restarts - unlike an
 * in-memory store. `purpose` keeps a state issued for one flow from being accepted by another.
 */
const TTL_MS = 10 * 60 * 1000; // 10 minutes

function sign(payload: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createOAuthState(username: string, purpose: string): string {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const expires = Date.now() + TTL_MS;
  const payload = `${purpose}.${nonce}.${expires}.${Buffer.from(username).toString('base64url')}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the username the state was issued for, or null if forged, tampered or expired. */
export function verifyOAuthState(state: unknown, purpose: string): string | null {
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
  const username = Buffer.from(encodedUsername, 'base64url').toString('utf8');
  return username || null;
}
