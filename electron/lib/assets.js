'use strict';

const fs = require('fs');
const path = require('path');
const { sniffContainer } = require('./sniff');
const store = require('./store');

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi', '.ogv']);

function copyInto(sourcePath) {
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
    name: path.basename(sourcePath, path.extname(sourcePath)),
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

function importFiles(paths) {
  const added = [];
  const failed = [];
  for (const p of paths) {
    try {
      added.push(copyInto(p));
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
  for (const f of files) {
    try {
      const asset = copyInto(path.join(appRoot, f));
      asset.builtin = true;
      added.push(asset);
    } catch {
      // 单个文件失败不影响其余素材
    }
  }

  if (added.length) cfg.assets.push(...added);
  const pick = (keyword, fallbackIndex) => {
    const hit = added.find((a) => a.name.includes(keyword));
    if (hit) return hit.id;
    return added[fallbackIndex] ? added[fallbackIndex].id : null;
  };

  let replaced = false;
  for (const fn of cfg.functions) {
    if (fn.assetId) continue;
    if (fn.id === 'idle') {
      const id = pick('待机', 0);
      if (id) { fn.assetId = id; replaced = true; }
    } else if (fn.id === 'typing') {
      const id = pick('敲键', 1);
      if (id) { fn.assetId = id; replaced = true; }
    }
  }

  return { added, replaced };
}

module.exports = { importFiles, removeAsset, seedBuiltins, VIDEO_EXT };
