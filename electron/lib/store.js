'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const CONFIG_VERSION = 1;

/**
 * 抠像默认参数。
 * 键色取亮绿而不是 SMPTE 的 #00B140：实际素材（AI 生成、游戏导出）绝大多数是接近纯绿的
 * #00E100 一类，用暗绿做默认会让色差本身吃掉大半个阈值，主体被误判成背景。
 */
const DEFAULT_KEYING = Object.freeze({
  keyColor: '#00e100',
  similarity: 0.15,
  smoothness: 0.14,
  spill: 0.9,
  shrink: 2,
  lumaFloor: 0.06,
  opacity: 1,
});

const DEFAULT_SYSTEM = Object.freeze({
  autoStart: false,
  sound: false,
  volume: 0.5,
});

/**
 * 桌宠缩放：界面上的百分比以「基准尺寸」为 100%。
 * 基准取素材原始尺寸的 40%（720px 的素材即 288px），
 * 这样 10%~150% 正好覆盖 72px ~ 432px，在小屏上七档都可用的。
 */
const PET_BASE_SCALE = 0.4;
const PET_ZOOMS = [10, 20, 30, 50, 80, 100, 150];

const DEFAULT_PET = Object.freeze({
  zoom: 100,
  x: null,
  y: null,
  alwaysOnTop: true,
});

/** 百分比 → 素材像素的缩放系数 */
function effectiveScale(zoom) {
  const z = typeof zoom === 'number' && zoom > 0 ? zoom : 100;
  return PET_BASE_SCALE * (z / 100);
}

function nowId() {
  return crypto.randomBytes(8).toString('hex');
}

function userDataDir() {
  return app.getPath('userData');
}

function assetsDir() {
  return path.join(userDataDir(), 'assets');
}

function configPath() {
  return path.join(userDataDir(), 'config.json');
}

function ensureDirs() {
  fs.mkdirSync(assetsDir(), { recursive: true });
}

function cloneKeying(base) {
  return Object.assign({}, DEFAULT_KEYING, base || {});
}

/** 配置里保存的路径都是相对 assets 目录的文件名，避免换机器后绝对路径失效 */
function assetAbsPath(asset) {
  return path.join(assetsDir(), asset.file);
}

function emptyConfig() {
  return {
    version: CONFIG_VERSION,
    assets: [],
    functions: [
      { id: 'idle', name: '待机', enabled: true, assetId: null, keying: cloneKeying() },
      { id: 'typing', name: '敲击键盘', enabled: true, assetId: null, keying: cloneKeying() },
    ],
    behavior: { typingTimeoutMs: 1200 },
    pet: Object.assign({}, DEFAULT_PET),
    system: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** 读取磁盘配置；不存在或损坏则返回 null，由启动流程决定是否新建 */
function readConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return migrate(parsed);
  } catch {
    return null;
  }
}

function migrate(cfg) {
  const base = emptyConfig();
  const out = Object.assign({}, base, cfg);
  out.version = CONFIG_VERSION;
  out.assets = Array.isArray(cfg.assets) ? cfg.assets : [];
  out.pet = Object.assign({}, DEFAULT_PET, cfg.pet || {});

  // 素材名统一成「原文件名含扩展名」。老配置里存的是去扩展名的名字，
  // 这里按素材实际文件的扩展名补回来，避免新旧命名混在一起
  for (const a of out.assets) {
    if (!a || typeof a.name !== 'string' || !a.file) continue;
    if (path.extname(a.name)) continue;
    const ext = path.extname(a.file);
    if (ext) a.name = a.name + ext;
  }

  // 老配置里存的是原始 scale（0.4），换算成百分比并吸附到最近的档位
  if (cfg.pet && typeof cfg.pet.scale === 'number' && cfg.pet.zoom == null) {
    const percent = (cfg.pet.scale / PET_BASE_SCALE) * 100;
    out.pet.zoom = PET_ZOOMS.reduce(
      (best, z) => (Math.abs(z - percent) < Math.abs(best - percent) ? z : best),
      PET_ZOOMS[0]
    );
  }
  if (typeof out.pet.zoom !== 'number' || !PET_ZOOMS.includes(out.pet.zoom)) {
    out.pet.zoom = 100;
  }
  delete out.pet.scale;
  delete out.pet.clickThrough;
  out.behavior = Object.assign({}, base.behavior, cfg.behavior || {});
  out.system = Object.assign({}, DEFAULT_SYSTEM, cfg.system || {});
  out.system.autoStart = !!out.system.autoStart;
  out.system.sound = !!out.system.sound;
  if (typeof out.system.volume !== 'number' || !Number.isFinite(out.system.volume)) {
    out.system.volume = DEFAULT_SYSTEM.volume;
  }
  out.system.volume = Math.min(1, Math.max(0, out.system.volume));

  // 功能列表按 id 合并，保证内置功能即使配置里缺失也会补回来
  const incoming = Array.isArray(cfg.functions) ? cfg.functions : [];
  out.functions = base.functions.map((def) => {
    const found = incoming.find((f) => f && f.id === def.id);
    if (!found) return def;
    return Object.assign({}, def, found, { keying: cloneKeying(found.keying) });
  });
  // 保留用户后续自定义的功能（当前版本没有入口，但先兼容）
  for (const f of incoming) {
    if (f && f.id && !out.functions.some((x) => x.id === f.id)) {
      out.functions.push(Object.assign({}, f, { keying: cloneKeying(f.keying) }));
    }
  }
  // 丢弃已删除素材的引用
  const ids = new Set(out.assets.map((a) => a.id));
  for (const f of out.functions) {
    if (f.assetId && !ids.has(f.assetId)) f.assetId = null;
  }
  return out;
}

function writeConfig(cfg) {
  ensureDirs();
  cfg.updatedAt = Date.now();
  const tmp = configPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, configPath());
  return cfg;
}

module.exports = {
  CONFIG_VERSION,
  DEFAULT_KEYING,
  DEFAULT_PET,
  DEFAULT_SYSTEM,
  PET_BASE_SCALE,
  PET_ZOOMS,
  effectiveScale,
  nowId,
  userDataDir,
  assetsDir,
  configPath,
  ensureDirs,
  assetAbsPath,
  emptyConfig,
  readConfig,
  writeConfig,
  cloneKeying,
};
