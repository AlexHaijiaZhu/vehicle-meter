#!/usr/bin/env node
// Generates flat PWA icons (no external image dependencies).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

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
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const BG = [247, 247, 245];
const BLUE = [35, 131, 226];
const INK = [55, 53, 47];
const CLEAR = [0, 0, 0, 0];

function insideRounded(x, y, r) {
  const cx = Math.max(r, Math.min(1 - r, x));
  const cy = Math.max(r, Math.min(1 - r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function lineDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function sample(x, y, maskable) {
  if (!maskable && !insideRounded(x, y, 0.22)) return CLEAR;
  const dx = x - 0.5;
  const dy = y - 0.5;
  const dist = Math.hypot(dx, dy);
  // outer ring
  if (Math.abs(dist - 0.265) <= 0.028) return [...BLUE, 255];
  // upper arc accent (slightly inset)
  if (dist >= 0.165 && dist <= 0.19 && dy < 0.02) return [...BLUE, 255];
  // needle
  if (lineDistance(x, y, 0.5, 0.54, 0.66, 0.35) <= 0.022) return [...INK, 255];
  // hub
  if (dist <= 0.036) return [...BLUE, 255];
  return [...BG, 255];
}

function render(size, maskable = false) {
  const scale = 3;
  const hi = size * scale;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = (x * scale + sx + 0.5) / hi;
          const py = (y * scale + sy + 0.5) / hi;
          const [cr, cg, cb, ca] = sample(px, py, maskable);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const n = scale * scale;
      const alpha = a / n;
      const index = (y * size + x) * 4;
      rgba[index] = alpha ? Math.round(r / a) : 0;
      rgba[index + 1] = alpha ? Math.round(g / a) : 0;
      rgba[index + 2] = alpha ? Math.round(b / a) : 0;
      rgba[index + 3] = Math.round(alpha);
    }
  }
  return encodePng(size, size, rgba);
}

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true]
];

for (const [name, size, maskable] of targets) {
  fs.writeFileSync(path.join(outDir, name), render(size, maskable));
  console.log(`[icons] ${name} (${size}x${size})`);
}
