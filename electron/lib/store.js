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

const DEFAULT_PET = Object.freeze({
  scale: 0.4,
  x: null,
  y: null,
  alwaysOnTop: true,
  clickThrough: false,
});

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
  out.behavior = Object.assign({}, base.behavior, cfg.behavior || {});
  out.system = cfg.system && typeof cfg.system === 'object' ? cfg.system : {};

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
