/**
 * 侧栏角落里的小伙伴：一只小狗和一只小猫，瞳孔跟着鼠标跑。
 *
 * 原理：眼白是椭圆，瞳孔是贴在里面的小圆点。
 * 先算眼睛中心到指针的极角 atan2(dy, dx)，再沿这个角度求椭圆边界能走到多远，
 * 公式 r = 1 / hypot(cosθ/maxX, sinθ/maxY)，这样不管往哪个方向看，
 * 瞳孔永远卡在眼白里，不会从眼角漏出去。
 * 距离做一次衰减（近处慢慢挪、远处贴到眼角），最后每帧向目标插值，
 * 看起来才像有惯性，而不是钉死在指针上。
 */

const ART = `
<svg class="pals-svg" viewBox="0 0 168 100" aria-hidden="true" focusable="false">
  <ellipse class="pal-shadow" cx="44" cy="94.4" rx="26" ry="3.6" />
  <ellipse class="pal-shadow" cx="125" cy="94.4" rx="24" ry="3.4" />

  <g class="pal pal-dog">
    <g class="tail dog-tail"><path d="M64 90 C74 91 77 84 71 79" /></g>
    <path class="body" d="M22 94 C20 81 25 70 33 66 L55 66 C63 70 68 81 66 94 Z" />
    <g class="ear dog-ear-l"><path d="M30 30 C18 28 9 40 9 54 C9 65 16 72 22 69 C27 66 26 55 28 46 C29 39 31 34 33 31 Z" /></g>
    <g class="ear dog-ear-r"><path d="M58 30 C70 28 79 40 79 54 C79 65 72 72 66 69 C61 66 62 55 60 46 C59 39 57 34 55 31 Z" /></g>
    <g class="head">
      <circle class="skull" cx="44" cy="50" r="23.5" />
      <ellipse class="muzzle" cx="44" cy="62" rx="12.4" ry="8.4" />
      <path class="collar" d="M30 74 C36 81 52 81 58 74" />
      <circle class="tag" cx="44" cy="80.5" r="2.4" />
      <path class="nose" d="M44 56.2 C46.7 56.2 48.2 57.4 48.2 58.9 C48.2 60.9 45.9 63 44 63 C42.1 63 39.8 60.9 39.8 58.9 C39.8 57.4 41.3 56.2 44 56.2 Z" />
      <path class="mouth" d="M44 63 L44 65.6 M44 65.6 C41.6 68.2 38.7 67 37.9 64.8 M44 65.6 C46.4 68.2 49.3 67 50.1 64.8" />
      <ellipse class="blush" cx="30.5" cy="63" rx="4.2" ry="2.8" />
      <ellipse class="blush" cx="57.5" cy="63" rx="4.2" ry="2.8" />
      <g class="eye">
        <ellipse class="sclera" cx="35.6" cy="45.6" rx="7.2" ry="7.8" />
        <g class="pupil">
          <circle class="pupil-dot" cx="35.6" cy="45.6" r="3" />
          <circle class="glint" cx="34.5" cy="44.1" r="1.1" />
        </g>
      </g>
      <g class="eye">
        <ellipse class="sclera" cx="52.4" cy="45.6" rx="7.2" ry="7.8" />
        <g class="pupil">
          <circle class="pupil-dot" cx="52.4" cy="45.6" r="3" />
          <circle class="glint" cx="51.3" cy="44.1" r="1.1" />
        </g>
      </g>
    </g>
  </g>

  <g class="pal pal-cat">
    <g class="tail cat-tail"><path d="M141 88 C155 90 164 79 157 67" /></g>
    <path class="body" d="M107 94 C105 82 110 72 117 68 L132 68 C139 72 144 82 142 94 Z" />
    <g class="ear cat-ear-l">
      <path class="ear-outer" d="M120 31 C117 22 109 15 105.5 13.5 C103.5 18 103.2 30 106 40 C112 39 117 35.5 120 31 Z" />
      <path class="ear-inner" d="M117.5 31.5 C115 25 110 19.6 107.6 18.4 C106.6 22 106.5 29.6 108.2 36.4 C111.8 35.6 115.2 33.4 117.5 31.5 Z" />
    </g>
    <g class="ear cat-ear-r">
      <path class="ear-outer" d="M129 31 C132 22 140 15 143.5 13.5 C145.5 18 145.8 30 143 40 C137 39 132 35.5 129 31 Z" />
      <path class="ear-inner" d="M131.5 31.5 C134 25 139 19.6 141.4 18.4 C142.4 22 142.5 29.6 140.8 36.4 C137.2 35.6 133.8 33.4 131.5 31.5 Z" />
    </g>
    <g class="head">
      <circle class="skull" cx="124.5" cy="50" r="22" />
      <ellipse class="muzzle" cx="124.5" cy="61.5" rx="10.4" ry="7.4" />
      <path class="collar" d="M111 74 C117 80 132 80 138 74" />
      <circle class="bell" cx="124.5" cy="79" r="2.2" />
      <path class="nose" d="M121.9 57.9 Q124.5 56.6 127.1 57.9 Q126.1 60.2 124.5 60.9 Q122.9 60.2 121.9 57.9 Z" />
      <path class="mouth" d="M124.5 60.9 L124.5 62.7 M124.5 62.7 C122.7 64.8 120.9 64.2 120.3 62.6 M124.5 62.7 C126.3 64.8 128.1 64.2 128.7 62.6" />
      <ellipse class="blush" cx="110.5" cy="62.5" rx="4" ry="2.6" />
      <ellipse class="blush" cx="138.5" cy="62.5" rx="4" ry="2.6" />
      <path class="whisker" d="M105 58.5 L95.5 56.5 M105 62 L95.5 63.5 M144 58.5 L153.5 56.5 M144 62 L153.5 63.5" />
      <g class="eye">
        <ellipse class="sclera" cx="116" cy="45.6" rx="7.2" ry="7.8" />
        <g class="pupil">
          <ellipse class="pupil-dot" cx="116" cy="45.6" rx="2.5" ry="3.9" />
          <circle class="glint" cx="115" cy="43.8" r="1" />
        </g>
      </g>
      <g class="eye">
        <ellipse class="sclera" cx="133" cy="45.6" rx="7.2" ry="7.8" />
        <g class="pupil">
          <ellipse class="pupil-dot" cx="133" cy="45.6" rx="2.5" ry="3.9" />
          <circle class="glint" cx="132" cy="43.8" r="1" />
        </g>
      </g>
    </g>
  </g>
</svg>`;

const TRACK_DIST = 220; // 指针离得比这远，瞳孔就贴到眼角
const DAMPING = 0.2; // 每帧向目标插值的比例
const IDLE_AFTER = 3600; // 指针静止这么久之后开始自己东张西望
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function mountPals(host) {
  if (!host || host.querySelector('.pals-svg')) return () => {};

  host.innerHTML = ART;

  const root = host.querySelector('.pals-svg');

  const pets = [...root.querySelectorAll('.pal')].map((el) => ({
    el,
    head: el.querySelector('.head'),
    tilt: 0,
    wantTilt: 0,
    eyes: [...el.querySelectorAll('.eye')].map((g) => {
      const sclera = g.querySelector('.sclera');
      const dot = g.querySelector('.pupil-dot');
      const r = dot.getAttribute('r');
      return {
        g,
        sclera,
        pupil: g.querySelector('.pupil'),
        rx: Number(sclera.getAttribute('rx')),
        ry: Number(sclera.getAttribute('ry')),
        prx: r != null ? Number(r) : Number(dot.getAttribute('rx')),
        pry: r != null ? Number(r) : Number(dot.getAttribute('ry')),
        cx: 0,
        cy: 0,
        x: 0,
        y: 0,
        tx: 0,
        ty: 0,
        shown: '',
      };
    }),
  }));

  /** 眼白在屏幕上的中心：指针坐标是窗口坐标，必须换算到同一套坐标系 */
  const measure = () => {
    for (const pet of pets) {
      const box = pet.head.getBoundingClientRect();
      pet.cx = box.left + box.width / 2;
      pet.cy = box.top + box.height / 2;
      for (const eye of pet.eyes) {
        const rect = eye.sclera.getBoundingClientRect();
        eye.cx = rect.left + rect.width / 2;
        eye.cy = rect.top + rect.height / 2;
      }
    }
  };

  let pointer = null;
  let pointerAt = 0;

  const onPointerMove = (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    pointerAt = performance.now();
  };
  const onPointerOut = () => {
    pointer = null;
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerMove, { passive: true });
  window.addEventListener('blur', onPointerOut);
  document.addEventListener('pointerleave', onPointerOut);

  /* ----------------------------------------------------------- 瞳孔 */

  /** 沿单位方向把瞳孔推到椭圆边界以内，strength 决定离边界还有多远 */
  const aim = (eye, dirX, dirY, strength) => {
    const maxX = Math.max(0.5, eye.rx - eye.prx - 0.6);
    const maxY = Math.max(0.5, eye.ry - eye.pry - 0.6);
    const reach = 1 / Math.hypot(dirX / maxX, dirY / maxY);
    const r = reach * clamp(strength, 0, 1);
    eye.tx = dirX * r;
    eye.ty = dirY * r;
  };

  let wanderDir = { x: 0, y: 1 };
  let wanderStrength = 0.4;
  let wanderAt = 0;

  const frame = () => {
    const now = performance.now();
    const tracking = pointer && now - pointerAt < IDLE_AFTER;

    if (!tracking && !reduced && now > wanderAt) {
      const angle = Math.random() * Math.PI * 2;
      wanderDir = { x: Math.cos(angle), y: Math.sin(angle) };
      wanderStrength = 0.35 + Math.random() * 0.5;
      wanderAt = now + 1400 + Math.random() * 2200;
    }

    for (const pet of pets) {
      if (tracking) {
        const dx = pointer.x - pet.cx;
        pet.wantTilt = clamp(dx / 26, -7, 7);
      } else {
        pet.wantTilt = wanderDir.x * 5;
      }
      pet.tilt += (pet.wantTilt - pet.tilt) * 0.09;
      pet.head.style.transform = `rotate(${pet.tilt.toFixed(2)}deg)`;

      for (const eye of pet.eyes) {
        if (tracking) {
          const dx = pointer.x - eye.cx;
          const dy = pointer.y - eye.cy;
          const dist = Math.hypot(dx, dy) || 1;
          aim(eye, dx / dist, dy / dist, dist / TRACK_DIST);
        } else {
          aim(eye, wanderDir.x, wanderDir.y, wanderStrength);
        }

        eye.x += (eye.tx - eye.x) * DAMPING;
        eye.y += (eye.ty - eye.y) * DAMPING;

        const next = `translate(${eye.x.toFixed(2)}px, ${eye.y.toFixed(2)}px)`;
        if (next !== eye.shown) {
          eye.pupil.style.transform = next;
          eye.shown = next;
        }
      }
    }

    raf = requestAnimationFrame(frame);
  };

  /* ----------------------------------------------------------- 眨眼 */

  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };

  const blinkOnce = (pet, delay = 0) => {
    later(() => {
      const dur = 175;
      for (const eye of pet.eyes) {
        // 眼白压成一条缝，同时把颜色压深，合起来才像"闭眼"而不是"眼睛消失"
        eye.g.animate(
          [
            { transform: 'scaleY(1)' },
            { transform: 'scaleY(0.08)' },
            { transform: 'scaleY(1)' },
          ],
          { duration: dur, easing: 'ease-in-out' }
        );
        eye.sclera.animate(
          [
            { fill: '#fffdf8', offset: 0 },
            { fill: '#fffdf8', offset: 0.42 },
            { fill: '#2c2c2a', offset: 0.5 },
            { fill: '#2c2c2a', offset: 0.56 },
            { fill: '#fffdf8', offset: 1 },
          ],
          { duration: dur, easing: 'ease-in-out' }
        );
      }
    }, delay);
  };

  const blinkLoop = (pet) => {
    later(() => {
      blinkOnce(pet);
      if (Math.random() < 0.28) blinkOnce(pet, 280);
      blinkLoop(pet);
    }, 2600 + Math.random() * 4200);
  };

  /* --------------------------------------------------------- 互动 */

  const onEnter = () => host.classList.add('is-happy');
  const onLeave = () => host.classList.remove('is-happy');

  const onTap = (e) => {
    const box = host.getBoundingClientRect();
    const heart = document.createElement('span');
    heart.className = 'pal-heart';
    heart.textContent = '\u2665';
    heart.style.left = `${e.clientX - box.left}px`;
    heart.style.top = `${e.clientY - box.top}px`;
    heart.style.setProperty('--dx', `${Math.random() * 24 - 12}px`);
    host.append(heart);
    later(() => heart.remove(), 1000);
  };

  host.addEventListener('pointerenter', onEnter);
  host.addEventListener('pointerleave', onLeave);
  host.addEventListener('pointerdown', onTap);

  const onResize = () => measure();
  window.addEventListener('resize', onResize);

  let raf = requestAnimationFrame(() => {
    measure();
    frame();
  });
  later(measure, 600);

  if (!reduced) for (const pet of pets) blinkLoop(pet);

  return () => {
    cancelAnimationFrame(raf);
    for (const t of timers) clearTimeout(t);
    timers.clear();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerMove);
    window.removeEventListener('blur', onPointerOut);
    document.removeEventListener('pointerleave', onPointerOut);
    window.removeEventListener('resize', onResize);
    host.removeEventListener('pointerenter', onEnter);
    host.removeEventListener('pointerleave', onLeave);
    host.removeEventListener('pointerdown', onTap);
    host.innerHTML = '';
  };
}
