/**
 * 绿幕抠像渲染器（WebGL）
 *
 * 原理：绿幕与主体的差别不在“绿”本身，而在色度。把像素转到 YCbCr，
 * 丢掉亮度 Y、只保留 CbCr 平面上的坐标，再算它与键色的欧氏距离。
 * 距离小于相似度阈值 → 完全透明；阈值到阈值+柔和度之间用 smoothstep
 * 做渐变，避免硬边锯齿；最后压掉绿色溢出（溢色抑制）并支持边缘收缩。
 */

const VERT_SRC = `
attribute vec2 aPos;
varying vec2 vUV;
void main() {
  vUV = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision mediump float;

varying vec2 vUV;
uniform sampler2D uTex;
uniform vec3 uKey;
uniform float uSimilarity;
uniform float uSmoothness;
uniform float uSpill;
uniform float uShrink;
uniform float uLumaFloor;
uniform float uOpacity;
uniform float uSrcAlpha;
uniform vec2 uTexel;

vec2 chroma(vec3 c) {
  return vec2(
    -0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b,
     0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b
  );
}

float alphaAt(vec3 c) {
  float d = length(chroma(c) - chroma(uKey));
  float band = max(uSmoothness, 0.001);
  float a = smoothstep(uSimilarity, uSimilarity + band, d);

  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  float f = max(uLumaFloor, 0.001);
  float protect = 1.0 - smoothstep(f, f * 2.0, luma);
  return max(a, protect * step(0.001, uLumaFloor));
}

void main() {
  vec4 src = texture2D(uTex, vUV);
  vec3 c = src.rgb;
  float a = alphaAt(c);

  if (uShrink > 0.01 && uSrcAlpha < 0.5) {
    vec2 o = uTexel * uShrink;
    a = min(a, alphaAt(texture2D(uTex, vUV + vec2(o.x, 0.0)).rgb));
    a = min(a, alphaAt(texture2D(uTex, vUV - vec2(o.x, 0.0)).rgb));
    a = min(a, alphaAt(texture2D(uTex, vUV + vec2(0.0, o.y)).rgb));
    a = min(a, alphaAt(texture2D(uTex, vUV - vec2(0.0, o.y)).rgb));
  }

  // 溢色抑制：绿色通道高于红蓝最大值的那部分，按强度压回去
  float m = max(c.r, c.b);
  c.g = mix(c.g, min(c.g, m), uSpill);

  // 素材自带 alpha 时直接用它，色键参数不参与，否则会把主体当成背景吃掉；
  // 普通绿幕素材 src.a 恒为 1，走正常抠像分支
  a = mix(a, 1.0, uSrcAlpha);

  float outA = a * src.a * uOpacity;
  gl_FragColor = vec4(c * outA, outA);
}
`;

export const DEFAULT_PARAMS = {
  keyColor: '#00b140',
  similarity: 0.32,
  smoothness: 0.14,
  spill: 0.65,
  shrink: 1,
  lumaFloor: 0.06,
  opacity: 1,
};

export function hexToRgb(hex) {
  const s = String(hex || '').trim().replace('#', '');
  const full = s.length === 3 ? s.split('').map((ch) => ch + ch).join('') : s.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  if (!isFinite(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(r, g, b) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('着色器编译失败: ' + info);
  }
  return sh;
}

export class ChromaKeyer {
  constructor(canvas) {
    this.canvas = canvas;
    const opts = {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('当前环境不支持 WebGL，无法进行抠像');
    this.gl = gl;
    this.hasFrame = false;
    this.sourceWidth = 0;
    this.sourceHeight = 0;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(prog));
    }
    this.program = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);

    this.uniforms = {};
    for (const name of [
      'uTex', 'uKey', 'uSimilarity', 'uSmoothness', 'uSpill',
      'uShrink', 'uLumaFloor', 'uOpacity', 'uSrcAlpha', 'uTexel',
    ]) {
      this.uniforms[name] = gl.getUniformLocation(prog, name);
    }

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.hasFrame = false;
    });
  }

  /** 按 CSS 尺寸 × DPR 设置绘制缓冲区，保证高分屏下不糊 */
  setViewportSize(cssWidth, cssHeight, dpr = 1) {
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** 把视频/画布的当前帧上传为纹理 */
  upload(source) {
    const gl = this.gl;
    const w = source.videoWidth || source.width;
    const h = source.videoHeight || source.height;
    if (!w || !h) return false;
    this.sourceWidth = w;
    this.sourceHeight = h;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.hasFrame = true;
    return true;
  }

  render(params = {}) {
    const gl = this.gl;
    const p = Object.assign({}, DEFAULT_PARAMS, params);

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.hasFrame) return;

    gl.useProgram(this.program);
    const u = this.uniforms;

    const [kr, kg, kb] = hexToRgb(p.keyColor);
    gl.uniform3f(u.uKey, kr, kg, kb);
    gl.uniform1f(u.uSimilarity, clamp01(p.similarity));
    gl.uniform1f(u.uSmoothness, clamp01(p.smoothness));
    gl.uniform1f(u.uSpill, clamp01(p.spill));
    gl.uniform1f(u.uShrink, Math.max(0, Math.min(4, Number(p.shrink) || 0)));
    gl.uniform1f(u.uLumaFloor, clamp01(p.lumaFloor));
    gl.uniform1f(u.uOpacity, clamp01(p.opacity));
    gl.uniform1f(u.uSrcAlpha, p.srcAlpha ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(u.uTex, 0);
    gl.uniform2f(u.uTexel, 1 / (this.sourceWidth || 1), 1 / (this.sourceHeight || 1));

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  clear() {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.hasFrame = false;
  }
}

function clamp01(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
