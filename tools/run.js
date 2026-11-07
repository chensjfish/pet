'use strict';

/**
 * 启动器。
 *
 * 存在的理由：这台机器（以及任何从 Electron 宿主进程里派生的终端）会带上
 * ELECTRON_RUN_AS_NODE=1，此时 electron.exe 会退化成纯 Node 运行，
 * 表现就是 `electron .` 报 “Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')”。
 * 这里显式剔除该变量，保证脚本启动的一定是真正的 Electron 运行时。
 */

const path = require('path');
const { spawn } = require('child_process');

const electronPath = require('electron');
const root = path.join(__dirname, '..');

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code == null ? 0 : code);
});
