'use strict';

// Generates assets/icon.png (256x256): a diagonal blue→purple gradient tile with a
// lightning-bolt mark (matching the in-app logo). No external deps — emits a PNG via zlib.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

// Lightning-bolt outline (in 256-canvas coordinates).
const BOLT = [
  [144, 38], [82, 138], [120, 138], [104, 218], [178, 112], [134, 112]
];

// Even-odd point-in-polygon test.
function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
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
      let r = lerp(0x4f, 0x9b, t);
      let g = lerp(0x7c, 0x5c, t);
      let b = lerp(0xff, 0xff, t);
      // Rounded corners → transparent.
      const radius = 48;
      const inX = Math.min(x, SIZE - 1 - x);
      const inY = Math.min(y, SIZE - 1 - y);
      let a = 255;
      if (inX < radius && inY < radius) {
        const dx = radius - inX, dy = radius - inY;
        if (dx * dx + dy * dy > radius * radius) a = 0;
      }
      // Lightning bolt in white, with a soft outer edge for crispness.
      if (inPoly(x + 0.5, y + 0.5, BOLT)) { r = 255; g = 255; b = 255; }
      setPixel(raw, x, y, r, g, b, a);
    }
  }

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
