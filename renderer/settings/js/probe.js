/** 读取素材元信息并抓取一帧缩略图（纯前端探测，不依赖 ffmpeg） */

function once(el, event, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('超时'));
    }, timeout);
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error('媒体解码失败')); };
    function cleanup() {
      clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener('error', bad);
    }
    el.addEventListener(event, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}

function seek(video, time) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      video.removeEventListener('seeked', ok);
      reject(new Error('定位超时'));
    }, 6000);
    const ok = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', ok);
      resolve();
    };
    video.addEventListener('seeked', ok, { once: true });
    video.currentTime = time;
  });
}

export async function probeAsset(asset) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = asset.url;

  try {
    await once(video, 'loadeddata');
    const width = video.videoWidth;
    const height = video.videoHeight;
    const duration = video.duration;

    // 抓 20% 处的一帧，避开头几帧可能还没进入稳定画面
    const at = isFinite(duration) ? Math.min(Math.max(duration * 0.2, 0.05), duration - 0.05) : 0.1;
    if (at > 0) {
      try { await seek(video, at); } catch { /* 定位失败就用首帧 */ }
    }

    const maxEdge = 480;
    const ratio = Math.min(1, maxEdge / Math.max(width || 1, height || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((width || 1) * ratio));
    canvas.height = Math.max(1, Math.round((height || 1) * ratio));
    const g = canvas.getContext('2d', { willReadFrequently: true });

    // 先画在透明画布上，用来判断素材本身是否已带 alpha 通道
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(video, 0, 0, canvas.width, canvas.height);
    const hasAlpha = detectAlpha(g, canvas.width, canvas.height);

    // 再把透明区域铺成棋盘格，这样缩略图不会变成一片黑
    drawChecker(g, canvas.width, canvas.height);
    g.drawImage(video, 0, 0, canvas.width, canvas.height);

    let thumb = '';
    try {
      thumb = canvas.toDataURL('image/jpeg', 0.82);
    } catch {
      thumb = '';
    }

    return { width, height, duration, thumb, hasAlpha };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

function detectAlpha(g, w, h) {
  const spots = [
    [2, 2],
    [Math.max(0, w - 4), 2],
    [2, Math.max(0, h - 4)],
    [Math.max(0, w - 4), Math.max(0, h - 4)],
  ];
  let zero = 0;
  for (const [x, y] of spots) {
    try {
      const a = g.getImageData(x, y, 1, 1).data[3];
      if (a < 16) zero++;
    } catch {
      return false;
    }
  }
  // 四角里有两处以上完全透明，就认为素材自带 alpha
  return zero >= 2;
}

function drawChecker(g, w, h) {
  const cell = 12;
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      const even = ((x / cell) + (y / cell)) % 2 === 0;
      g.fillStyle = even ? '#e9e6dd' : '#f7f5ef';
      g.fillRect(x, y, cell, cell);
    }
  }
}
