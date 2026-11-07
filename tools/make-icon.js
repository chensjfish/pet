'use strict';

/**
 * 生成应用图标：
 *   assets/tray.png  托盘用 32x32
 *   build/icon.png   256x256 母版
 *   build/icon.ico   Windows 应用图标，内含 16/24/32/48/64/128/256 七个尺寸
 *
 * 不引第三方图形库，直接按像素合成后手写 PNG 分块，4x 超采样做抗锯齿。
 * 用法：node tools/make-icon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SS = 4; // 超采样倍数

const BODY = [0x1d, 0x9e, 0x75];
const EYE = [0xff, 0xff, 0xff];
const PUPIL = [0x04, 0x34, 0x2c];

function insideCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** 用 0~1 的归一化坐标绘制，保证任意尺寸下造型一致 */
function renderRGBA(size) {
  const w = size * SS;
  const acc = new Float32Array(size * size * 4);

  const body = { cx: 0.5, cy: 0.5, r: 0.34 };
  const eyes = [
    { cx: 0.375, cy: 0.47, r: 0.082 },
    { cx: 0.625, cy: 0.47, r: 0.082 },
  ];
  const pupils = [
    { cx: 0.375, cy: 0.47, r: 0.038 },
    { cx: 0.625, cy: 0.47, r: 0.038 },
  ];

  for (let sy = 0; sy < w; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const x = (sx + 0.5) / w;
      const y = (sy + 0.5) / w;

      let color = null;
      if (insideCircle(x, y, body.cx, body.cy, body.r)) color = BODY;
      for (const e of eyes) if (insideCircle(x, y, e.cx, e.cy, e.r)) color = EYE;
      for (const p of pupils) if (insideCircle(x, y, p.cx, p.cy, p.r)) color = PUPIL;

      if (!color) continue;
      const px = Math.floor(sx / SS);
      const py = Math.floor(sy / SS);
      const idx = (py * size + px) * 4;
      acc[idx] += color[0];
      acc[idx + 1] += color[1];
      acc[idx + 2] += color[2];
      acc[idx + 3] += 255;
    }
  }

  const out = Buffer.alloc(size * size * 4);
  const samples = SS * SS;
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = Math.round(acc[i * 4] / samples);
    out[i * 4 + 1] = Math.round(acc[i * 4 + 1] / samples);
    out[i * 4 + 2] = Math.round(acc[i * 4 + 2] / samples);
    out[i * 4 + 3] = Math.round(acc[i * 4 + 3] / samples);
  }
  return out;
}

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
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

function encodePng(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 4;
  const scanlines = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    scanlines[y * (stride + 1)] = 0;
    rgba.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO 直接内嵌 PNG 数据，Vista 之后 Windows 原生支持 */
function encodeIco(items) {
  const count = items.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;

  items.forEach((item, i) => {
    const base = i * 16;
    dir[base] = item.size >= 256 ? 0 : item.size;
    dir[base + 1] = item.size >= 256 ? 0 : item.size;
    dir[base + 2] = 0;
    dir[base + 3] = 0;
    dir.writeUInt16LE(1, base + 4);
    dir.writeUInt16LE(32, base + 6);
    dir.writeUInt32LE(item.png.length, base + 8);
    dir.writeUInt32LE(offset, base + 12);
    offset += item.png.length;
  });

  return Buffer.concat([header, dir, ...items.map((p) => p.png)]);
}

function write(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  console.log('写入', path.relative(process.cwd(), file), buf.length + ' B');
}

const root = path.join(__dirname, '..');
const png = (size) => encodePng(renderRGBA(size), size);

write(path.join(root, 'assets', 'tray.png'), png(32));
write(path.join(root, 'build', 'icon.png'), png(256));
write(
  path.join(root, 'build', 'icon.ico'),
  encodeIco([16, 24, 32, 48, 64, 128, 256].map((s) => ({ size: s, png: png(s) })))
);
