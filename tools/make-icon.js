'use strict';

/**
 * 生成托盘图标（32x32 RGBA PNG）。
 * 不引第三方图形库，直接按像素合成后手写 PNG 分块，4x 超采样做抗锯齿。
 * 用法：node tools/make-icon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 32;
const SS = 4; // 超采样倍数

const BODY = [0x1d, 0x9e, 0x75];
const EYE = [0xff, 0xff, 0xff];
const PUPIL = [0x04, 0x34, 0x2c];

function insideCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function render() {
  const w = SIZE * SS;
  const buffer = new Float32Array(SIZE * SIZE * 4);

  const cx = 16;
  const cy = 16;
  const bodyR = 11;

  for (let sy = 0; sy < w; sy++) {
    for (let sx = 0; sx < w; sx++) {
      // 把超采样点映射回逻辑坐标
      const x = (sx + 0.5) / SS;
      const y = (sy + 0.5) / SS;

      let color = null;

      if (insideCircle(x, y, cx, cy, bodyR)) color = BODY;
      if (insideCircle(x, y, cx - 4, cy - 1, 2.6)) color = EYE;
      if (insideCircle(x, y, cx + 4, cy - 1, 2.6)) color = EYE;
      if (insideCircle(x, y, cx - 4, cy - 1, 1.2)) color = PUPIL;
      if (insideCircle(x, y, cx + 4, cy - 1, 1.2)) color = PUPIL;

      const px = Math.floor(sx / SS);
      const py = Math.floor(sy / SS);
      const idx = (py * SIZE + px) * 4;
      if (color) {
        buffer[idx] += color[0];
        buffer[idx + 1] += color[1];
        buffer[idx + 2] += color[2];
        buffer[idx + 3] += 255;
      }
    }
  }

  const raw = Buffer.alloc(SIZE * SIZE * 4);
  const samples = SS * SS;
  for (let i = 0; i < SIZE * SIZE; i++) {
    raw[i * 4] = Math.round(buffer[i * 4] / samples);
    raw[i * 4 + 1] = Math.round(buffer[i * 4 + 1] / samples);
    raw[i * 4 + 2] = Math.round(buffer[i * 4 + 2] / samples);
    raw[i * 4 + 3] = Math.round(buffer[i * 4 + 3] / samples);
  }
  return raw;
}

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(raw, width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    scanlines[y * (stride + 1)] = 0;
    raw.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const idat = zlib.deflateSync(scanlines, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, '..', 'assets', 'tray.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng(render(), SIZE, SIZE));
console.log('写入', out);
