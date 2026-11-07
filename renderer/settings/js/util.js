/** 极简 DOM 构造器：避免大量 innerHTML 拼接，也便于绑定事件 */
export function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  const a = attrs || {};
  for (const key of Object.keys(a)) {
    const val = a[key];
    if (val == null || val === false) continue;
    if (key === 'class') node.className = val;
    else if (key === 'text') node.textContent = val;
    else if (key === 'html') node.innerHTML = val;
    else if (key === 'dataset') Object.assign(node.dataset, val);
    else if (key === 'style' && typeof val === 'object') Object.assign(node.style, val);
    else if (key.startsWith('on') && typeof val === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key in node && key !== 'list' && key !== 'form') {
      node[key] = val;
    } else {
      node.setAttribute(key, val);
    }
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const child of children.flat(4)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function fmtDuration(sec) {
  const s = Number(sec) || 0;
  return s.toFixed(2) + 's';
}

export function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export function fmtNum(v, digits = 2) {
  return Number(v).toFixed(digits);
}

let toastTimer = null;
export function toast(message, type) {
  const stack = document.getElementById('toasts');
  if (!stack) return;
  const node = h('div', { class: 'toast' + (type === 'error' ? ' error' : ''), text: message });
  stack.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity 180ms ease';
    setTimeout(() => node.remove(), 200);
  }, 2400);
}

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** 带数值读数的滑块，抠像参数面板复用 */
export function slider(opts) {
  const { label, hint, min, max, step, value, format, onInput } = opts;
  const input = h('input', {
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
  });
  const readout = h('span', { class: 'slider-value' });
  const fill = () => {
    const pct = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty('--fill', pct + '%');
    readout.textContent = format ? format(Number(input.value)) : String(input.value);
  };
  fill();
  input.addEventListener('input', () => {
    fill();
    if (onInput) onInput(Number(input.value));
  });
  const row = h('div', { class: 'field' },
    h('div', { class: 'field-label' }, label),
    h('div', { class: 'slider-row' }, input, readout),
    hint ? h('div', { class: 'field-hint' }, hint) : null
  );
  row.setValue = (v) => {
    input.value = String(v);
    fill();
  };
  return row;
}
