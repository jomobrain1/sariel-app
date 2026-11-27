import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Raster } from '../images/codec.js';

// Report photos carry an encrypted report in the least significant bit of each red, green and
// blue value. Changing that bit alters a colour by 1/255, which is invisible. Layout:
//   "SRL1" | uint16 length | selector(16) | iv(12) | tag(16) | ciphertext
// The selector identifies the owner's key without revealing who they are. AES-256-GCM makes any
// change to the hidden bytes (tampering, recompression, cropping) fail authentication.
const MAGIC = Buffer.from('SRL1');
const HEADER = MAGIC.length + 2;

export interface ReportPayload { v:1; r:string; l:number; c:string; k?:string; d?:string; t:number }

export function seal(payload:ReportPayload, selector:Buffer, key:Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.concat([MAGIC, selector]));
  const body = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return Buffer.concat([selector, iv, cipher.getAuthTag(), body]);
}

export function unseal(frame:Buffer, key:Buffer): ReportPayload {
  const selector = frame.subarray(0, 16);
  const decipher = createDecipheriv('aes-256-gcm', key, frame.subarray(16, 28));
  decipher.setAAD(Buffer.concat([MAGIC, selector]));
  decipher.setAuthTag(frame.subarray(28, 44));
  return JSON.parse(Buffer.concat([decipher.update(frame.subarray(44)), decipher.final()]).toString()) as ReportPayload;
}

export const capacity = (image:Raster) => Math.floor(image.width * image.height * 3 / 8) - HEADER;

/** Writes the bytes into the image's low bits. Mutates and returns the image. */
export function embed(image:Raster, frame:Buffer): Raster {
  if (frame.length > capacity(image) || frame.length > 0xffff) throw new Error('Image too small for this report.');
  const length = Buffer.alloc(2); length.writeUInt16BE(frame.length);
  const bytes = Buffer.concat([MAGIC, length, frame]);
  for (let bit = 0; bit < bytes.length * 8; bit++) {
    const value = (bytes[bit >> 3] >> (7 - (bit & 7))) & 1;
    const index = Math.floor(bit / 3) * 4 + (bit % 3);
    image.data[index] = (image.data[index] & 0xfe) | value;
  }
  return image;
}

function readBytes(image:Raster, offset:number, count:number): Buffer {
  const out = Buffer.alloc(count);
  for (let i = 0; i < count * 8; i++) {
    const bit = offset * 8 + i;
    const index = Math.floor(bit / 3) * 4 + (bit % 3);
    if (index >= image.data.length) throw new Error('truncated');
    out[i >> 3] |= (image.data[index] & 1) << (7 - (i & 7));
  }
  return out;
}

/** Returns the hidden frame, or null if the image carries no report marker. */
export function extract(image:Raster): Buffer | null {
  try {
    if (!readBytes(image, 0, MAGIC.length).equals(MAGIC)) return null;
    const length = readBytes(image, MAGIC.length, 2).readUInt16BE();
    if (length < 45 || length > capacity(image)) return null;
    return readBytes(image, HEADER, length);
  } catch { return null; }
}
