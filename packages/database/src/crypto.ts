import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

/** HMAC of a national ID. Lookups use this value; the raw ID is never stored. */
export function hashNationalId(nationalId: string, pepper: string): string {
  if (!pepper || pepper.length < 16) throw new Error('ID_HASH_PEPPER must be at least 16 characters');
  return createHmac('sha256', pepper).update(nationalId.trim().padStart(9, '0')).digest('hex');
}

/** Opaque bearer tokens: only their SHA-256 is stored. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}
