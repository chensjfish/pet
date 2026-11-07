import { h, fmtNum } from './util.js';
import { renderKeying } from './keying.js';
import { DEFAULT_PARAMS } from '../../shared/keyer.js';

const FN_DESC = {
  idle: '平时常驻播放的动画。',
  typing: '检测到键盘输入时切换到这个动画，停手后自动回到待机。',
};

function keyingSummary(keying, asset) {
  const k = Object.assign({}, DEFAULT_PARAMS, keying || {});
  if (asset && asset.hasAlpha) {
    return `自带透明通道 · 不透明度 ${Math.round(k.opacity * 100)}%`;
  }
  return `相似度 ${fmtNum(k.similarity)} · 柔和度 ${fmtNum(k.smoothness, 3)} · 溢色 ${fmtNum(k.spill)}`;
}

function selectAsset(ctx, fn, assets) {
  const select = h('select', {
    onchange: (e) => {
      const id = e.target.value || null;
      const list = ctx.state.config.functions.map((f) =>
        f.id === fn.id ? Object.assign({}, f, { assetId: id }) : f
      );
      ctx.state.config.functions = list;
      ctx.patch({ functions: list });
      ctx.rerender();
    },
  });
  select.append(h('option', { value: '' }, '未选择'));
  for (const a of assets) {
    const opt = h('option', { value: a.id }, a.name);
    if (a.id === fn.assetId) opt.selected = true;
    select.append(opt);
  }
  return select;
}

export default {
  render({ header, body, ctx }) {
    const state = ctx.state;
    const config = state.config;

    const keyingFn = state.keyingFnId
      ? config.functions.find((f) => f.id === state.keyingFnId)
      : null;
    if (keyingFn) {
      renderKeying({ header, body, ctx, fn: keyingFn });
      return;
    }

    header.append(
      h('div', {},
        h('h1', { class: 'header-title' }, '功能模块'),
        h('p', { class: 'header-desc' },
          '每个功能绑定一段动画。选好动画后再进抠像设置，把它变成透明背景。')
      )
    );

    if (!config.assets.length) {
      body.append(
        h('div', { class: 'empty' },
          h('div', { class: 'empty-title' }, '还没有可用的动画素材'),
          h('p', { class: 'empty-desc' }, '先去「动画素材」上传绿幕动画，再回来给功能绑定。')
        )
      );
      return;
    }

    const selectedId = config.functions.some((f) => f.id === state.fnId)
      ? state.fnId
      : config.functions[0].id;

    const list = h('div', { class: 'fn-list' });
    for (const fn of config.functions) {
      const asset = config.assets.find((a) => a.id === fn.assetId);
      list.append(
        h('button', {
          class: 'fn-item' + (fn.id === selectedId ? ' active' : ''),
          type: 'button',
          onclick: () => {
            state.fnId = fn.id;
            ctx.rerender();
          },
        },
          h('span', { class: 'fn-item-name', text: fn.name }),
          h('span', { class: 'fn-item-sub', text: asset ? asset.name : '未绑定素材' })
        )
      );
    }

    const fn = config.functions.find((f) => f.id === selectedId);
    const asset = config.assets.find((a) => a.id === fn.assetId);

    const detail = h('div', {},
      h('div', { class: 'panel' },
        h('h2', { class: 'panel-title' }, fn.name),
        h('p', { class: 'panel-desc' }, FN_DESC[fn.id] || ''),
        h('div', { class: 'field' },
          h('div', { class: 'field-label' }, '动画素材'),
          selectAsset(ctx, fn, config.assets),
          h('div', { class: 'field-hint' },
            asset
              ? `${asset.width || '?'}×${asset.height || '?'} · ${(asset.duration || 0).toFixed(2)}s`
              : '选择一段绿幕动画作为这个功能的画面')
        )
      ),
      h('div', { class: 'panel' },
        h('h2', { class: 'panel-title' }, '抠像'),
        h('p', { class: 'panel-desc' }, '把绿幕背景去掉，让桌宠透明地贴在桌面上。'),
        h('div', { class: 'field' },
          h('div', { class: 'field-label' }, '当前参数'),
          h('div', { class: 'field-hint mono', text: asset ? keyingSummary(fn.keying, asset) : '先绑定动画素材' })
        ),
        h('button', {
          class: 'btn btn-primary',
          type: 'button',
          disabled: !asset,
          onclick: () => {
            state.keyingFnId = fn.id;
            ctx.rerender();
          },
        }, '进入抠像设置')
      )
    );

    body.append(
      h('div', { class: 'fn-layout' },
        h('div', {},
          list,
          h('div', { class: 'field-hint', style: { padding: '10px 12px 0' } }, '更多功能会在后续版本加入')
        ),
        detail
      )
    );
  },
};
