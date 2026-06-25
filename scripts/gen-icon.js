'use strict';

// Generates assets/icon.png (256x256) with a diagonal blue→purple gradient and "HV".
// No external deps — emits a valid PNG via zlib.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

// 5x7 bitmap font for H and V.
const GLYPHS = {
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  V: ['10001', '10001', '10001', '10001', '01010', '01010', '00100']
};

function drawGlyph(buf, glyph, ox, oy, scale) {
  glyph.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c !== '1') return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          setPixel(buf, ox + x * scale + dx, oy + y * scale + dy, 255, 255, 255, 255);
        }
      }
    });
  });
}

function setPixel(buf, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = y * (SIZE * 4 + 1) + 1 + x * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}

function build() {
  // Each row prefixed with filter byte 0.
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    for (let x = 0; x < SIZE; x++) {
      const t = (x + y) / (2 * SIZE);
      const r = lerp(0x4f, 0x9b, t);
      const g = lerp(0x7c, 0x5c, t);
      const b = lerp(0xff, 0xff, t);
      // Rounded corners → transparent.
      const radius = 48;
      const inX = Math.min(x, SIZE - 1 - x);
      const inY = Math.min(y, SIZE - 1 - y);
      let a = 255;
      if (inX < radius && inY < radius) {
        const dx = radius - inX, dy = radius - inY;
        if (dx * dx + dy * dy > radius * radius) a = 0;
      }
      setPixel(raw, x, y, r, g, b, a);
    }
  }

  // "HV" centered.
  const scale = 14;
  const glyphW = 5 * scale;
  const totalW = glyphW * 2 + scale * 2;
  const startX = Math.round((SIZE - totalW) / 2);
  const startY = Math.round((SIZE - 7 * scale) / 2);
  drawGlyph(raw, GLYPHS.H, startX, startY, scale);
  drawGlyph(raw, GLYPHS.V, startX + glyphW + scale * 2, startY, scale);

  const png = encodePng(raw);
  const out = path.join(__dirname, '..', 'assets', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, png);
  console.log('Wrote', out);
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(raw) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

build();
