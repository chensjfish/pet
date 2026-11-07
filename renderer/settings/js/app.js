import { h, clear, toast } from './util.js';
import { probeAsset } from './probe.js';
import assetsTab from './tab-assets.js';
import functionsTab from './tab-functions.js';
import systemTab from './tab-system.js';

const api = window.api;

const header = document.getElementById('header');
const body = document.getElementById('body');
const footer = document.getElementById('footer');
const saveState = document.getElementById('saveState');

const state = {
  config: null,
  tab: 'assets',
  fnId: 'idle',
  keyingFnId: null,
  thumbs: new Map(),
  firstRun: false,
  probing: false,
};

const tabs = { assets: assetsTab, functions: functionsTab, system: systemTab };

let activeCleanup = null;

/* ------------------------------------------------------------ 保存 */

let saveTimer = null;
let resetTimer = null;
let pendingPatch = null;

function queuePatch(patch) {
  pendingPatch = Object.assign(pendingPatch || {}, patch);
  saveState.textContent = '保存中…';
  saveState.classList.add('saving');
  clearTimeout(saveTimer);
  clearTimeout(resetTimer);
  saveTimer = setTimeout(flush, 240);
}

async function flush() {
  if (!pendingPatch) return;
  const payload = pendingPatch;
  pendingPatch = null;
  try {
    state.config = await api.patchConfig(payload);
    saveState.textContent = '已保存';
    saveState.classList.remove('saving');
    resetTimer = setTimeout(() => {
      if (!pendingPatch) {
        saveState.textContent = '修改自动保存';
        saveState.classList.remove('saving');
      }
    }, 1400);
  } catch (err) {
    saveState.textContent = '保存失败';
    toast('保存失败：' + err.message, 'error');
  }
}

/* ------------------------------------------------------------ 上下文 */

const ctx = {
  state,
  api,
  patch: queuePatch,
  toast,
  rerender: () => render(),
  onCleanup: (fn) => { activeCleanup = fn; },
  openKeying: (fnId) => {
    state.tab = 'functions';
    state.keyingFnId = fnId;
    render();
  },
  closeKeying: () => {
    state.keyingFnId = null;
    render();
  },
  ensureThumbs,
};

/* ------------------------------------------------------------ 渲染 */

function updateCounts() {
  if (!state.config) return;
  const assetCount = document.querySelector('[data-count="assets"]');
  const fnCount = document.querySelector('[data-count="functions"]');
  if (assetCount) assetCount.textContent = String(state.config.assets.length);
  if (fnCount) fnCount.textContent = String(state.config.functions.length);
}

function renderFooter() {
  clear(footer);
  footer.hidden = true;
  if (!state.firstRun) return;

  footer.hidden = false;
  footer.append(
    h('div', { class: 'header-desc', style: { margin: '0' } },
      '配置随时可以在托盘菜单里重新打开。确认没问题后，就可以把桌宠放到桌面上了。'),
    h('div', { class: 'header-actions' },
      h('button', {
        class: 'btn btn-primary',
        type: 'button',
        onclick: async () => {
          try {
            await flush();
            await api.finishSetup();
            state.firstRun = false;
            render();
            toast('桌宠已启动');
          } catch (err) {
            toast('启动失败：' + err.message, 'error');
          }
        },
      }, '完成，启动桌宠')
    )
  );
}

function render() {
  if (activeCleanup) {
    try { activeCleanup(); } catch { /* 清理失败不影响重绘 */ }
    activeCleanup = null;
  }
  for (const btn of document.querySelectorAll('.nav-item')) {
    btn.classList.toggle('active', btn.dataset.tab === state.tab);
  }
  updateCounts();
  clear(header);
  clear(body);
  const mod = tabs[state.tab];
  if (mod) mod.render({ header, body, footer, ctx });
  renderFooter();
}

/* ------------------------------------------------------------ 数据 */

let lastStructural = '';

function structuralKey(cfg) {
  return JSON.stringify({ assets: cfg.assets, functions: cfg.functions });
}

function onConfigChanged(cfg) {
  const prev = state.config;
  state.config = cfg;

  // 只关心结构与内容的变化；桌宠坐标这类字段变化不触发重绘，
  // 否则拖拽宠物时配置面板会跟着闪
  const key = structuralKey(cfg);
  const changed = key !== lastStructural;
  lastStructural = key;

  if (!changed) {
    updateCounts();
    return;
  }
  if (prev && prev.assets.length !== cfg.assets.length) ensureThumbs();
  render();
}

async function ensureThumbs() {
  if (state.probing || !state.config) return;
  const targets = state.config.assets.filter((a) => !state.thumbs.has(a.id));
  if (!targets.length) return;

  state.probing = true;
  let updated = false;
  try {
    for (const asset of targets) {
      try {
        const info = await probeAsset(asset);
        if (info.thumb) state.thumbs.set(asset.id, info.thumb);
        else state.thumbs.set(asset.id, '');
        const meta = {
          width: info.width,
          height: info.height,
          duration: info.duration,
          hasAlpha: !!info.hasAlpha,
        };
        await api.updateAssetMeta(asset.id, meta);
        updated = true;
      } catch (err) {
        state.thumbs.set(asset.id, '');
        console.warn('素材探测失败', asset.name, err.message);
      }
    }
  } finally {
    state.probing = false;
  }

  if (updated) {
    state.config = await api.getConfig();
    lastStructural = structuralKey(state.config);
  }
  render();
}

/* ------------------------------------------------------------ 启动 */

function bindNav() {
  document.getElementById('nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    const tab = btn.dataset.tab;
    if (!tab || tab === state.tab) return;
    state.tab = tab;
    state.keyingFnId = null;
    render();
  });
}

async function init() {
  if (!api) {
    document.body.textContent = 'preload 未注入，无法读取配置';
    return;
  }
  state.config = await api.getConfig();
  state.firstRun = !!(state.config.meta && state.config.meta.isFirstRun);
  lastStructural = structuralKey(state.config);

  api.onConfigChanged(onConfigChanged);
  bindNav();
  render();

  window.addEventListener('beforeunload', () => {
    if (pendingPatch) api.patchConfig(pendingPatch);
  });

  ensureThumbs();
}

init().catch((err) => {
  console.error('配置面板启动失败', err);
  toast('启动失败：' + err.message, 'error');
});
