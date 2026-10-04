import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

const envelopeSchema = z.object({
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
});

export function parseKey(value: string): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error('Use a 64-character hexadecimal encryption key.');

  return Buffer.from(value, 'hex');
}

export function encrypt(key: Buffer, value: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: 16,
  });
  cipher.setAAD(Buffer.from(purpose));
  const data = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);

  return JSON.stringify({
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: data.toString('hex'),
  });
}

export function decrypt(key: Buffer, value: string, purpose: string): string {
  try {
    const envelope = envelopeSchema.parse(JSON.parse(value));
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'), {
      authTagLength: 16,
    });
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));

    return Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error(
      'The stored secret cannot be decrypted. Restore the correct key or a known-good backup.',
    );
  }
}
