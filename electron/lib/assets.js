'use strict';

const fs = require('fs');
const path = require('path');
const { sniffContainer } = require('./sniff');
const store = require('./store');

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi', '.ogv']);

/**
 * 素材名直接用原文件名（含扩展名），这样绿幕版 .mp4 和透明通道版 .webm
 * 天然区分开，不会出现两条同名素材。
 * 这里仍保留去重兜底：同一个文件被重复导入时会带上序号，序号插在扩展名之前。
 */
function uniqueName(filename, taken) {
  if (!taken) return filename;
  if (!taken.has(filename)) {
    taken.add(filename);
    return filename;
  }
  const ext = path.extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  let i = 2;
  let name = `${stem} (${i})${ext}`;
  while (taken.has(name)) {
    i += 1;
    name = `${stem} (${i})${ext}`;
  }
  taken.add(name);
  return name;
}

function copyInto(sourcePath, taken) {
  const sniff = sniffContainer(sourcePath);
  if (!sniff) {
    const ext = path.extname(sourcePath).toLowerCase();
    if (!VIDEO_EXT.has(ext)) {
      throw new Error('无法识别该文件的视频格式');
    }
  }
  const info = sniff || { mime: 'video/mp4', ext: path.extname(sourcePath).toLowerCase() };
  const id = store.nowId();
  const fileName = id + info.ext;
  const target = path.join(store.assetsDir(), fileName);
  fs.copyFileSync(sourcePath, target);
  let size = 0;
  try {
    size = fs.statSync(target).size;
  } catch {
    size = 0;
  }
  return {
    id,
    name: uniqueName(path.basename(sourcePath), taken),
    file: fileName,
    mime: info.mime,
    width: 0,
    height: 0,
    duration: 0,
    size,
    kind: info.kind || null,
    builtin: false,
    addedAt: Date.now(),
  };
}

function importFiles(paths, existingNames) {
  const taken = new Set(existingNames || []);
  const added = [];
  const failed = [];
  for (const p of paths) {
    try {
      added.push(copyInto(p, taken));
    } catch (err) {
      failed.push({ path: p, reason: err.message });
    }
  }
  return { added, failed };
}

function removeAsset(asset) {
  if (!asset || asset.builtin) return false;
  try {
    fs.unlinkSync(store.assetAbsPath(asset));
  } catch {
    // 文件可能已被手动删除，配置项仍然要清掉
  }
  return true;
}

/**
 * 首次启动时把工程根目录下的示例动画导入为内置素材，
 * 并按文件名预绑定到对应功能，方便开箱即用。
 */
function seedBuiltins(appRoot, cfg) {
  let files = [];
  try {
    files = fs
      .readdirSync(appRoot)
      .filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  } catch {
    return { added: [], replaced: false };
  }

  const added = [];
  const taken = new Set((cfg.assets || []).map((a) => a.name));
  for (const f of files) {
    try {
      const asset = copyInto(path.join(appRoot, f), taken);
      asset.builtin = true;
      added.push(asset);
    } catch {
      // 单个文件失败不影响其余素材
    }
  }

  if (added.length) cfg.assets.push(...added);
  const pick = (keywords, fallbackIndex) => {
    const list = Array.isArray(keywords) ? keywords : [keywords];
    // 按文件顺序命中任意一个关键词，而不是先试第一个词再试第二个，
    // 否则「敲键盘.webm」会先于「敲击键盘.mp4」被选中，两个功能绑到的格式不一致
    const hit = added.find((a) => list.some((kw) => a.name.includes(kw)));
    if (hit) return hit.id;
    return added[fallbackIndex] ? added[fallbackIndex].id : null;
  };

  let replaced = false;
  for (const fn of cfg.functions) {
    if (fn.assetId) continue;
    if (fn.id === 'idle') {
      const id = pick(['待机'], 0);
      if (id) { fn.assetId = id; replaced = true; }
    } else if (fn.id === 'typing') {
      // 同一段动画可能叫「敲键盘」也可能叫「敲击键盘」，两种写法都认
      const id = pick(['敲键', '敲击'], 1);
      if (id) { fn.assetId = id; replaced = true; }
    }
  }

  return { added, replaced };
}

module.exports = { importFiles, removeAsset, seedBuiltins, VIDEO_EXT };
