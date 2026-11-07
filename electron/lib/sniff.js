'use strict';

const fs = require('fs');

/**
 * 按文件内容判定真实容器格式。
 * 背景：用户的素材扩展名常与实际容器不符（本项目自带的两个样例就是
 * 扩展名为 .mp4、内容却是 WebM），若按扩展名给 MIME，Chromium 会拒绝解码。
 */

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // RIFF
const OGG_MAGIC = [0x4f, 0x67, 0x67, 0x53]; // OggS
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

function startsWith(buf, sig) {
  if (buf.length < sig.length) return false;
  return sig.every((b, i) => buf[i] === b);
}

function sniffContainer(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(64);
    const read = fs.readSync(fd, head, 0, 64, 0);
    if (read < 12) return null;
    const buf = head.subarray(0, read);

    if (startsWith(buf, EBML_MAGIC)) {
      // 二进制头之后紧跟 DocType 字符串，webm 与 matroska 要分开
      const text = buf.toString('latin1');
      if (text.includes('webm')) return { mime: 'video/webm', ext: '.webm', kind: 'webm' };
      if (text.includes('matroska')) return { mime: 'video/x-matroska', ext: '.mkv', kind: 'mkv' };
      return { mime: 'video/webm', ext: '.webm', kind: 'webm' };
    }

    // ISO BMFF：第 4 字节起是 'ftyp'
    if (buf.toString('latin1', 4, 8) === 'ftyp') {
      const brand = buf.toString('latin1', 8, 12);
      if (brand.startsWith('qt')) return { mime: 'video/quicktime', ext: '.mov', kind: 'mov' };
      return { mime: 'video/mp4', ext: '.mp4', kind: 'mp4' };
    }

    if (startsWith(buf, RIFF_MAGIC) && buf.toString('latin1', 8, 12) === 'AVI ') {
      return { mime: 'video/x-msvideo', ext: '.avi', kind: 'avi' };
    }
    if (startsWith(buf, OGG_MAGIC)) {
      return { mime: 'video/ogg', ext: '.ogv', kind: 'ogv' };
    }
    if (startsWith(buf, GIF87) || startsWith(buf, GIF89)) {
      return { mime: 'image/gif', ext: '.gif', kind: 'gif' };
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* 忽略 */ }
    }
  }
}

const MIME_BY_EXT = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.ogv': 'video/ogg',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function mimeByExt(ext) {
  return MIME_BY_EXT[String(ext).toLowerCase()] || 'application/octet-stream';
}

module.exports = { sniffContainer, mimeByExt };
