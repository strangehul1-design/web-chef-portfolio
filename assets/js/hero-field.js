/* ═══════════════════════════════════════════════════════════════
   Сцена на обложке — «поле из сетки».

   Первый экран — лист в точку, как миллиметровка, уложенный
   в перспективу. Поле медленно дышит, под курсором точки поднимаются
   линзой и загораются синим, по касанию расходится волна.

   Визуальный контракт (проверяется в ?debug=1 и режимах ?view=):
   - ряды и столбцы читаются как сетка — смещение только по высоте;
   - дальние ряды гаснут раньше, чем становятся мельче пикселя
     (иначе рябь и муар);
   - постобработки нет: итоговый кадр и кадр «без пост-эффектов»
     совпадают;
   - один вызов отрисовки на всю сцену.

   Когда сцены нет, а виден статичный фон (точки на CSS и мягкое синее пятно):
   - включено «уменьшить движение»;
   - режим экономии трафика;
   - слабое устройство (≤2 ядра или ≤2 ГБ памяти);
   - WebGL недоступен или работает программно;
   - сцена не держит частоту кадров даже на низком качестве;
   - потерян WebGL-контекст.

   Отладка (параметры адреса):
   ?webgl=0          сразу статичный фон
   ?gl=force         разрешить программный WebGL (для headless-проверок)
   ?tier=high|mid|low  стартовое качество
   ?governor=0       не снижать качество автоматически
   ?debug=1          панель: FPS, мс на кадр, качество, точки, вызовы
   ?view=height|lens|lattice  диагностические виды вместо итогового
   ?cam=near|far     другие точки съёмки
   ?t=4.2            один кадр в момент 4.2 с, без анимации
   ?px=0.5&py=0.6    положение курсора в долях холста (для ?t)
   ?ripple=0.8       волна, запущенная 0.8 с назад (для ?t)
   ═══════════════════════════════════════════════════════════════ */

const params = new URLSearchParams(location.search);
const host = document.querySelector('[data-hero-field]');

const TIERS = {
  high: { spacing: 0.13, dpr: 1.5, size: 3.1 },
  mid: { spacing: 0.17, dpr: 1.25, size: 3.4 },
  low: { spacing: 0.23, dpr: 1, size: 3.8 },
};
const ORDER = ['high', 'mid', 'low'];

// Поле лежит в плоскости y = 0: x — поперёк, z — вглубь (к камере — плюс).
const FIELD = { zNear: 3.2, zFar: -17 };
const FOV = 38;
const CAMERAS = {
  design: { pos: [0, 5.4, 5.6], look: [0, 0, -3.4] },
  near: { pos: [0, 3, 3.4], look: [0, 0, -1.6] },
  far: { pos: [0, 9, 10], look: [0, 0, -5] },
};

const INK = '#0B1220';      // --ink: точки поля
const HOT = '#2F5BFF';      // --accent: точки в линзе
const PAPER = '#E9EDF3';    // --paper: фон первого экрана
// Сила линзы, когда курсора нет (телефон или мышь давно не двигалась).
const IDLE_LENS = 0.65;

if (host) boot(host);

function setState(state, reason) {
  host.dataset.hero = state;
  if (reason) host.dataset.heroReason = reason;
  else delete host.dataset.heroReason;
}

function staticReason() {
  if (params.get('webgl') === '0') return 'disabled-by-url';
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduced-motion';
  if (navigator.connection && navigator.connection.saveData) return 'save-data';
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  if (cores <= 2 || memory <= 2) return 'low-end-device';
  return null;
}

function startTier() {
  const forced = params.get('tier');
  if (forced && TIERS[forced]) return forced;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const memory = navigator.deviceMemory || 8;
  if (memory <= 4) return 'low';
  return coarse || innerWidth < 900 ? 'mid' : 'high';
}

function whenIdle() {
  return new Promise((resolve) => {
    const go = () => ('requestIdleCallback' in window ? requestIdleCallback(resolve, { timeout: 1200 }) : setTimeout(resolve, 200));
    if (document.readyState === 'complete') go();
    else addEventListener('load', go, { once: true });
  });
}

async function boot(el) {
  const reason = staticReason();
  if (reason) return setState('static', reason);
  setState('loading');
  await whenIdle();

  let THREE;
  try {
    THREE = await import('../vendor/three-hero.min.js');
  } catch (err) {
    return setState('static', 'script-failed');
  }
  try {
    new FieldScene(el, THREE).start();
  } catch (err) {
    console.warn('[hero] fallback:', err && err.message);
    setState('static', err && err.code ? err.code : 'init-failed');
  }
}

function isSoftwareRenderer(gl) {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(String(name));
  } catch (err) {
    return false;
  }
}

/* ── Шейдеры ─────────────────────────────────────────────────── */

// 3D simplex noise — Ian McEwan, Stefan Gustavson (Ashima Arts), MIT.
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const VERTEX = /* glsl */ `
uniform float uTime;
uniform vec2 uPointer;
uniform float uLens;
uniform vec3 uRipple;
uniform float uSize;
uniform float uPixelRatio;
varying float vAlpha;
varying float vHeat;
varying float vHeight;
${NOISE}
void main(){
  vec3 p = position;

  // Дыхание поля: крупная медленная волна и мелкая рябь поверх.
  float swell = snoise(vec3(p.x * 0.16, p.z * 0.16, uTime * 0.07));
  float detail = snoise(vec3(p.x * 0.55, p.z * 0.55, uTime * 0.16));
  float n = swell * 0.75 + detail * 0.25;

  // Линза под курсором: гауссов купол.
  float d = distance(p.xz, uPointer);
  float lens = exp(-d * d * 0.42) * uLens;

  // Волна от касания: кольцо, бегущее от точки со скоростью 3.4 ед/с.
  float age = uTime - uRipple.z;
  float ring = 0.0;
  if (age > 0.0 && age < 2.2) {
    float rd = distance(p.xz, uRipple.xy) - age * 3.4;
    ring = cos(rd * 2.6) * exp(-rd * rd * 0.9) * (1.0 - age / 2.2);
  }

  p.y += n * 0.32 + lens * 0.85 + ring * 0.22;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  float size = uSize * uPixelRatio * clamp(9.0 / depth, 0.45, 2.2) * (1.0 + lens * 1.1);
  gl_PointSize = size;
  gl_Position = projectionMatrix * mv;

  // Дальние ряды гаснут до того, как станут мельче пикселя.
  float fog = smoothstep(27.0, 9.0, depth) * smoothstep(1.0, 1.8, size / uPixelRatio);
  vAlpha = fog * (0.3 + 0.25 * (n * 0.5 + 0.5)) + lens * 0.6 + max(ring, 0.0) * 0.3 * fog;
  vHeat = clamp(lens * 1.15 + max(ring, 0.0) * 0.5, 0.0, 1.0);
  vHeight = p.y;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uHot;
uniform float uView;
varying float vAlpha;
varying float vHeat;
varying float vHeight;
void main(){
  float r = length(gl_PointCoord - 0.5);
  if (r > 0.5) discard;
  float core = smoothstep(0.5, 0.0, r);

  vec4 color;
  if (uView < 0.5) {
    // Итоговый вид: тёмные точки на бумаге, в линзе — сигнальный цвет.
    vec3 c = mix(uBase, uHot, smoothstep(0.1, 0.8, vHeat));
    color = vec4(c, vAlpha * core);
  } else if (uView < 1.5) {
    // Высота: синий — впадина, оранжевый — гребень.
    float h = clamp(vHeight * 0.9 + 0.5, 0.0, 1.0);
    color = vec4(mix(vec3(0.1, 0.3, 1.0), vec3(1.0, 0.45, 0.1), h), core);
  } else if (uView < 2.5) {
    // Линза и волна: серое = нет влияния, белое = полное.
    color = vec4(vec3(0.15 + 0.85 * vHeat), core);
  } else {
    // Решётка без тумана и цвета — видно, где стоят точки.
    color = vec4(vec3(0.1), core);
  }
  gl_FragColor = color;
  #include <colorspace_fragment>
}`;

/* ── Сцена ───────────────────────────────────────────────────── */

class FieldScene {
  constructor(el, THREE) {
    this.el = el;
    this.T = THREE;
    this.seek = params.has('t') ? parseFloat(params.get('t')) || 0 : null;
    this.governor = params.get('governor') !== '0' && this.seek === null;
    this.tierIndex = ORDER.indexOf(startTier());
    this.camKey = CAMERAS[params.get('cam')] ? params.get('cam') : 'design';
    this.view = { height: 1, lens: 2, lattice: 3 }[params.get('view')] || 0;

    // Состояние линзы: пружина с критическим затуханием (без перелёта).
    this.pointer = { x: 0, z: -1.5, vx: 0, vz: 0, tx: 0, tz: -1.5 };
    this.lens = { v: 0, vel: 0, target: 0 };
    this.lastInput = -Infinity;
    this.time = 0;
    this.frames = { last: 0, samples: [], warm: 0, shown: [] };

    this._ray = new THREE.Vector3();
    this._ndc = new THREE.Vector2();

    const canvas = document.createElement('canvas');
    canvas.className = 'hero-field__canvas';
    canvas.setAttribute('aria-hidden', 'true');

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,           // точки круглые из-за шейдера, MSAA им не нужен
        alpha: false,
        powerPreference: 'low-power',
        failIfMajorPerformanceCaveat: params.get('gl') !== 'force',
      });
    } catch (err) {
      const e = new Error('WebGL недоступен');
      e.code = 'no-webgl';
      throw e;
    }
    // failIfMajorPerformanceCaveat ловит не всё: Chrome может отдать программный
    // рендер (SwiftShader) как обычный. Такой рендер на весь экран не тянет 60 кадров.
    if (params.get('gl') !== 'force' && isSoftwareRenderer(renderer.getContext())) {
      renderer.dispose();
      const e = new Error('WebGL работает программно');
      e.code = 'software-webgl';
      throw e;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(new THREE.Color(PAPER), 1);
    this.renderer = renderer;
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
    const cam = CAMERAS[this.camKey];
    this.camera.position.set(...cam.pos);
    this.camera.lookAt(...cam.look);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uPointer: { value: new THREE.Vector2(0, -1.5) },
        uLens: { value: 0 },
        uRipple: { value: new THREE.Vector3(0, 0, -100) },
        uSize: { value: TIERS[ORDER[this.tierIndex]].size },
        uPixelRatio: { value: 1 },
        uBase: { value: new THREE.Color(INK) },
        uHot: { value: new THREE.Color(HOT) },
        uView: { value: this.view },
      },
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false; // поле всегда в кадре, считать границы незачем
    this.points.matrixAutoUpdate = false;
    this.scene.add(this.points);

    this.tick = this.tick.bind(this);
  }

  get tier() { return ORDER[this.tierIndex]; }

  start() {
    const { el, canvas } = this;
    el.appendChild(canvas);
    this.resize(true);

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.giveUp('context-lost'); });

    this.ro = new ResizeObserver(() => this.resize(false));
    this.ro.observe(el);

    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.onReduced = () => { if (this.reduced.matches) this.giveUp('reduced-motion'); };
    this.reduced.addEventListener('change', this.onReduced);

    if (params.get('debug') === '1') this.mountDebug();

    if (this.seek !== null) return this.renderSeek();

    this.bindInput();
    this.visible = true;
    // Кнопка «Остановить анимацию» (site.js): поле замирает на текущем кадре.
    this.paused = document.body.classList.contains('motion-paused');
    this.onMotion = (e) => { this.paused = e.detail.paused; this.updateLoop(); };
    window.addEventListener('webchef:motion', this.onMotion);
    this.io = new IntersectionObserver(([entry]) => { this.visible = entry.isIntersecting; this.updateLoop(); });
    this.io.observe(el);
    this.onVisibility = () => this.updateLoop();
    document.addEventListener('visibilitychange', this.onVisibility);

    // Шейдер компилируется до первого видимого кадра, чтобы не дёрнуть страницу.
    this.renderer.compileAsync(this.scene, this.camera).then(() => {
      if (this.dead) return;
      this.startedAt = performance.now();
      this.updateLoop();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (this.dead) return;
        el.classList.add('is-live');
        setState('live');
      }));
    });
    window.__hero = this.api();
  }

  api() {
    return {
      stats: () => this.stats(),
      pause: () => { this.paused = true; this.updateLoop(); },
      resume: () => { this.paused = false; this.updateLoop(); },
      // Замер для проверок: n кадров подряд, после каждого — чтение пикселя,
      // чтобы дождаться видеокарты. Возвращает мс на кадр (CPU + GPU).
      bench: (frames = 120) => {
        const gl = this.renderer.getContext();
        const px = new Uint8Array(4);
        const t0 = performance.now();
        for (let i = 0; i < frames; i++) {
          this.time += 1 / 60;
          this.step(1 / 60);
          this.renderer.render(this.scene, this.camera);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        }
        return Math.round(((performance.now() - t0) / frames) * 100) / 100;
      },
    };
  }

  updateLoop() {
    const run = !this.dead && !this.paused && this.visible && !document.hidden;
    this.renderer.setAnimationLoop(run ? this.tick : null);
    if (!run) this.frames.last = 0; // пауза не должна попасть в замер частоты
  }

  /* Сетка строится трапецией: каждый ряд ровно такой ширины, какую
     видит камера на этой глубине (+ запас на линзу). Прямоугольник
     того же охвата дал бы в 2–3 раза больше точек за кадром. */
  buildGeometry() {
    const { spacing } = TIERS[this.tier];
    const cam = this.camera;
    const tanHalf = Math.tan((FOV * Math.PI) / 360) * cam.aspect;
    const pos = [];
    for (let z = FIELD.zNear; z >= FIELD.zFar; z -= spacing) {
      const dist = Math.hypot(cam.position.y, cam.position.z - z);
      const half = dist * tanHalf * 1.18 + 0.6;
      const cols = Math.ceil(half / spacing);
      for (let c = -cols; c <= cols; c++) pos.push(c * spacing, 0, z);
    }
    const geometry = new this.T.BufferGeometry();
    geometry.setAttribute('position', new this.T.Float32BufferAttribute(pos, 3));
    const old = this.points.geometry;
    this.points.geometry = geometry;
    old.dispose();
    this.pointCount = pos.length / 3;
  }

  resize(force) {
    const w = Math.max(1, this.el.clientWidth);
    const h = Math.max(1, this.el.clientHeight);
    const aspect = w / h;
    const dpr = Math.min(devicePixelRatio || 1, TIERS[this.tier].dpr);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.material.uniforms.uPixelRatio.value = dpr;
    if (force || !this.builtAspect || Math.abs(aspect / this.builtAspect - 1) > 0.12) {
      this.builtAspect = aspect;
      // Центр пути линзы — правее середины, но в пределах видимого на этой ширине.
      const halfAt9 = 9 * Math.tan((FOV * Math.PI) / 360) * aspect;
      this.idleCx = Math.min(2.6, halfAt9 * 0.4);
      this.buildGeometry();
    }
    if (this.seek !== null && !force) this.renderSeek();
  }

  setTier(index) {
    this.tierIndex = index;
    this.material.uniforms.uSize.value = TIERS[this.tier].size;
    this.resize(true);
  }

  bindInput() {
    const area = this.el.closest('[data-hero-area]') || this.el;
    this.onMove = (e) => {
      if (e.pointerType === 'touch') return; // на телефоне палец листает страницу
      this.aim(e.clientX, e.clientY, 1);
    };
    this.onLeave = () => { this.lens.target = 0; };
    this.onDown = (e) => {
      const hit = this.aim(e.clientX, e.clientY, e.pointerType === 'touch' ? 0.8 : 1);
      if (hit) this.material.uniforms.uRipple.value.set(hit.x, hit.z, this.time);
    };
    area.addEventListener('pointermove', this.onMove, { passive: true });
    area.addEventListener('pointerleave', this.onLeave, { passive: true });
    this.el.addEventListener('pointerdown', this.onDown, { passive: true });
    this.inputArea = area;
  }

  // Точка экрана → точка на плоскости поля (луч из камеры до y = 0).
  project(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this._ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = this._ray.set(this._ndc.x, this._ndc.y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    if (ray.y > -0.02) return null; // луч не падает на плоскость
    const t = -this.camera.position.y / ray.y;
    return {
      x: this.camera.position.x + ray.x * t,
      z: Math.max(FIELD.zFar, Math.min(FIELD.zNear, this.camera.position.z + ray.z * t)),
    };
  }

  aim(clientX, clientY, strength) {
    const hit = this.project(clientX, clientY);
    if (!hit) return null;
    this.pointer.tx = hit.x;
    this.pointer.tz = hit.z;
    this.lens.target = strength;
    this.lastInput = this.time;
    return hit;
  }

  tick(now) {
    const f = this.frames;
    const dt = f.last ? Math.min((now - f.last) / 1000, 1 / 30) : 1 / 60;
    if (f.last) this.sample(now - f.last);
    f.last = now;

    this.time += dt;
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
  }

  step(dt) {
    const u = this.material.uniforms;
    const p = this.pointer;
    const L = this.lens;

    // Без курсора (телефон, или мышь давно не двигалась) линза сама
    // медленно гуляет по полю — сцена не выглядит застывшей.
    if (this.time - this.lastInput > 3) {
      const t = this.time;
      p.tx = this.idleCx + Math.sin(t * 0.21) * Math.min(1.4, this.idleCx + 0.6);
      p.tz = -3 + Math.cos(t * 0.16) * 0.9;
      L.target = IDLE_LENS;
    }

    // Пружина с критическим затуханием: отклик ~0.45 с, без перелёта.
    const omega = (2 * Math.PI) / 0.45;
    p.vx += (omega * omega * (p.tx - p.x) - 2 * omega * p.vx) * dt;
    p.vz += (omega * omega * (p.tz - p.z) - 2 * omega * p.vz) * dt;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    const omegaL = (2 * Math.PI) / 0.6;
    L.vel += (omegaL * omegaL * (L.target - L.v) - 2 * omegaL * L.vel) * dt;
    L.v += L.vel * dt;

    u.uTime.value = this.time;
    u.uPointer.value.set(p.x, p.z);
    u.uLens.value = Math.max(0, L.v);
  }

  /* Регулятор качества. После разогрева смотрит на средний интервал
     между кадрами. Не держим ~54 fps — шаг вниз по качеству.
     На низком не держим ~36 fps — сцена гаснет, остаётся статичный фон. */
  sample(interval) {
    const f = this.frames;
    if (interval > 250) return; // вкладка засыпала — это не тормоза
    f.shown.push(interval);
    if (f.shown.length > 60) f.shown.shift();
    if (!this.governor) return;
    if (f.warm < 45) { f.warm++; return; }
    f.samples.push(interval);
    if (f.samples.length < 90) return;
    const avg = f.samples.reduce((a, b) => a + b, 0) / f.samples.length;
    f.samples = [];
    const limit = this.tier === 'low' ? 28 : 18.5;
    if (avg <= limit) return;
    if (this.tierIndex < ORDER.length - 1) {
      this.setTier(this.tierIndex + 1);
      f.warm = 0;
    } else {
      this.giveUp('slow');
    }
  }

  renderSeek() {
    const u = this.material.uniforms;
    this.time = this.seek;
    const px = params.get('px');
    const py = params.get('py');
    if (px !== null && py !== null) {
      const rect = this.canvas.getBoundingClientRect();
      const hit = this.project(rect.left + parseFloat(px) * rect.width, rect.top + parseFloat(py) * rect.height);
      if (hit) {
        this.pointer.x = hit.x; this.pointer.z = hit.z;
        this.lens.v = 1;
        if (params.has('ripple')) u.uRipple.value.set(hit.x, hit.z, this.seek - parseFloat(params.get('ripple')));
      }
    } else {
      this.pointer.x = this.idleCx + Math.sin(this.seek * 0.21) * Math.min(1.4, this.idleCx + 0.6);
      this.pointer.z = -3 + Math.cos(this.seek * 0.16) * 0.9;
      this.lens.v = IDLE_LENS;
    }
    u.uTime.value = this.time;
    u.uPointer.value.set(this.pointer.x, this.pointer.z);
    u.uLens.value = this.lens.v;
    this.renderer.render(this.scene, this.camera);
    this.el.classList.add('is-live');
    setState('live');
    window.__hero = this.api();
    window.__heroReady = true;
  }

  stats() {
    const shown = this.frames.shown;
    const avg = shown.length ? shown.reduce((a, b) => a + b, 0) / shown.length : 0;
    const info = this.renderer.info;
    return {
      state: host.dataset.hero,
      tier: this.tier,
      fps: avg ? Math.round(1000 / avg) : 0,
      frameMs: Math.round(avg * 10) / 10,
      dpr: this.renderer.getPixelRatio(),
      canvas: [this.renderer.domElement.width, this.renderer.domElement.height],
      points: this.pointCount,
      drawCalls: info.render.calls,
      programs: info.programs ? info.programs.length : null,
      geometries: info.memory.geometries,
    };
  }

  mountDebug() {
    const box = document.createElement('pre');
    box.className = 'hero-debug';
    this.el.appendChild(box);
    const paint = () => {
      if (this.dead) return;
      const s = this.stats();
      box.textContent = `${s.fps} fps · ${s.frameMs} ms\n${s.tier} · dpr ${s.dpr} · ${s.canvas.join('×')}\n${s.points} точек · ${s.drawCalls} вызов`;
    };
    this.debugTimer = setInterval(paint, 500);
    paint();
  }

  giveUp(reason) {
    if (this.dead) return;
    this.dead = true;
    this.renderer.setAnimationLoop(null);
    this.el.classList.remove('is-live');
    setState('static', reason);
    if (this.ro) this.ro.disconnect();
    if (this.io) this.io.disconnect();
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.reduced) this.reduced.removeEventListener('change', this.onReduced);
    if (this.onMotion) window.removeEventListener('webchef:motion', this.onMotion);
    if (this.inputArea) {
      this.inputArea.removeEventListener('pointermove', this.onMove);
      this.inputArea.removeEventListener('pointerleave', this.onLeave);
      this.el.removeEventListener('pointerdown', this.onDown);
    }
    clearInterval(this.debugTimer);
    // Холст гаснет по CSS-переходу, потом освобождаем GPU.
    setTimeout(() => {
      this.points.geometry.dispose();
      this.material.dispose();
      this.renderer.dispose();
      this.canvas.remove();
    }, 700);
  }
}
