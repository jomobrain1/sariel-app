import { createHttpError, type Middleware } from '@tilcayo/core';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
export const MAX_SIDE = 1600;
const MAX_PIXELS = 40_000_000;

/** Raises the JSON body limit for routes that accept base64 images (the app default stays small). */
export const imageBody: Middleware = (ctx, next) => { ctx.bodyLimit = Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 4096; return next(); };

export interface Raster { width:number; height:number; data:Buffer /* RGBA */ }
const invalid = (message = 'Use a PNG or JPEG image.') => createHttpError(422, 'INVALID_IMAGE', message);

export function sniff(bytes:Buffer): 'png' | 'jpeg' | null {
  if (bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a) return 'png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  return null;
}

/** Parses a data URL or bare base64 string into bytes, enforcing the size limit. */
export function fromDataUrl(value:string): Buffer {
  const base64 = value.replace(/^data:image\/[a-z+.-]+;base64,/i, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw invalid();
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > MAX_UPLOAD_BYTES) throw invalid('Images must be 6 MB or smaller.');
  return bytes;
}

export function decode(bytes:Buffer): Raster {
  const kind = sniff(bytes);
  if (kind === 'png') {
    // Check the declared size before decoding, so a tiny file cannot expand into a huge image.
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width * height > MAX_PIXELS) throw invalid('That image is too large.');
    try { const png = PNG.sync.read(bytes); return {width:png.width, height:png.height, data:png.data}; }
    catch { throw invalid('That PNG could not be read.'); }
  }
  if (kind === 'jpeg') {
    try {
      const image = jpeg.decode(bytes, {useTArray:true, formatAsRGBA:true, maxResolutionInMP:MAX_PIXELS / 1e6, maxMemoryUsageInMB:512});
      return {width:image.width, height:image.height, data:Buffer.from(image.data)};
    } catch { throw invalid('That JPEG could not be read.'); }
  }
  throw invalid();
}

/** Area-average downscale so the longest side is at most `max` pixels. Alpha is flattened onto white. */
export function fit(image:Raster, max = MAX_SIDE): Raster {
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y / scale), y1 = Math.max(y0 + 1, Math.min(image.height, Math.floor((y + 1) / scale)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x / scale), x1 = Math.max(x0 + 1, Math.min(image.width, Math.floor((x + 1) / scale)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        const i = (sy * image.width + sx) * 4, a = image.data[i + 3] / 255;
        r += image.data[i] * a + 255 * (1 - a); g += image.data[i + 1] * a + 255 * (1 - a); b += image.data[i + 2] * a + 255 * (1 - a); n++;
      }
      const o = (y * width + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = 255;
    }
  }
  return {width, height, data:out};
}

export function encodePng(image:Raster): Buffer {
  const png = new PNG({width:image.width, height:image.height});
  image.data.copy(png.data);
  return PNG.sync.write(png, {colorType:6});
}

/** Any accepted image → opaque PNG no larger than MAX_SIDE. Metadata (EXIF, GPS) is dropped in the process. */
export function normalize(bytes:Buffer): {png:Buffer; width:number; height:number} {
  const image = fit(decode(bytes));
  return {png:encodePng(image), width:image.width, height:image.height};
}
