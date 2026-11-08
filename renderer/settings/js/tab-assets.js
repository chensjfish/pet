import { h, toast, fmtDuration, fmtSize } from './util.js';

function usageOf(config, assetId) {
  return config.functions.filter((f) => f.assetId === assetId).map((f) => f.name);
}

function metaLine(asset) {
  const parts = [];
  if (asset.width && asset.height) parts.push(`${asset.width}×${asset.height}`);
  if (asset.duration) parts.push(fmtDuration(asset.duration));
  if (asset.size) parts.push(fmtSize(asset.size));
  return parts.join(' · ') || '读取中…';
}

async function upload(ctx) {
  try {
    const res = await ctx.api.importAssets();
    if (res.failed && res.failed.length) {
      const first = res.failed[0];
      toast(`${res.failed.length} 个文件未能导入：${first.reason}`, 'error');
    }
    if (res.added && res.added.length) {
      toast(`已导入 ${res.added.length} 个素材`);
    }
  } catch (err) {
    toast('导入失败：' + err.message, 'error');
  }
}

function confirmDelete(ctx, asset, onDone) {
  let armed = false;
  const btn = h('button', {
    class: 'btn btn-sm btn-danger',
    type: 'button',
    onclick: async () => {
      if (!armed) {
        armed = true;
        btn.textContent = '确认删除';
        setTimeout(() => {
          armed = false;
          btn.textContent = '删除';
        }, 3000);
        return;
      }
      const res = await ctx.api.deleteAsset(asset.id);
      if (!res.ok) {
        toast(res.reason || '删除失败', 'error');
        armed = false;
        btn.textContent = '删除';
        return;
      }
      ctx.state.thumbs.delete(asset.id);
      toast('已删除 ' + asset.name);
      onDone();
    },
  }, '删除');
  return btn;
}

function renderCard(ctx, asset, config) {
  const { state } = ctx;
  const thumb = state.thumbs.get(asset.id);
  const usedBy = usageOf(config, asset.id);

  const thumbNode = thumb
    ? h('img', { src: thumb, alt: asset.name })
    : h('span', { class: 'thumb-fallback', text: thumb === '' ? '无法预览' : '加载中…' });

  const actions = h('div', { class: 'asset-actions' });
  if (asset.hasAlpha === true) {
    actions.append(h('span', { class: 'pill', text: '自带透明通道' }));
  } else if (asset.hasAlpha === false) {
    actions.append(h('span', { class: 'pill', text: '绿幕抠像' }));
  }
  if (usedBy.length) {
    actions.append(h('span', { class: 'pill', text: '用于 ' + usedBy.join(' / ') }));
  }
  if (!asset.builtin) {
    actions.append(confirmDelete(ctx, asset, () => ctx.rerender()));
  }

  return h('article', { class: 'asset-card' },
    h('div', { class: 'asset-thumb' },
      thumbNode,
      asset.builtin ? h('span', { class: 'asset-badge', text: '内置' }) : null
    ),
    h('div', { class: 'asset-info' },
      h('div', { class: 'asset-name', title: asset.name, text: asset.name }),
      h('div', { class: 'asset-meta', text: metaLine(asset) }),
      actions
    )
  );
}

export default {
  render({ header, body, ctx }) {
    const config = ctx.state.config;

    header.append(
      h('div', {},
        h('h1', { class: 'header-title' }, '动画素材'),
        h('p', { class: 'header-desc' },
          '上传绿幕背景的动画，桌宠会对它实时抠像后贴到桌面。支持 mp4 / webm / mov，可以一次选多个文件。')
      ),
      h('div', { class: 'header-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => upload(ctx) }, '上传素材')
      )
    );

    if (!config.assets.length) {
      body.append(
        h('div', { class: 'empty' },
          h('div', { class: 'empty-title' }, '还没有素材'),
          h('p', { class: 'empty-desc' },
            '先上传一段绿幕动画，然后再到「功能模块」里把它分配给待机或敲击键盘。'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => upload(ctx) }, '上传素材')
        )
      );
      return;
    }

    const grid = h('div', { class: 'asset-grid' });
    for (const asset of config.assets) grid.append(renderCard(ctx, asset, config));
    body.append(grid);
  },
};
