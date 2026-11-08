import { ChromaKeyer } from '../shared/keyer.js';

const api = window.api;
const stage = document.getElementById('stage');

/** 单层：一块 canvas + 一个隐藏 video，负责“解码 → 抠像 → 显示” */
class Layer {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video = video;
    this.keyer = new ChromaKeyer(canvas);
    this.keying = null;
    this.assetId = null;
    this.running = false;
    this.vfcHandle = null;
    this.rafHandle = null;
  }

  setViewport(cssW, cssH, dpr) {
    this.keyer.setViewportSize(cssW, cssH, dpr);
  }

  async load(asset, keying) {
    if (!asset || !asset.url) throw new Error('素材地址为空');
    this.keying = keying || {};
    if (this.assetId !== asset.id) {
      const v = this.video;
      v.dataset.assetId = asset.id;
      v.src = asset.url;
      v.load();
      await waitFor(v, 'loadeddata', 8000);
      this.assetId = asset.id;
    }
    return { width: this.video.videoWidth, height: this.video.videoHeight };
  }

  async play() {
    try {
      await this.video.play();
    } catch {
      // 静音视频一般不会被自动播放策略拦截，失败就等下一次触发
    }
    this.startLoop();
  }

  startLoop() {
    if (this.running) return;
    this.running = true;

    const draw = () => {
      if (!this.running) return;
      if (this.video.readyState >= 2) {
        if (this.keyer.upload(this.video)) this.keyer.render(this.keying);
      }
    };

    if (typeof this.video.requestVideoFrameCallback === 'function') {
      const onFrame = () => {
        if (!this.running) return;
        draw();
        this.vfcHandle = this.video.requestVideoFrameCallback(onFrame);
      };
      this.vfcHandle = this.video.requestVideoFrameCallback(onFrame);
    } else {
      const loop = () => {
        if (!this.running) return;
        draw();
        this.rafHandle = requestAnimationFrame(loop);
      };
      this.rafHandle = requestAnimationFrame(loop);
    }
  }

  redraw() {
    if (this.video.readyState >= 2) {
      if (this.keyer.upload(this.video)) this.keyer.render(this.keying);
    }
  }

  stop() {
    this.running = false;
    if (this.vfcHandle != null && this.video.cancelVideoFrameCallback) {
      try { this.video.cancelVideoFrameCallback(this.vfcHandle); } catch { /* 忽略 */ }
      this.vfcHandle = null;
    }
    if (this.rafHandle != null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    try { this.video.pause(); } catch { /* 忽略 */ }
  }
}

function waitFor(el, event, timeout) {
  return new Promise((resolve, reject) => {
    if (event === 'loadeddata' && el.readyState >= 2) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('视频加载超时'));
    }, timeout);
    const onOk = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error('视频加载失败')); };
    function cleanup() {
      clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener('error', onErr);
    }
    el.addEventListener(event, onOk, { once: true });
    el.addEventListener('error', onErr, { once: true });
  });
}

const state = {
  config: null,
  layers: [],
  front: 0,
  activeFnId: null,
  lastActivity: Date.now(),
  generation: 0,
};

function assetById(id) {
  if (!state.config || !id) return null;
  return state.config.assets.find((a) => a.id === id) || null;
}

function functionById(id) {
  if (!state.config) return null;
  return state.config.functions.find((f) => f.id === id && f.enabled) || null;
}

function idleTimeoutMs() {
  const t = state.config && state.config.behavior && state.config.behavior.typingTimeoutMs;
  return typeof t === 'number' && t > 0 ? t : 1200;
}

/** 素材自带 alpha 时绕过色键，避免把主体误判成背景 */
function keyingFor(fn, asset) {
  return Object.assign({}, fn.keying, { srcAlpha: !!(asset && asset.hasAlpha) });
}

async function activate(id) {
  const fn = functionById(id) || functionById('idle');
  if (!fn) return;
  const asset = assetById(fn.assetId);
  if (!asset) return;

  const current = state.layers[state.front];
  if (state.activeFnId === fn.id && current && current.assetId === asset.id) {
    // 已经在这个功能上，只同步参数；参数真正变化由 applyConfig 触发的重绘负责
    current.keying = keyingFor(fn, asset);
    return;
  }

  const gen = ++state.generation;
  const backIdx = 1 - state.front;
  const back = state.layers[backIdx];

  let size;
  try {
    size = await back.load(asset, keyingFor(fn, asset));
  } catch (err) {
    console.error('切换动画失败', err);
    return;
  }
  if (gen !== state.generation) return;

  if (size && size.width) {
    await api.pet.fit(size);
  }

  await back.play();
  if (gen !== state.generation) return;

  back.canvas.classList.add('visible');
  current.canvas.classList.remove('visible');

  const prevIdx = state.front;
  state.front = backIdx;
  state.activeFnId = fn.id;

  setTimeout(() => {
    if (state.front !== prevIdx) state.layers[prevIdx].stop();
  }, 260);
}

function resizeAll() {
  const dpr = window.devicePixelRatio || 1;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  for (const layer of state.layers) layer.setViewport(w, h, dpr);
}

function applyConfig(cfg) {
  state.config = cfg;
  const currentId = state.activeFnId || 'idle';
  const fn = functionById(currentId);
  const layer = state.layers[state.front];
  if (!fn || !layer) return;

  const asset = assetById(fn.assetId);
  if (needsReload(layer, asset)) {
    activate(fn.id);
    return;
  }
  layer.keying = keyingFor(fn, asset);
  layer.redraw();
}

function needsReload(layer, asset) {
  if (!asset) return false;
  return layer.assetId !== asset.id;
}

function tick() {
  if (!state.config) return;
  const typing = functionById('typing');
  if (!typing || !typing.enabled || !typing.assetId) return;
  if (state.activeFnId !== 'typing') return;
  if (Date.now() - state.lastActivity > idleTimeoutMs()) {
    activate('idle');
  }
}

function bindInteractions() {
  let dragging = false;

  stage.addEventListener('pointerdown', async (e) => {
    if (e.button !== 0) return;
    dragging = true;
    stage.classList.add('dragging');
    try { stage.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
    await api.pet.dragStart();
  });

  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    if (e.buttons === 0) {
      endDrag();
      return;
    }
    api.pet.dragMove(e.screenX, e.screenY);
  });

  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('dragging');
    api.pet.dragEnd();
  }

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    api.pet.menu();
  });

  stage.addEventListener('dblclick', () => api.pet.openSettings());

  document.addEventListener('visibilitychange', () => {
    const layer = state.layers[state.front];
    if (!layer) return;
    if (document.hidden) {
      layer.stop();
    } else {
      layer.play();
    }
  });

  window.addEventListener('resize', () => {
    resizeAll();
    const layer = state.layers[state.front];
    if (layer && layer.running) layer.redraw();
  });
}

async function init() {
  if (!api) {
    console.error('preload 未注入，无法获取配置');
    return;
  }

  state.layers = [
    new Layer(document.getElementById('layerA'), document.getElementById('videoA')),
    new Layer(document.getElementById('layerB'), document.getElementById('videoB')),
  ];
  resizeAll();
  bindInteractions();

  state.config = await api.getConfig();

  api.onConfigChanged((cfg) => applyConfig(cfg));
  api.pet.onActivity(() => {
    state.lastActivity = Date.now();
    const typing = functionById('typing');
    if (typing && typing.assetId) activate('typing');
  });
  // 右键菜单里改了缩放，按当前正在播放的素材重新上报尺寸
  api.pet.onRefit(() => {
    const layer = state.layers[state.front];
    const v = layer && layer.video;
    if (v && v.videoWidth) api.pet.fit({ width: v.videoWidth, height: v.videoHeight });
  });

  await activate('idle');
  setInterval(tick, 250);
}

init().catch((err) => console.error('桌宠启动失败', err));
