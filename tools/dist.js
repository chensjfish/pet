'use strict';

/**
 * 打包入口。
 *
 * 两个必须处理的环境问题：
 * 1. ELECTRON_RUN_AS_NODE=1 —— 部分宿主终端会带上它，会让 electron 相关的子进程行为异常，这里统一剔除
 * 2. 国内网络 —— electron-builder 会从 GitHub Releases 拉 electron 与 nsis/winCodeSign 工具链，
 *    直连必然失败，所以默认指向 npmmirror 的镜像，已显式设置环境变量时以外部为准
 */

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
env.ELECTRON_MIRROR = env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
env.ELECTRON_BUILDER_BINARIES_MIRROR =
  env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/';

const cli = require.resolve('electron-builder/out/cli/cli.js');
const args = [cli, '--win', ...process.argv.slice(2)];

console.log('[dist] electron-builder 启动，镜像:', env.ELECTRON_BUILDER_BINARIES_MIRROR);

const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env });

if (result.error) {
  console.error('[dist] 启动失败:', result.error.message);
  process.exit(1);
}
process.exit(result.status == null ? 1 : result.status);
