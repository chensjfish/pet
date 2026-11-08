import { h } from './util.js';
import { createKeyingEditor } from './keying.js';

function assetSelect(ctx, fn, assets) {
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
    // 同名素材（绿幕版 / 透明通道版）靠后缀区分，否则下拉里两条一模一样
    const tag = a.hasAlpha === true ? '  · 透明通道' : a.hasAlpha === false ? '  · 绿幕' : '';
    const opt = h('option', { value: a.id }, a.name + tag);
    if (a.id === fn.assetId) opt.selected = true;
    select.append(opt);
  }
  return select;
}

function assetMeta(asset) {
  if (!asset) return '';
  const parts = [];
  if (asset.width && asset.height) parts.push(`${asset.width}×${asset.height}`);
  if (asset.duration) parts.push(asset.duration.toFixed(2) + 's');
  if (asset.hasAlpha) parts.push('自带透明通道');
  return parts.join(' · ');
}

export default {
  render({ header, body, ctx }) {
    const state = ctx.state;
    const config = state.config;

    header.append(
      h('div', {},
        h('h1', { class: 'header-title' }, '功能模块'),
        h('p', { class: 'header-desc' },
          '左边选功能，右边直接挑动画、调抠像。改动即时保存并作用到桌面上的桌宠。')
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
      list.append(
        h('button', {
          class: 'fn-item' + (fn.id === selectedId ? ' active' : ''),
          type: 'button',
          onclick: () => {
            state.fnId = fn.id;
            ctx.rerender();
          },
        },
          h('span', { class: 'fn-item-name', text: fn.name })
        )
      );
    }

    const fn = config.functions.find((f) => f.id === selectedId);
    const asset = config.assets.find((a) => a.id === fn.assetId);

    const assetBar = h('div', { class: 'asset-bar' },
      h('span', { class: 'asset-bar-label', text: '动画素材' }),
      assetSelect(ctx, fn, config.assets),
      asset ? h('span', { class: 'asset-bar-meta', text: assetMeta(asset) }) : null
    );

    const detail = h('div', { class: 'fn-detail' }, assetBar);

    const keyingHost = h('div', { class: 'keying-host' });
    detail.append(keyingHost);

    body.append(h('div', { class: 'fn-layout' }, list, detail));

    if (asset) {
      const editor = createKeyingEditor({ ctx, fn, asset, host: keyingHost });
      ctx.onCleanup(() => editor.destroy());
    } else {
      keyingHost.append(
        h('div', { class: 'panel panel-placeholder' },
          h('div', { class: 'empty-desc', text: '这个功能还没绑定动画。在上面选一段素材，抠像设置就会出现在这里。' })
        )
      );
      ctx.onCleanup(() => {});
    }
  },
};
