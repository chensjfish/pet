import { h, toggle, slider, settingRow, fmtSize } from './util.js';

export default {
  render({ header, body, ctx }) {
    const config = ctx.state.config;
    const sys = Object.assign({ autoStart: false, sound: false, volume: 0.5 }, config.system || {});
    const meta = config.meta || {};

    header.append(
      h('div', {},
        h('h1', { class: 'header-title' }, '系统设置'),
        h('p', { class: 'header-desc' }, '这几项对本机生效，改动即时保存。')
      )
    );

    const patchSystem = (patch) => {
      config.system = Object.assign({}, config.system, patch);
      ctx.patch({ system: patch });
    };

    /* ---------------------------------------------------------- 开机自启 */
    const autoDesc = meta.packaged
      ? '登录 Windows 后自动启动桌宠，不用每次手动打开。'
      : '登录 Windows 后自动启动桌宠。（开发模式下不生效，装成安装包或便携版后才有效）';

    const autoStartRow = h('div', { class: 'panel sys-card' },
      settingRow(
        '开机自启',
        autoDesc,
        toggle({
          checked: sys.autoStart,
          onChange: (v) => patchSystem({ autoStart: v }),
        })
      )
    );

    /* -------------------------------------------------------------- 音效 */
    const volumeRow = slider({
      label: '音量',
      min: 0,
      max: 1,
      step: 0.01,
      value: sys.volume,
      format: (v) => Math.round(v * 100) + '%',
      onInput: (v) => patchSystem({ volume: v }),
    });
    volumeRow.classList.add('volume-row');
    volumeRow.setDisabled(!sys.sound);

    const soundToggle = toggle({
      checked: sys.sound,
      onChange: (v) => {
        patchSystem({ sound: v });
        volumeRow.setDisabled(!v);
      },
    });

    const soundRow = h('div', { class: 'panel sys-card' },
      settingRow(
        '音效',
        '播放动画自带的声音。素材没有音轨的话开了也没声音。',
        soundToggle
      ),
      volumeRow
    );

    /* ---------------------------------------------------------- 数据位置 */
    const pathText = h('div', { class: 'path-box mono', text: meta.userData || '(未知)' });
    pathText.title = '点击可全选';

    const dataRow = h('div', { class: 'panel sys-card' },
      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-main' },
          h('div', { class: 'setting-title' }, '数据位置'),
          h('div', { class: 'setting-desc' },
            '素材、缩略图和配置都存在这里，覆盖安装或升级程序不会清空。')
        ),
        h('div', { class: 'setting-control setting-control-row' },
          h('span', {
            class: 'pill',
            text: `${config.assets.length} 个素材 · ${fmtSize(meta.dataSize || 0)}`,
          }),
          h('button', {
            class: 'btn btn-sm',
            type: 'button',
            onclick: () => ctx.api.openUserData(),
          }, '打开目录')
        )
      ),
      pathText
    );

    body.append(autoStartRow, soundRow, dataRow);
  },
};
