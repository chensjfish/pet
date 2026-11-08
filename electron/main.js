'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, screen, nativeImage } = require('electron');

const store = require('./lib/store');
const assetsSvc = require('./lib/assets');
const proto = require('./lib/protocol');
const { InputMonitor } = require('./lib/input');

// 必须在 app ready 之前注册特权协议
proto.registerScheme();

const APP_ROOT = app.getAppPath();
const IS_SMOKE = process.argv.includes('--smoke');
// 打包后 appRoot 在只读的 asar 里，自检产物必须落到可写目录
const SMOKE_OUT = process.env.PET_SMOKE_DIR
  ? path.resolve(process.env.PET_SMOKE_DIR)
  : path.join(process.cwd(), '.smoke');

// 打包后 productName 会改变 userData 目录名，这里锁死，
// 保证开发态与安装包读的是同一份配置和素材
try {
  app.setName('pet');
  // 命令行显式指定 --user-data-dir 时优先用它（自检、多实例调试都靠这个隔离）
  if (!app.commandLine.hasSwitch('user-data-dir')) {
    const overrideData = process.env.PET_USER_DATA;
    app.setPath(
      'userData',
      overrideData ? path.resolve(overrideData) : path.join(app.getPath('appData'), 'pet')
    );
  }
} catch (err) {
  console.log('[pet] 锁定 userData 路径失败', err && err.message);
}

let config = null;
let petWin = null;
let settingsWin = null;
let tray = null;
let monitor = null;
let dragState = null;
let isFirstRun = false;
let quitting = false;

const rendererIssues = [];

function log(...args) {
  console.log('[pet]', ...args);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---------------------------------------------------------------- 配置 */

function findAsset(id) {
  if (!id) return null;
  return config.assets.find((a) => a.id === id) || null;
}

function serializeConfig() {
  return Object.assign({}, config, {
    assets: config.assets.map((a) =>
      Object.assign({}, a, { url: proto.MEDIA_URL(a.file) })
    ),
    meta: { isFirstRun, userData: store.userDataDir(), appVersion: app.getVersion() },
  });
}

function save() {
  store.writeConfig(config);
}

function broadcast(exceptWebContents) {
  const payload = serializeConfig();
  for (const win of [petWin, settingsWin]) {
    if (!win || win.isDestroyed()) continue;
    if (exceptWebContents && win.webContents === exceptWebContents) continue;
    win.webContents.send('config:changed', payload);
  }
}

function applyPatch(patch) {
  if (!patch || typeof patch !== 'object') return;
  if (Array.isArray(patch.functions)) config.functions = patch.functions;
  if (Array.isArray(patch.assets)) config.assets = patch.assets;
  if (patch.pet) config.pet = Object.assign({}, config.pet, patch.pet);
  if (patch.behavior) config.behavior = Object.assign({}, config.behavior, patch.behavior);
  if (patch.system) config.system = Object.assign({}, config.system, patch.system);
  save();
}

/* -------------------------------------------------------------- 位置 */

function defaultPosition(w, h) {
  const d = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(d.x + d.width - w - 48),
    y: Math.round(d.y + d.height - h - 24),
  };
}

function resolvePetPosition(w, h) {
  const fallback = defaultPosition(w, h);
  const x = typeof config.pet.x === 'number' ? config.pet.x : fallback.x;
  const y = typeof config.pet.y === 'number' ? config.pet.y : fallback.y;
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return x + w > a.x && x < a.x + a.width && y + h > a.y && y < a.y + a.height;
  });
  return visible ? { x, y } : fallback;
}

function petBaseSize() {
  const idle = config.functions.find((f) => f.id === 'idle');
  const asset = findAsset(idle && idle.assetId);
  const scale = config.pet.scale || 0.4;
  const bw = (asset && asset.width) || 720;
  const bh = (asset && asset.height) || 720;
  return {
    width: Math.max(80, Math.round(bw * scale)),
    height: Math.max(80, Math.round(bh * scale)),
  };
}

/* ------------------------------------------------------------ 窗口追踪 */

function trackRenderer(win, tag) {
  const wc = win.webContents;
  wc.on('console-message', (...args) => {
    let o;
    if (args[1] && typeof args[1] === 'object') o = args[1];
    else o = { level: args[1], message: args[2], lineNumber: args[3], sourceId: args[4] };
    const lv = String(o.level);
    if (lv === 'error' || lv === 'warning' || lv === '3' || lv === '2') {
      rendererIssues.push({ tag, level: lv, message: o.message, line: o.lineNumber });
      log(`[${tag}][${lv}]`, o.message);
    }
  });
  wc.on('preload-error', (_e, p, err) => {
    rendererIssues.push({ tag, level: 'preload', message: err.message, file: p });
    log(`[${tag}] preload 失败`, p, err.message);
  });
  wc.on('did-fail-load', (_e, code, desc, url) => {
    rendererIssues.push({ tag, level: 'load', message: `${code} ${desc} ${url}` });
    log(`[${tag}] 加载失败`, code, desc, url);
  });
  wc.on('render-process-gone', (_e, details) => {
    rendererIssues.push({ tag, level: 'crash', message: details.reason });
    log(`[${tag}] 渲染进程异常`, details.reason);
  });
}

/* -------------------------------------------------------------- 窗口 */

function createPetWindow() {
  if (petWin && !petWin.isDestroyed()) return petWin;

  const { width, height } = petBaseSize();
  const { x, y } = resolvePetPosition(width, height);

  petWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    // 不可聚焦是关键：规避 Windows DWM 在“透明置顶 + 已聚焦 + 完整遮挡视频”时
    // 把画面合成成黑屏的已知缺陷
    focusable: false,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  trackRenderer(petWin, 'pet');
  petWin.loadURL(proto.APP_URL('pet/index.html'));

  const show = () => {
    if (!petWin || petWin.isDestroyed()) return;
    petWin.showInactive();
    petWin.setIgnoreMouseEvents(!!config.pet.clickThrough, { forward: true });
  };
  petWin.once('ready-to-show', show);
  setTimeout(show, 1500);

  petWin.on('moved', () => {
    if (!petWin || petWin.isDestroyed() || dragState) return;
    const b = petWin.getBounds();
    config.pet.x = b.x;
    config.pet.y = b.y;
    save();
  });

  petWin.on('closed', () => {
    petWin = null;
  });

  return petWin;
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return settingsWin;
  }

  const area = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1040, Math.max(760, area.width - 80));
  const height = Math.min(720, Math.max(560, area.height - 80));

  settingsWin = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(900, width),
    minHeight: Math.min(640, height),
    title: '桌宠设置',
    backgroundColor: '#f5f4ef',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(null);
  trackRenderer(settingsWin, 'settings');
  settingsWin.loadURL(proto.APP_URL('settings/index.html'));

  settingsWin.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      settingsWin.webContents.toggleDevTools();
    }
  });

  settingsWin.on('closed', () => {
    settingsWin = null;
  });

  return settingsWin;
}

function applyClickThrough() {
  if (!petWin || petWin.isDestroyed()) return;
  petWin.setIgnoreMouseEvents(!!config.pet.clickThrough, { forward: true });
}

function refreshTrayMenu() {
  if (!tray) return;
  const petVisible = !!(petWin && !petWin.isDestroyed() && petWin.isVisible());
  const menu = Menu.buildFromTemplate([
    { label: '打开配置面板', click: () => openSettings() },
    { type: 'separator' },
    {
      label: petVisible ? '隐藏桌宠' : '显示桌宠',
      click: () => {
        if (!petWin || petWin.isDestroyed()) {
          createPetWindow();
          return;
        }
        if (petWin.isVisible()) petWin.hide();
        else {
          petWin.showInactive();
          applyClickThrough();
        }
        refreshTrayMenu();
      },
    },
    {
      label: '鼠标穿透',
      type: 'checkbox',
      checked: !!config.pet.clickThrough,
      click: (item) => {
        config.pet.clickThrough = item.checked;
        save();
        applyClickThrough();
        broadcast();
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const iconPath = path.join(APP_ROOT, 'assets', 'tray.png');
  let img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) {
    log('托盘图标缺失，使用空图标', iconPath);
    img = nativeImage.createEmpty();
  }
  tray = new Tray(img.resize({ width: 16, height: 16 }));
  tray.setToolTip('桌宠');
  refreshTrayMenu();
  tray.on('click', () => openSettings());
}

/* -------------------------------------------------------------- 输入 */

function startMonitor() {
  monitor = new InputMonitor(() => {
    if (petWin && !petWin.isDestroyed()) {
      petWin.webContents.send('pet:activity', Date.now());
    }
  });
  const mode = monitor.start();
  log('输入监测模式:', mode);
}

/* -------------------------------------------------------------- IPC */

function registerIpc() {
  ipcMain.handle('config:get', () => serializeConfig());

  ipcMain.handle('config:patch', (e, patch) => {
    applyPatch(patch);
    broadcast(e.sender);
    return serializeConfig();
  });

  ipcMain.handle('assets:import', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(win, {
      title: '选择绿幕动画素材',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '视频', extensions: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return { added: [], failed: [] };

    const { added, failed } = assetsSvc.importFiles(result.filePaths);
    if (added.length) {
      config.assets.push(...added);
      save();
      broadcast();
    }
    return { added, failed };
  });

  ipcMain.handle('assets:delete', (_e, id) => {
    const asset = findAsset(id);
    if (!asset) return { ok: false, reason: '素材不存在' };
    if (asset.builtin) return { ok: false, reason: '内置素材不可删除' };
    if (!assetsSvc.removeAsset(asset)) return { ok: false, reason: '删除失败' };

    config.assets = config.assets.filter((a) => a.id !== id);
    for (const fn of config.functions) {
      if (fn.assetId === id) fn.assetId = null;
    }
    save();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('assets:updateMeta', (_e, id, meta) => {
    const asset = findAsset(id);
    if (!asset) return null;
    if (meta && typeof meta === 'object') {
      for (const k of ['width', 'height', 'duration', 'fps']) {
        if (typeof meta[k] === 'number' && isFinite(meta[k])) asset[k] = meta[k];
      }
      if (typeof meta.hasAlpha === 'boolean') asset.hasAlpha = meta.hasAlpha;
    }
    save();
    broadcast();
    return asset;
  });

  ipcMain.handle('app:finish-setup', () => {
    isFirstRun = false;
    createPetWindow();
    broadcast();
    return true;
  });

  ipcMain.handle('pet:drag-start', () => {
    if (!petWin || petWin.isDestroyed()) return null;
    dragState = {
      cursor: screen.getCursorScreenPoint(),
      bounds: petWin.getBounds(),
    };
    return dragState.bounds;
  });

  ipcMain.on('pet:drag-move', (_e, sx, sy) => {
    if (!petWin || petWin.isDestroyed() || !dragState) return;
    if (typeof sx !== 'number' || typeof sy !== 'number') return;
    const dx = Math.round(sx - dragState.cursor.x);
    const dy = Math.round(sy - dragState.cursor.y);
    petWin.setBounds({
      x: dragState.bounds.x + dx,
      y: dragState.bounds.y + dy,
      width: dragState.bounds.width,
      height: dragState.bounds.height,
    });
  });

  ipcMain.handle('pet:drag-end', () => {
    if (petWin && !petWin.isDestroyed()) {
      const b = petWin.getBounds();
      config.pet.x = b.x;
      config.pet.y = b.y;
      save();
      broadcast();
    }
    dragState = null;
    return true;
  });

  ipcMain.handle('pet:fit', (_e, size) => {
    if (!petWin || petWin.isDestroyed() || !size) return null;
    const scale = config.pet.scale || 0.4;
    const w = Math.max(80, Math.round((size.width || 720) * scale));
    const h = Math.max(80, Math.round((size.height || 720) * scale));
    const b = petWin.getBounds();
    if (b.width === w && b.height === h) return b;
    const next = { x: b.x, y: b.y + b.height - h, width: w, height: h };
    petWin.setBounds(next);
    return next;
  });

  ipcMain.handle('pet:menu', () => {
    if (!petWin) return;
    const menu = Menu.buildFromTemplate([
      { label: '打开配置面板', click: () => openSettings() },
      {
        label: '鼠标穿透',
        type: 'checkbox',
        checked: !!config.pet.clickThrough,
        click: (item) => {
          config.pet.clickThrough = item.checked;
          save();
          applyClickThrough();
          broadcast();
          refreshTrayMenu();
        },
      },
      { type: 'separator' },
      { label: '隐藏桌宠', click: () => { petWin.hide(); refreshTrayMenu(); } },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } },
    ]);
    menu.popup({ window: petWin });
  });

  ipcMain.handle('settings:open', () => {
    openSettings();
    return true;
  });

  ipcMain.handle('window:close', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) win.close();
    return true;
  });

  ipcMain.handle('shell:open-userdata', async () => {
    const { shell } = require('electron');
    await shell.openPath(store.userDataDir());
    return true;
  });
}

/* --------------------------------------------------------- 启动流程 */

async function bootstrap() {
  store.ensureDirs();
  proto.setup({
    appRoot: path.join(APP_ROOT, 'renderer'),
    mediaRoot: store.assetsDir(),
  });

  config = store.readConfig();
  if (!config) {
    isFirstRun = true;
    config = store.emptyConfig();
    const seeded = assetsSvc.seedBuiltins(APP_ROOT, config);
    save();
    log('首次启动，已导入内置素材:', seeded.added.map((a) => a.name).join(', ') || '(无)');
  }

  Menu.setApplicationMenu(null);
  createTray();
  registerIpc();
  startMonitor();

  if (IS_SMOKE) {
    createPetWindow();
    openSettings();
    await runSmoke();
    return;
  }

  if (isFirstRun) {
    openSettings();
  } else {
    createPetWindow();
  }
}

async function runSmoke() {
  await delay(3500);
  fs.mkdirSync(SMOKE_OUT, { recursive: true });

  const shot = async (win, name) => {
    if (!win || win.isDestroyed()) return;
    try {
      const img = await win.capturePage();
      fs.writeFileSync(path.join(SMOKE_OUT, `${name}.png`), img.toPNG());
      log('截图完成', name, JSON.stringify(img.getSize()));
    } catch (err) {
      log('截图失败', name, err.message);
    }
  };

  await shot(petWin, 'pet');
  await shot(settingsWin, 'settings-assets');

  // 模拟一次键盘活动，验证待机 → 敲键盘的切换链路
  if (petWin && !petWin.isDestroyed()) {
    const dump = async (tag) => {
      try {
        const info = await petWin.webContents.executeJavaScript(`(() => {
          const layers = [...document.querySelectorAll('canvas')].map((c) => c.id + ':' + (c.classList.contains('visible') ? 'on' : 'off'));
          const file = (id) => {
            const v = document.getElementById(id);
            const s = v && v.currentSrc ? v.currentSrc.split('/').pop() : '';
            return s + '@' + (v ? v.currentTime.toFixed(2) : '-') + (v && v.paused ? '/暂停' : '/播放');
          };
          return { layers: layers.join(' '), A: file('videoA'), B: file('videoB') };
        })()`);
        log('桌宠状态[' + tag + ']', JSON.stringify(info));
      } catch (err) {
        log('状态读取失败', err.message);
      }
    };

    await dump('idle');
    petWin.webContents.send('pet:activity', Date.now());
    await delay(900);
    await shot(petWin, 'pet-typing');
    await dump('typing');
    await delay(1800);
    await shot(petWin, 'pet-back-to-idle');
    await dump('back');
  }

  try {
    await settingsWin.webContents.executeJavaScript(
      `document.querySelector('.nav-item[data-tab="functions"]').click(); true`
    );
    await delay(1500);
    await shot(settingsWin, 'settings-functions');

    const dom = await settingsWin.webContents.executeJavaScript(`(() => {
      const host = document.querySelector('.keying-host');
      const body = document.querySelector('.main-body');
      const stage = document.querySelector('.preview-stage');
      const side = document.querySelector('.keying-side');
      const r = (el) => (el ? Math.round(el.getBoundingClientRect().height) : 0);
      return {
        hasEditor: !!document.querySelector('.keying .preview-stage canvas'),
        sliders: document.querySelectorAll('.keying-side input[type="range"]').length,
        assetSelect: !!document.querySelector('.asset-bar select'),
        placeholder: !!document.querySelector('.panel-placeholder'),
        hostHeight: r(host),
        stageHeight: r(stage),
        sideHeight: r(side),
        scroll: body ? { content: body.scrollHeight, visible: body.clientHeight } : null,
        parts: {
          panel: r(document.querySelector('.keying-side .panel')),
          preview: r(document.querySelector('.preview-panel')),
          title: r(document.querySelector('.keying-side .panel-title')),
          hint: r(document.querySelector('.hint-bar')),
          color: r(document.querySelector('.color-row')),
          grid: r(document.querySelector('.param-grid')),
          field: r(document.querySelector('.param-grid .field')),
          reset: r(document.querySelector('.panel-reset')),
          assetBar: r(document.querySelector('.asset-bar')),
        },
      };
    })()`);
    log('功能页结构', JSON.stringify(dom));

    await settingsWin.webContents.executeJavaScript(`
      const items = [...document.querySelectorAll('.fn-item')];
      const target = items.find((b) => b.textContent.includes('敲击键盘'));
      if (target) target.click();
      true
    `);
    await delay(1600);
    await shot(settingsWin, 'settings-functions-typing');

    // 切到自带 alpha 的素材，确认参数面板收窄成「只有不透明度」
    await settingsWin.webContents.executeJavaScript(`
      const sel = document.querySelector('.asset-bar select');
      if (!sel) true;
      else {
        const opt = [...sel.options].find((o) => o.textContent.includes('绿背景'));
        if (opt) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      true
    `);
    await delay(1800);
    const alphaDom = await settingsWin.webContents.executeJavaScript(`(() => ({
      sliders: document.querySelectorAll('.keying-side input[type="range"]').length,
      title: (document.querySelector('.keying-side .panel-title') || {}).textContent || '',
    }))()`);
    log('透明通道素材面板', JSON.stringify(alphaDom));
    await shot(settingsWin, 'settings-functions-alpha');
  } catch (err) {
    log('自检交互失败', err.message);
  }

  // 抠像算法自检：合成一张“绿底 + 橙色主体”的图，走一遍色键分支，
  // 期望背景全透明、主体不透明
  try {
    const probe = await settingsWin.webContents.executeJavaScript(`(async () => {
      const m = await import('pet://local/app/shared/keyer.js');
      const src = document.createElement('canvas');
      src.width = 240; src.height = 240;
      const g = src.getContext('2d');
      g.fillStyle = '#00b140'; g.fillRect(0, 0, 240, 240);
      g.fillStyle = '#e8a04a';
      g.beginPath(); g.arc(120, 120, 70, 0, Math.PI * 2); g.fill();
      const out = document.createElement('canvas');
      out.width = 240; out.height = 240;
      const keyer = new m.ChromaKeyer(out);
      keyer.setViewportSize(240, 240, 1);
      keyer.upload(src);
      keyer.render({ srcAlpha: false });
      const flat = document.createElement('canvas');
      flat.width = 240; flat.height = 240;
      const g2 = flat.getContext('2d', { willReadFrequently: true });
      g2.drawImage(out, 0, 0);
      const px = (x, y) => Array.from(g2.getImageData(x, y, 1, 1).data);
      return { bg: px(4, 4), subject: px(120, 120) };
    })()`);
    log('抠像自检', JSON.stringify(probe));
  } catch (err) {
    log('抠像自检失败', err.message);
  }

  fs.writeFileSync(
    path.join(SMOKE_OUT, 'issues.json'),
    JSON.stringify({ issues: rendererIssues, mode: monitor ? monitor.mode : 'none' }, null, 2),
    'utf8'
  );
  log('自检结束，问题数:', rendererIssues.length);
  app.quit();
}

/* -------------------------------------------------------------- 生命周期 */

if (!IS_SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSettings());

  app.whenReady().then(bootstrap).catch((err) => {
    log('启动失败', err && err.stack);
    app.quit();
  });

  app.on('activate', () => {
    if (!settingsWin) openSettings();
  });

  app.on('window-all-closed', () => {
    // 托盘常驻，不随窗口关闭退出
    if (quitting) app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    if (monitor) monitor.stop();
  });
}
