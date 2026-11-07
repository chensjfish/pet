import { h, clear, slider, fmtNum } from './util.js';
import { ChromaKeyer, DEFAULT_PARAMS, rgbToHex } from '../../shared/keyer.js';

function waitLoaded(video, event, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('加载超时'));
    }, timeout);
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error('视频解码失败')); };
    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener(event, ok);
      video.removeEventListener('error', bad);
    }
    video.addEventListener(event, ok, { once: true });
    video.addEventListener('error', bad, { once: true });
  });
}

/** 预览器：隐藏 video + WebGL canvas，支持播放与逐帧定位 */
class Preview {
  constructor(canvas, video, stage) {
    this.canvas = canvas;
    this.video = video;
    this.stage = stage;
    this.keyer = new ChromaKeyer(canvas);
    this.params = Object.assign({}, DEFAULT_PARAMS, { srcAlpha: false });
    this.src = '';
    this.playing = false;
    this.vfc = null;
  }

  async load(url) {
    if (this.src === url) return;
    this.src = url;
    this.video.src = url;
    this.video.load();
    await waitLoaded(this.video, 'loadeddata');
    this.video.pause();
    this.video.currentTime = 0;
    await waitLoaded(this.video, 'seeked').catch(() => {});
    const w = this.video.videoWidth || 720;
    const h = this.video.videoHeight || 720;
    this.keyer.setViewportSize(w, h, 1);
    this.draw();
  }

  draw() {
    if (this.video.readyState < 2) return;
    if (this.keyer.upload(this.video)) this.keyer.render(this.params);
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    this.video.play().catch(() => {});
    const onFrame = () => {
      if (!this.playing) return;
      this.draw();
      this.vfc = this.video.requestVideoFrameCallback
        ? this.video.requestVideoFrameCallback(onFrame)
        : requestAnimationFrame(onFrame);
    };
    onFrame();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.video.pause();
    if (this.vfc != null && this.video.cancelVideoFrameCallback) {
      try { this.video.cancelVideoFrameCallback(this.vfc); } catch { /* 忽略 */ }
      this.vfc = null;
    }
    this.draw();
  }

  /** 在预览画面上取色，坐标是相对 canvas 的 CSS 像素 */
  sample(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;

    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (!w || !h) return null;

    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const g = off.getContext('2d', { willReadFrequently: true });
    g.drawImage(this.video, 0, 0, w, h);

    // 取 5x5 邻域平均，避免点到单个噪点
    const cx = Math.round(nx * (w - 1));
    const cy = Math.round(ny * (h - 1));
    const r = 2;
    const data = g.getImageData(
      Math.max(0, cx - r),
      Math.max(0, cy - r),
      Math.min(r * 2 + 1, w),
      Math.min(r * 2 + 1, h)
    ).data;
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      sr += data[i];
      sg += data[i + 1];
      sb += data[i + 2];
      n++;
    }
    if (!n) return null;
    return rgbToHex(sr / n, sg / n, sb / n);
  }

  /** 取四个角的平均值作为自动键色 */
  autoColor() {
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (!w || !h) return null;
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const g = off.getContext('2d', { willReadFrequently: true });
    g.drawImage(this.video, 0, 0, w, h);

    const patch = 12;
    const spots = [
      [2, 2],
      [w - patch - 2, 2],
      [2, h - patch - 2],
      [w - patch - 2, h - patch - 2],
    ];
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (const [x, y] of spots) {
      const d = g.getImageData(x, y, patch, patch).data;
      for (let i = 0; i < d.length; i += 4) {
        sr += d[i];
        sg += d[i + 1];
        sb += d[i + 2];
        n++;
      }
    }
    if (!n) return null;
    return rgbToHex(sr / n, sg / n, sb / n);
  }
}

function previewBackground(stage, mode) {
  stage.classList.remove('bg-checker', 'bg-dark', 'bg-light');
  stage.classList.add(mode === 'dark' ? 'bg-dark' : mode === 'light' ? 'bg-light' : 'bg-checker');
}

export function renderKeying({ header, body, ctx, fn }) {
  const state = ctx.state;
  const asset = state.config.assets.find((a) => a.id === fn.assetId);
  const keying = Object.assign({}, DEFAULT_PARAMS, fn.keying || {});

  header.append(
    h('div', {},
      h('h1', { class: 'header-title' }, '抠像设置 · ' + fn.name),
      h('p', { class: 'header-desc' },
        asset && asset.hasAlpha
          ? '这段素材自带透明通道，背景已经是干净的。拖时间轴逐帧看一下边缘，再决定要不要调不透明度。'
          : '拖动时间轴停在最难抠的一帧，再调参数。绿色边缘在深色背景上最明显，建议三种背景都过一遍。')
    ),
    h('div', { class: 'header-actions' },
      h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => ctx.closeKeying(),
      }, '返回功能列表')
    )
  );

  if (!asset) {
    body.append(
      h('div', { class: 'empty' },
        h('div', { class: 'empty-title' }, '这个功能还没有绑定动画'),
        h('p', { class: 'empty-desc' }, '回到功能列表选一个动画素材，再来调抠像参数。'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.closeKeying() }, '去选择素材')
      )
    );
    return;
  }

  const canvas = h('canvas');
  const stage = h('div', { class: 'preview-stage bg-checker' }, canvas);
  const video = h('video', { class: 'source', muted: true, playsInline: true, preload: 'auto' });
  const timeCur = h('span', { class: 'time', text: '0.00s' });
  const timeTotal = h('span', { class: 'time', text: '0.00s' });
  const timeline = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0' });
  const playBtn = h('button', { class: 'btn btn-sm', type: 'button' }, '播放');

  let swatch;
  let codeText;

  const bgButtons = ['棋盘格', '深色', '浅色'].map((label, i) => {
    const modes = ['checker', 'dark', 'light'];
    return h('button', {
      class: i === 0 ? 'active' : '',
      type: 'button',
      onclick: (e) => {
        previewBackground(stage, modes[i]);
        e.target.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        e.target.classList.add('active');
      },
    }, label);
  });

  body.append(
    h('div', { class: 'keying' },
      h('div', { class: 'preview-panel' },
        h('div', { class: 'preview-toolbar' },
          h('div', { class: 'segmented' }, bgButtons),
          playBtn
        ),
        stage,
        h('div', { class: 'timeline' }, timeCur, timeline, timeTotal)
      ),
      h('div', { class: 'keying-side' },
        h('div', { class: 'panel' },
          h('div', { class: 'panel-title' }, asset.hasAlpha ? '显示设置' : '抠像参数'),
          h('p', { class: 'panel-desc' },
            asset.hasAlpha
              ? '这段素材自带透明通道，背景本来就是透明的，不用做色键抠像。'
              : '在预览画面上点击可以吸取色键颜色。'),
          asset.hasAlpha ? null : buildColorField(),
          buildSliders()
        )
      )
    ),
    video
  );

  const preview = new Preview(canvas, video, stage);

  function commit(patch, { rerenderPanel = false } = {}) {
    Object.assign(fn.keying, patch);
    preview.params = Object.assign(preview.params, fn.keying);
    if (!preview.playing) preview.draw();
    ctx.patch({
      functions: state.config.functions.map((f) =>
        f.id === fn.id ? Object.assign({}, f, { keying: Object.assign({}, fn.keying) }) : f
      ),
    });
    if (rerenderPanel) ctx.rerender();
  }

  function buildColorField() {
    swatch = h('div', {
      class: 'color-swatch',
      style: { background: keying.keyColor },
      title: '点击预览画面取色',
    });
    codeText = h('span', { class: 'color-code', text: keying.keyColor.toUpperCase() });
    return h('div', { class: 'field' },
      h('div', { class: 'field-label' }, '色键颜色'),
      h('div', { class: 'color-field' },
        swatch,
        codeText,
        h('button', {
          class: 'btn btn-sm btn-ghost',
          type: 'button',
          onclick: () => {
            const c = preview.autoColor();
            if (!c) return;
            applyColor(c);
          },
        }, '自动取色')
      ),
      h('div', { class: 'field-hint' }, '默认取画面四角平均色，也可以直接在预览上点背景')
    );
  }

  function applyColor(hex) {
    keying.keyColor = hex;
    if (swatch) swatch.style.background = hex;
    if (codeText) codeText.textContent = hex.toUpperCase();
    commit({ keyColor: hex });
  }

  function buildSliders() {
    const wrap = h('div', {});

    if (asset.hasAlpha) {
      wrap.append(
        slider({
          label: '不透明度',
          hint: '整体透明度，想做半透明桌宠可以调低。',
          min: 0.1, max: 1, step: 0.01, value: keying.opacity,
          format: (v) => Math.round(v * 100) + '%',
          onInput: (v) => commit({ opacity: v }),
        })
      );
      return wrap;
    }

    wrap.append(
      slider({
        label: '相似度',
        hint: '判定为背景的色差范围。调大去得更干净，过大会吃掉人物边缘和绿色衣物。',
        min: 0, max: 1, step: 0.01, value: keying.similarity,
        format: (v) => fmtNum(v),
        onInput: (v) => commit({ similarity: v }),
      }),
      slider({
        label: '柔和度',
        hint: '阈值之后的过渡带宽度，让边缘平滑过渡而不是硬切。',
        min: 0, max: 0.5, step: 0.005, value: keying.smoothness,
        format: (v) => fmtNum(v, 3),
        onInput: (v) => commit({ smoothness: v }),
      }),
      slider({
        label: '溢色抑制',
        hint: '压掉边缘残留的绿色反光。调太高人物会发灰发白。',
        min: 0, max: 1, step: 0.01, value: keying.spill,
        format: (v) => fmtNum(v),
        onInput: (v) => commit({ spill: v }),
      }),
      slider({
        label: '边缘收缩',
        hint: '透明度向内收缩的像素数，用来啃掉一圈绿边。',
        min: 0, max: 4, step: 0.25, value: keying.shrink,
        format: (v) => (v === 0 ? '关闭' : fmtNum(v, 2) + ' px'),
        onInput: (v) => commit({ shrink: v }),
      }),
      slider({
        label: '暗部保护',
        hint: '亮度低于该值的像素强制保留，避免黑发、瞳孔、深色衣服被抠穿。',
        min: 0, max: 0.3, step: 0.005, value: keying.lumaFloor,
        format: (v) => (v === 0 ? '关闭' : fmtNum(v, 3)),
        onInput: (v) => commit({ lumaFloor: v }),
      }),
      slider({
        label: '不透明度',
        hint: '整体透明度，想做半透明桌宠可以调低。',
        min: 0.1, max: 1, step: 0.01, value: keying.opacity,
        format: (v) => Math.round(v * 100) + '%',
        onInput: (v) => commit({ opacity: v }),
      }),
      h('button', {
        class: 'btn btn-sm',
        type: 'button',
        style: { marginTop: '6px' },
        onclick: () => {
          Object.assign(fn.keying, DEFAULT_PARAMS);
          commit(Object.assign({}, DEFAULT_PARAMS), { rerenderPanel: true });
        },
      }, '恢复默认参数')
    );
    return wrap;
  }

  // 预览上取色
  stage.addEventListener('click', (e) => {
    const hex = preview.sample(e.clientX, e.clientY);
    if (hex) applyColor(hex);
  });

  // 时间轴
  timeline.addEventListener('input', () => {
    const t = Number(timeline.value);
    timeCur.textContent = t.toFixed(2) + 's';
    if (!preview.playing) {
      video.currentTime = t;
    }
  });

  video.addEventListener('seeked', () => {
    if (!preview.playing) preview.draw();
  });

  video.addEventListener('timeupdate', () => {
    if (preview.playing) {
      timeCur.textContent = video.currentTime.toFixed(2) + 's';
      timeline.value = String(video.currentTime);
    }
  });

  playBtn.addEventListener('click', () => {
    if (preview.playing) {
      preview.pause();
      playBtn.textContent = '播放';
    } else {
      preview.play();
      playBtn.textContent = '暂停';
    }
  });

  preview.load(asset.url)
    .then(() => {
      preview.params = Object.assign({}, DEFAULT_PARAMS, fn.keying, { srcAlpha: !!asset.hasAlpha });
      const d = video.duration || 0;
      timeTotal.textContent = d.toFixed(2) + 's';
      timeline.max = String(d || 1);
      preview.draw();
    })
    .catch((err) => {
      console.error('抠像预览加载失败', err);
      clear(stage);
      stage.append(h('div', { class: 'empty-desc', text: '预览加载失败：' + err.message }));
    });

  // 离开页面时释放解码资源
  if (ctx.onCleanup) ctx.onCleanup(() => preview.pause());
}
