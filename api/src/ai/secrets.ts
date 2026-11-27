import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

// Server-side encryption for stored secrets (provider API keys, report keys).
// SARIEL_DATA_KEY (32 bytes, hex or base64) is preferred. Without it, a key is derived from the
// access-token secret, so rotating that secret makes previously stored values unreadable.
function dataKey(): Buffer {
  const raw = process.env.SARIEL_DATA_KEY?.trim();
  if (raw) {
    const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('SARIEL_DATA_KEY must be 32 bytes (64 hex characters or base64).');
    return key;
  }
  const secret = process.env.AUTH_ACCESS_SECRET;
  if (!secret) throw new Error('Set SARIEL_DATA_KEY or AUTH_ACCESS_SECRET to store secrets.');
  return Buffer.from(hkdfSync('sha256', secret, 'sariel', 'sariel-data-key-v1', 32));
}

/** A short one-way fingerprint of the data key, to compare environments without revealing it. */
export function dataKeyFingerprint(): string {
  try { return createHash('sha256').update(dataKey()).digest('hex').slice(0, 8); } catch { return 'invalid'; }
}

/** Encrypts with AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function seal(plain: Buffer | string, context = ''): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(typeof plain === 'string' ? Buffer.from(plain) : plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function open(sealed: string, context = ''): Buffer {
  const raw = Buffer.from(sealed, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', dataKey(), raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
}
