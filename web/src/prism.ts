// The Klix centrepiece: a glass "play" prism with pearl thin-film colour, raymarched in a fragment shader.
// The canvas is transparent, so the page's dot grid shows around the glow.

export const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

export const FRAG = `precision highp float;
uniform vec2 res;
uniform float time;
uniform vec2 mouse;
uniform float spin;
uniform vec3 c0;
uniform vec3 c1;
uniform vec3 c2;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// Equilateral triangle pointing up (Inigo Quilez).
float tri(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

vec3 orient(vec3 p) {
  p.xz *= rot(spin + mouse.x * 0.5);
  p.yz *= rot(0.32 * sin(time * 0.37) + mouse.y * 0.35);
  p.xy *= rot(0.08 * sin(time * 0.23));
  return p;
}

float map(vec3 p) {
  p = orient(p);
  float d2 = tri(vec2(-p.y, p.x + 0.12), 0.56) - 0.2;
  vec2 w = vec2(d2, abs(p.z) - 0.16);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - 0.1;
}

vec3 normalAt(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
}

// Thin-film colour cycling smoothly through the three palette colours.
vec3 pearl(float t) {
  t = fract(t) * 3.0;
  if (t < 1.0) return mix(c0, c1, smoothstep(0.0, 1.0, t));
  if (t < 2.0) return mix(c1, c2, smoothstep(0.0, 1.0, t - 1.0));
  return mix(c2, c0, smoothstep(0.0, 1.0, t - 2.0));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * res) / res.y;
  vec3 ro = vec3(0.0, 0.0, 4.4);
  vec3 rd = normalize(vec3(uv, -1.75));

  float t = 0.0;
  float glow = 0.0;
  float hit = 0.0;
  for (int i = 0; i < 90; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    glow += 0.012 / (0.02 + d * d * 6.0);
    if (d < 0.0008) { hit = 1.0; break; }
    t += d * 0.85;
    if (t > 8.0) break;
  }

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  if (hit > 0.5) {
    vec3 p = ro + rd * t;
    vec3 n = normalAt(p);
    vec3 nl = orient(n);
    float facing = max(dot(-rd, n), 0.0);
    float fres = pow(1.0 - facing, 2.4);
    float film = dot(nl, vec3(0.35, 0.6, 0.2)) * 0.8 + fres * 1.1 + time * 0.03;

    // Reflection of a soft studio: a bright strip overhead, warm floor bounce below.
    vec3 r = reflect(rd, n);
    vec3 env = vec3(1.0, 0.97, 0.94) * smoothstep(0.35, 0.95, r.y) * 1.3
             + pearl(r.x * 0.35 + 0.2) * smoothstep(0.2, -0.8, r.y) * 0.35;
    // Light passing through the glass: brightest where the refracted ray heads straight back.
    vec3 q = refract(rd, n, 0.72);
    float through = pow(max(dot(q, vec3(0.0, 0.0, -1.0)), 0.0), 6.0);
    vec3 op = orient(p);
    float swirl = film + op.x * 0.55 - op.y * 0.45 + 0.15 * sin(op.y * 5.0 + op.x * 3.0 + time * 0.4);
    vec3 body = pearl(swirl) * (0.1 + 0.5 * through) + vec3(1.0, 0.95, 0.92) * pow(through, 14.0) * 0.18;
    vec3 l = normalize(vec3(-0.5, 0.8, 0.7));
    float spec = pow(max(dot(r, l), 0.0), 60.0);
    float rim = smoothstep(0.2, 0.95, fres);

    col = body * (1.0 - fres * 0.5) + env * (0.06 + 0.75 * fres) + pearl(swirl + 0.4) * rim * 0.9 + spec * 1.2;
    alpha = 1.0;
  }
  // Halo around the shape, coloured by angle so it shimmers as it turns.
  float ang = atan(uv.y, uv.x) / 6.2831 + time * 0.02;
  vec3 halo = pearl(ang) * glow * 0.05;
  col += halo * (1.0 - alpha * 0.6);
  alpha = max(alpha, clamp(length(halo) * 1.1, 0.0, 1.0));
  // Fine grain stops banding in the glow.
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + time) * 43758.5453) - 0.5) * 0.02;
  gl_FragColor = vec4(col * alpha, alpha);
}`;

export function startPrism(canvas: HTMLCanvasElement, opts: { scale?: number } = {}): boolean {
  const gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: true, alpha: true });
  if (!gl) return false;
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(sh)); return null; }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return false;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, 'res');
  const uTime = gl.getUniformLocation(prog, 'time');
  const uMouse = gl.getUniformLocation(prog, 'mouse');
  const uSpin = gl.getUniformLocation(prog, 'spin');
  setColors(gl, prog, PEARL);

  const mouse = [0, 0];
  const target = [0, 0];
  addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    target[0] = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (innerWidth / 2)));
    target[1] = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (innerHeight / 2)));
  }, { passive: true });

  const resize = () => {
    const scale = Math.min(devicePixelRatio, 2) * (opts.scale ?? 1);
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * scale));
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();
  addEventListener('resize', resize);

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  const t0 = performance.now();
  const frame = (now: number) => {
    if (visible) {
      const t = still ? 4 : (now - t0) / 1000;
      mouse[0] += (target[0] - mouse[0]) * 0.05;
      mouse[1] += (target[1] - mouse[1]) * 0.05;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uSpin, 0.55 * Math.sin(t * 0.45));
      gl.uniform2f(uMouse, mouse[0], mouse[1]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (!still) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  canvas.classList.add('on');
  return true;
}

/** The site's warm pearl, as the three film colours. */
const PEARL: [string, string, string] = ['#ffd6c0', '#f6bcd8', '#d2c0ff'];

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
/** Film colours are lifted toward white so the glass reads as glass whatever the palette. */
function setColors(gl: WebGLRenderingContext, prog: WebGLProgram, colors: [string, string, string]) {
  colors.forEach((hex, i) => {
    const [r, g, b] = rgb(hex);
    gl.uniform3f(gl.getUniformLocation(prog, 'c' + i), 0.55 + r * 0.45, 0.55 + g * 0.45, 0.55 + b * 0.45);
  });
}

/** Offscreen renderer for the prism inside a video frame. One WebGL context, reused for every frame. */
let off: { canvas: HTMLCanvasElement; gl: WebGLRenderingContext; prog: WebGLProgram } | null | undefined;
function offscreen() {
  if (off !== undefined) return off;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true });
  off = null;
  if (!gl) return off;
  const compile = (type: number, src: string) => { const sh = gl.createShader(type)!; gl.shaderSource(sh, src); gl.compileShader(sh); return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null; };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return off;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return off;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  off = { canvas, gl, prog };
  return off;
}

/** Renders the prism at time t and returns the canvas to draw from, or null without WebGL. */
export function prismFrame(px: number, t: number, colors: [string, string, string], spin: number): HTMLCanvasElement | null {
  const o = offscreen();
  if (!o) return null;
  const { canvas, gl, prog } = o;
  const size = Math.max(64, Math.min(720, Math.round(px)));
  if (canvas.width !== size) { canvas.width = canvas.height = size; gl.viewport(0, 0, size, size); }
  setColors(gl, prog, colors);
  gl.uniform2f(gl.getUniformLocation(prog, 'res'), size, size);
  gl.uniform1f(gl.getUniformLocation(prog, 'time'), t);
  gl.uniform1f(gl.getUniformLocation(prog, 'spin'), spin);
  gl.uniform2f(gl.getUniformLocation(prog, 'mouse'), 0, 0);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return canvas;
}
