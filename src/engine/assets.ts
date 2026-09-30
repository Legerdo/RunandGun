import { Surface } from './surface';

// Loads PNGs into software surfaces (ABGR pixels, alpha < 128 = transparent).
const cache = new Map<string, Surface>();

export async function loadSurface(name: string, url: string): Promise<Surface | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height);
    const px = new Uint32Array(data.data.buffer.slice(0));
    for (let i = 0; i < px.length; i++) {
      const a = px[i] >>> 24;
      px[i] = a < 128 ? 0 : (px[i] | 0xff000000) >>> 0;
    }
    const s = new Surface(img.width, img.height, px);
    cache.set(name, s);
    return s;
  } catch {
    return null;
  }
}

export function getSurface(name: string): Surface | undefined {
  return cache.get(name);
}
