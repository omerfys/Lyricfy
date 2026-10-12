import type { ColorPalette } from '../types';

export interface PresetTheme {
  name: string;
  palette: ColorPalette;
}

export const PRESET_THEMES: PresetTheme[] = [
  {
    name: 'Verci Original (Neon Pink / Red)',
    palette: {
      primary: '#fda4af',
      highlight: '#e11d48',
      secondary: '#881337',
      background: '#040305',
      autoSync: false,
    },
  },
  {
    name: 'Cyberpunk Glow',
    palette: {
      primary: '#67e8f9',
      highlight: '#f43f5e',
      secondary: '#1e293b',
      background: '#050508',
      autoSync: false,
    },
  },
  {
    name: 'Sunset Euphoria',
    palette: {
      primary: '#fdba74',
      highlight: '#ec4899',
      secondary: '#7c2d12',
      background: '#070408',
      autoSync: false,
    },
  },
  {
    name: 'Matrix Emerald',
    palette: {
      primary: '#86efac',
      highlight: '#10b981',
      secondary: '#064e3b',
      background: '#020502',
      autoSync: false,
    },
  },
  {
    name: 'Pure Monochrome',
    palette: {
      primary: '#e4e4e7',
      highlight: '#fb7185',
      secondary: '#52525b',
      background: '#09090b',
      autoSync: false,
    },
  },
];

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex(r: number, g: number, b: number): string {
  const hr = clampByte(r).toString(16).padStart(2, '0');
  const hg = clampByte(g).toString(16).padStart(2, '0');
  const hb = clampByte(b).toString(16).padStart(2, '0');
  return `#${hr}${hg}${hb}`;
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

/**
 * Generates a deterministic vibrant palette from track title/artist when cover art is unavailable
 */
export function generateFallbackPalette(seedText: string): ColorPalette {
  let hash = 0;
  for (let i = 0; i < seedText.length; i++) {
    hash = (hash * 31 + seedText.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return {
    primary: hslToHex(hue, 75, 82),
    highlight: hslToHex(hue, 88, 56),
    secondary: hslToHex(hue, 45, 32),
    background: hslToHex(hue, 40, 3),
    autoSync: true,
  };
}

/**
 * Extracts dominant vibrant color from an album cover image URL and returns valid #rrggbb hex codes
 */
export async function extractPaletteFromImage(
  imageUrl?: string,
  fallbackSeed = 'Lyricfy'
): Promise<ColorPalette> {
  if (!imageUrl) {
    return generateFallbackPalette(fallbackSeed);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(generateFallbackPalette(fallbackSeed));

        canvas.width = 64;
        canvas.height = 64;
        ctx.drawImage(img, 0, 0, 64, 64);

        const imgData = ctx.getImageData(0, 0, 64, 64).data;
        let bestScore = -1;
        let bestR = 225, bestG = 29, bestB = 72;
        let rSum = 0, gSum = 0, bSum = 0, count = 0;

        for (let i = 0; i < imgData.length; i += 16) {
          const r = imgData[i];
          const g = imgData[i + 1];
          const b = imgData[i + 2];
          const a = imgData[i + 3];
          if (a < 128) continue;

          rSum += r;
          gSum += g;
          bSum += b;
          count++;

          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const delta = max - min;
          const lum = (max + min) / 2;
          const sat = max === 0 ? 0 : delta / max;

          // Favor saturated, mid-to-bright vibrant colors on the album cover
          if (max > 45 && min < 235) {
            const lumWeight = 1 - Math.abs(lum - 135) / 140;
            const score = sat * 2.2 + Math.max(0, lumWeight);
            if (score > bestScore) {
              bestScore = score;
              bestR = r;
              bestG = g;
              bestB = b;
            }
          }
        }

        if (count === 0) {
          return resolve(generateFallbackPalette(fallbackSeed));
        }

        // Boost highlight brightness if the cover is very dark/monochrome
        const maxBest = Math.max(bestR, bestG, bestB);
        if (maxBest < 140 && maxBest > 0) {
          const boost = 175 / maxBest;
          bestR = clampByte(bestR * boost);
          bestG = clampByte(bestG * boost);
          bestB = clampByte(bestB * boost);
        }

        const avgR = Math.round(rSum / count);
        const avgG = Math.round(gSum / count);
        const avgB = Math.round(bSum / count);

        // Create a soft tinted primary text color and deep ambient background
        const priR = clampByte(bestR * 0.45 + 255 * 0.55);
        const priG = clampByte(bestG * 0.45 + 255 * 0.55);
        const priB = clampByte(bestB * 0.45 + 255 * 0.55);

        const secR = clampByte(avgR * 0.55 + 40);
        const secG = clampByte(avgG * 0.55 + 40);
        const secB = clampByte(avgB * 0.55 + 40);

        const bgR = clampByte(bestR * 0.06);
        const bgG = clampByte(bestG * 0.06);
        const bgB = clampByte(bestB * 0.06);

        resolve({
          primary: rgbToHex(priR, priG, priB),
          highlight: rgbToHex(bestR, bestG, bestB),
          secondary: rgbToHex(secR, secG, secB),
          background: rgbToHex(bgR, bgG, bgB),
          autoSync: true,
        });
      } catch {
        resolve(generateFallbackPalette(fallbackSeed));
      }
    };
    img.onerror = () => resolve(generateFallbackPalette(fallbackSeed));
    img.src = imageUrl;
  });
}
