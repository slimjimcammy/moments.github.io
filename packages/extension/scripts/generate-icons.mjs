// Generates the extension icon set with zero dependencies: a rose rounded
// square with a white play triangle, rasterized here and written as PNGs.
//
//   node scripts/generate-icons.mjs
//
// Rendering happens at 3x3 supersampling so the curves and the triangle stay
// clean at 16px. Swap BG / FG below to rebrand.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const BG = [244, 63, 94]; // rose-500
const FG = [255, 255, 255];
const SIZES = [16, 32, 48, 128];
const SAMPLES = 3;

const OUT_DIR = resolve(import.meta.dirname, '..', 'public', 'icons');

/** Is (x, y) — in 0..1 space — inside the rounded square? */
function insideCard(x, y) {
  const r = 0.22;
  const dx = Math.max(r - x, 0, x - (1 - r));
  const dy = Math.max(r - y, 0, y - (1 - r));
  return dx * dx + dy * dy <= r * r;
}

/** Is (x, y) inside the play triangle? */
function insideTriangle(x, y) {
  const ax = 0.37;
  const ay = 0.27;
  const bx = 0.37;
  const by = 0.73;
  const cx = 0.735;
  const cy = 0.5;
  const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = sign(x, y, ax, ay, bx, by);
  const d2 = sign(x, y, bx, by, cx, cy);
  const d3 = sign(x, y, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function renderRGBA(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let card = 0;
      let glyph = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          if (insideCard(x, y)) card++;
          if (insideTriangle(x, y)) glyph++;
        }
      }
      const total = SAMPLES * SAMPLES;
      const cardA = card / total;
      const glyphA = Math.min(glyph / total, cardA);
      const offset = (py * size + px) * 4;
      // Composite the glyph over the card, then the card over transparency.
      for (let c = 0; c < 3; c++) {
        pixels[offset + c] = Math.round(BG[c] * (1 - glyphA) + FG[c] * glyphA);
      }
      pixels[offset + 3] = Math.round(255 * cardA);
    }
  }
  return pixels;
}

// --- minimal PNG encoder ---------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12: deflate, adaptive filtering, no interlace — all zero.

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = resolve(OUT_DIR, `icon-${size}.png`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, encodePNG(size, renderRGBA(size)));
}
console.log(`icons: wrote ${SIZES.map((s) => `icon-${s}.png`).join(', ')} to public/icons`);
