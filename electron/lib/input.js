'use strict';

const { powerMonitor } = require('electron');

/**
 * 全局输入监测。优先用 libuiohook 拿到真实按键事件，
 * 拿不到原生模块时退回 powerMonitor 的系统空闲时长轮询。
 * 两种模式的对外接口一致：只要有“用户在打字”就回调 onActivity。
 */
class InputMonitor {
  constructor(onActivity) {
    this.onActivity = onActivity;
    this.mode = 'none';
    this.hook = null;
    this.timer = null;
    this.prevIdle = 0;
    this.lastEmit = 0;
  }

  start() {
    if (this.tryUiohook()) {
      this.mode = 'uiohook';
    } else {
      this.startIdlePoll();
      this.mode = 'poll';
    }
    return this.mode;
  }

  tryUiohook() {
    let mod;
    try {
      mod = require('uiohook-napi');
    } catch {
      return false;
    }
    try {
      const { uIOhook } = mod;
      if (!uIOhook) return false;
      uIOhook.on('keydown', () => {
        const now = Date.now();
        // 长按会连续触发，节流到 60ms，避免高频 IPC
        if (now - this.lastEmit < 60) return;
        this.lastEmit = now;
        this.onActivity();
      });
      uIOhook.start();
      this.hook = uIOhook;
      return true;
    } catch {
      this.hook = null;
      return false;
    }
  }

  startIdlePoll() {
    this.prevIdle = powerMonitor.getSystemIdleTime();
    this.timer = setInterval(() => {
      let idle = 0;
      try {
        idle = powerMonitor.getSystemIdleTime();
      } catch {
        return;
      }
      if (idle <= 1) {
        this.onActivity();
      }
      this.prevIdle = idle;
    }, 500);
  }

  stop() {
    if (this.hook) {
      try { this.hook.stop(); } catch { /* 已停止 */ }
      this.hook = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.mode = 'none';
  }
}

module.exports = { InputMonitor };
