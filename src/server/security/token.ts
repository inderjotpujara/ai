import { Buffer } from 'node:buffer';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Mint a per-session bearer token at launch (256 bits of entropy, hex). */
export function mintSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export type TokenGuard = { verify(req: Request): boolean };

/** Constant-time bearer verification against the session token. */
export function createTokenGuard(token: string): TokenGuard {
  const expected = Buffer.from(token);
  const prefix = 'Bearer ';
  return {
    verify(req) {
      const header = req.headers.get('authorization');
      if (header === null || !header.startsWith(prefix)) return false;
      const got = Buffer.from(header.slice(prefix.length));
      if (got.length !== expected.length) return false;
      return timingSafeEqual(got, expected);
    },
  };
}
