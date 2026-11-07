import { h } from './util.js';

const ITEMS = [
  { name: '开机自启', sub: '登录后自动把桌宠放到桌面' },
  { name: '全局快捷键', sub: '用键盘快速呼出配置面板或隐藏桌宠' },
  { name: '宠物缩放', sub: '调整桌宠在桌面上的显示大小' },
  { name: '显示层级', sub: '是否始终置顶、是否在任务栏显示' },
  { name: '音效', sub: '动画自带音轨的播放与音量' },
];

export default {
  render({ header, body, ctx }) {
    header.append(
      h('div', {},
        h('h1', { class: 'header-title' }, '系统设置'),
        h('p', { class: 'header-desc' }, '这一版先把入口留出来，下面这些项会在后续版本补齐。')
      )
    );

    const list = h('div', { class: 'placeholder-list' });
    for (const item of ITEMS) {
      list.append(
        h('div', { class: 'placeholder-item' },
          h('div', {},
            h('div', { class: 'name', text: item.name }),
            h('div', { class: 'sub', text: item.sub })
          ),
          h('span', { class: 'pill', text: '即将支持' })
        )
      );
    }

    const meta = ctx.state.config.meta || {};
    body.append(
      list,
      h('div', { class: 'panel', style: { marginTop: '20px' } },
        h('h2', { class: 'panel-title' }, '数据位置'),
        h('p', { class: 'panel-desc' },
          '素材和配置都保存在本机的用户数据目录里，升级或重装不会丢失。'),
        h('div', { class: 'field' },
          h('div', { class: 'field-hint mono', text: meta.userData || '(未知)' })
        ),
        h('button', {
          class: 'btn btn-sm',
          type: 'button',
          onclick: () => ctx.api.openUserData(),
        }, '打开目录')
      )
    );
  },
};
