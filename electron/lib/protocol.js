'use strict';

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { protocol } = require('electron');
const { mimeByExt } = require('./sniff');

const SCHEME = 'pet';

/**
 * 自定义协议，只有一个 host：pet://local
 *   /app/...   渲染层静态资源（html/js/css）
 *   /media/... 用户素材（userData/assets）
 * 放在同一 host 下是为了让两个窗口同为 pet://local 源，
 * 这样 canvas 读取视频像素不会被判定为跨域污染。
 */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

function notFound(msg = 'Not Found') {
  return new Response(msg, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

function forbidden() {
  return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

function toWebStream(nodeStream) {
  if (typeof Readable.toWeb === 'function') return Readable.toWeb(nodeStream);
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

async function serveFile(abs, request) {
  let stat;
  try {
    stat = await fs.promises.stat(abs);
  } catch {
    return notFound();
  }
  if (!stat.isFile()) return notFound();

  const mime = mimeByExt(path.extname(abs));
  const headers = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
  };

  if (mime.startsWith('text/html')) {
    headers['Content-Security-Policy'] =
      "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'";
  }

  const range = request.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      let start = m[1] === '' ? null : parseInt(m[1], 10);
      let end = m[2] === '' ? null : parseInt(m[2], 10);
      if (start === null && end === null) {
        // 无意义的 Range，按整文件返回
      } else {
        if (start === null) {
          start = Math.max(0, stat.size - end);
          end = stat.size - 1;
        } else if (end === null || end >= stat.size) {
          end = stat.size - 1;
        }
        if (start > end || start < 0) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${stat.size}` },
          });
        }
        headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
        headers['Content-Length'] = String(end - start + 1);
        return new Response(toWebStream(fs.createReadStream(abs, { start, end })), {
          status: 206,
          headers,
        });
      }
    }
  }

  headers['Content-Length'] = String(stat.size);
  return new Response(toWebStream(fs.createReadStream(abs)), { status: 200, headers });
}

function setup({ appRoot, mediaRoot }) {
  const appBase = path.resolve(appRoot);
  const mediaBase = path.resolve(mediaRoot);

  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'local') return notFound();
      const pathname = decodeURIComponent(url.pathname);

      let base;
      let rel;
      if (pathname.startsWith('/app/')) {
        base = appBase;
        rel = pathname.slice('/app/'.length);
      } else if (pathname.startsWith('/media/')) {
        base = mediaBase;
        rel = pathname.slice('/media/'.length);
      } else {
        return notFound();
      }

      const abs = path.resolve(base, rel);
      const rootWithSep = base.endsWith(path.sep) ? base : base + path.sep;
      if (abs !== base && !abs.startsWith(rootWithSep)) return forbidden();

      return await serveFile(abs, request);
    } catch (err) {
      return new Response(`Internal Error: ${err.message}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  });
}

const APP_URL = (rel) => `${SCHEME}://local/app/${rel}`;
const MEDIA_URL = (file) => `${SCHEME}://local/media/${encodeURIComponent(file)}`;

module.exports = { SCHEME, registerScheme, setup, APP_URL, MEDIA_URL };
