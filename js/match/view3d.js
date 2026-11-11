// 3D stadium renderer for MatchView (WebGL via three.js).
// MatchView keeps running the match; this class only draws its state: players as animated
// low-poly figures that turn and run in any direction, a lit stadium with a crowd, and a
// camera that moves like a TV director's (touchline camera, push-in, replay angles).
import * as THREE from '../vendor/three.module.min.js';

const L = 105, Wd = 68;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const POSE = { run: 0, kick: 1, dive: 2, celebrate: 3, down: 4, dejected: 5, card: 6, header: 7, flag: 8 };
const SKIN = ['#f1c9a5', '#e0ac85', '#c68b62', '#a26a42', '#7a4a2a', '#4f2f1c'];
const HAIR = ['#1b1209', '#3b2412', '#6b4422', '#c9a15a', '#e6d3a3', '#8a2d12', '#222'];
// game pitch coords (x 0..105 along, y 0..68 away from the main camera, z up) -> three coords
const V = (x, y, z = 0) => new THREE.Vector3(x - L / 2, z, Wd / 2 - y);

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

export class Stage3D {
  constructor(view) {
    this.v = view;
    const cv2 = view.cv;
    const gl = document.createElement('canvas');
    gl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none';
    gl.setAttribute('aria-hidden', 'true');
    cv2.parentNode.insertBefore(gl, cv2);
    this.glCanvas = gl;
    this.renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = view.night ? 1.05 : 1.0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, 16 / 9, 0.5, 900);
    this.camPos = new THREE.Vector3(0, 22, 80); this.camLook = new THREE.Vector3(0, 0, 0); this.fov = 26;
    this.time = 0;
    this.buildWorld();
    this.buildPlayers();
    this.buildBall();
  }

  // ---------- world ----------
  buildWorld() {
    const v = this.v, s = this.scene, night = v.night;
    s.background = new THREE.Color(night ? '#070b14' : '#9cc6e6');
    s.fog = new THREE.Fog(s.background, 160, 420);
    const hemi = new THREE.HemisphereLight(night ? '#8090b0' : '#dfefff', night ? '#1b2a1b' : '#4a6b3a', night ? 0.75 : 1.1);
    s.add(hemi);
    const sun = new THREE.DirectionalLight(night ? '#f2f5ff' : '#fff4e0', night ? 2.0 : 2.4);
    sun.position.set(night ? -20 : -40, 90, night ? 30 : 55);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 50; sc.bottom = -50; sc.near = 10; sc.far = 250;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    s.add(sun);
    if (night) { const fill = new THREE.DirectionalLight('#c8d4ff', 0.9); fill.position.set(40, 70, -40); s.add(fill); }

    // surround and pitch
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 170), new THREE.MeshLambertMaterial({ color: night ? '#16301a' : '#2f6a2c' }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; s.add(ground);
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(L + 10, Wd + 8), new THREE.MeshLambertMaterial({ map: this.pitchTexture() }));
    pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true; s.add(pitch);

    this.buildGoals();
    this.buildBoards();
    this.buildStands();
  }

  pitchTexture() {
    const W = 2300, H = 1600, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const sx = W / (L + 10), sy = H / (Wd + 8), ox = 5 * sx, oy = 4 * sy;
    const night = this.v.night;
    const a = night ? '#2c6b30' : '#3a7f3b', b = night ? '#285f2b' : '#337436';
    for (let i = 0; i < 20; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect(i * W / 20, 0, W / 20 + 1, H); }
    // subtle grain
    for (let i = 0; i < 14000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.035)`; g.fillRect(Math.random() * W, Math.random() * H, 3, 3); }
    const P = (x, y) => [ox + x * sx, oy + (Wd - y) * sy];
    g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 0.12 * sx; g.lineJoin = 'round';
    const rect = (x0, y0, x1, y1) => { const [a0, b0] = P(x0, y0), [a1, b1] = P(x1, y1); g.strokeRect(Math.min(a0, a1), Math.min(b0, b1), Math.abs(a1 - a0), Math.abs(b1 - b0)); };
    rect(0, 0, L, Wd);
    g.beginPath(); g.moveTo(...P(52.5, 0)); g.lineTo(...P(52.5, Wd)); g.stroke();
    g.beginPath(); g.arc(...P(52.5, 34), 9.15 * sx, 0, 7); g.stroke();
    for (const side of [0, 1]) {
      const x0 = side ? L : 0, d = side ? -1 : 1;
      rect(x0, 34 - 20.16, x0 + d * 16.5, 34 + 20.16);
      rect(x0, 34 - 9.16, x0 + d * 5.5, 34 + 9.16);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(...P(x0 + d * 11, 34), 0.22 * sx, 0, 7); g.fill();
      g.beginPath(); const [cx, cy] = P(x0 + d * 11, 34); const a0 = side ? Math.PI - 0.93 : -0.93; g.arc(cx, cy, 9.15 * sx, a0, a0 + 1.86); g.stroke();
      for (const y of [0, Wd]) { g.beginPath(); const [qx, qy] = P(x0, y); g.arc(qx, qy, 1 * sx, 0, 7); g.stroke(); }
    }
    g.fillStyle = '#fff'; g.beginPath(); g.arc(...P(52.5, 34), 0.25 * sx, 0, 7); g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  buildGoals() {
    const s = this.scene, white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35 });
    const post = new THREE.CylinderGeometry(0.06, 0.06, 2.44, 10), bar = new THREE.CylinderGeometry(0.06, 0.06, 7.32 + 0.12, 10);
    this.nets = [];
    for (const side of [0, 1]) {
      const x = side ? L : 0, d = side ? 1 : -1;
      for (const y of [34 - 3.66, 34 + 3.66]) { const m = new THREE.Mesh(post, white); m.position.copy(V(x, y, 1.22)); m.castShadow = true; s.add(m); }
      const cb = new THREE.Mesh(bar, white); cb.rotation.x = Math.PI / 2; cb.position.copy(V(x, 34, 2.44)); cb.castShadow = true; s.add(cb);
      // net: a grid over back, top and sides; vertices move for the bulge
      const pts = [], depth = 2.0, step = 0.25;
      const node = (u, w) => { // u along goal width (-3.66..3.66), w param 0..1 over side->top->back
        return [u, w];
      };
      const back = [], lines = [];
      // build as quads in local goal coords: (dx behind line, y across, z up)
      const shape = (yy, zz, part) => {
        if (part === 'back') return [depth, yy, zz * 0.92];
        if (part === 'top') return [zz * depth, yy, 2.44 - zz * 0.2];
        return [zz * depth, yy, 0];
      };
      const add = (a, b) => { lines.push(a, b); };
      for (let yy = -3.66; yy <= 3.661; yy += step) for (let zz = 0; zz < 2.44; zz += step) add([depth, yy, zz], [depth, yy, Math.min(2.44, zz + step)]);
      for (let zz = 0; zz <= 2.441; zz += step) for (let yy = -3.66; yy < 3.66; yy += step) add([depth, yy, zz], [depth, Math.min(3.66, yy + step), zz]);
      for (let yy = -3.66; yy <= 3.661; yy += step) for (let dx = 0; dx < depth; dx += step) add([dx, yy, 2.44], [Math.min(depth, dx + step), yy, 2.44]);
      for (let dx = 0; dx <= depth + 0.001; dx += step) for (let yy = -3.66; yy < 3.66; yy += step) add([dx, yy, 2.44], [dx, Math.min(3.66, yy + step), 2.44]);
      for (const yy of [-3.66, 3.66]) {
        for (let dx = 0; dx <= depth + 0.001; dx += step) for (let zz = 0; zz < 2.44; zz += step) add([dx, yy, zz], [dx, yy, Math.min(2.44, zz + step)]);
        for (let zz = 0; zz <= 2.441; zz += step) for (let dx = 0; dx < depth; dx += step) add([dx, yy, zz], [Math.min(depth, dx + step), yy, zz]);
      }
      const base = new Float32Array(lines.length * 3);
      lines.forEach((p, i) => { const w = V(x + d * p[0], 34 + p[1], p[2]); base[i * 3] = w.x; base[i * 3 + 1] = w.y; base[i * 3 + 2] = w.z; });
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
      const net = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#e8eef5', transparent: true, opacity: 0.55 }));
      s.add(net);
      this.nets.push({ net, base, local: lines, x, d });
    }
  }

  updateNets(bulge) {
    for (const n of this.nets) {
      const on = bulge && (n.d > 0 ? bulge.x > 52.5 : bulge.x < 52.5);
      const pos = n.net.geometry.attributes.position;
      if (!on && !n.dirty) continue;
      const a = on ? bulge.a : 0;
      for (let i = 0; i < n.local.length; i++) {
        const p = n.local[i];
        let push = 0;
        if (a > 0.01 && p[0] > 0.3) { const dy = p[1] - ((bulge.y ?? 34) - 34), dz = p[2] - 1.0; push = a * 0.9 * Math.exp(-(dy * dy) / 4 - (dz * dz) / 2) * (p[0] / 2); }
        pos.array[i * 3] = n.base[i * 3] + n.d * push;
      }
      pos.needsUpdate = true; n.dirty = on;
    }
  }

  textTexture(fn, w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }

  buildBoards() {
    const brands = this.v.boards, cols = ['#1d2a6b', '#7a1020', '#0f5a3a', '#5a1a7a', '#8a5a00', '#0d4f6b'];
    const tex = this.textTexture((g, w, h) => {
      const n = brands.length, bw = w / n;
      brands.forEach((b, i) => {
        g.fillStyle = cols[i % cols.length]; g.fillRect(i * bw, 0, bw, h);
        g.fillStyle = '#fff'; g.font = `800 ${h * 0.55}px "Barlow Condensed", "Arial Narrow", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(b, i * bw + bw / 2, h * 0.54, bw * 0.9);
      });
    }, 2048, 64);
    tex.wrapS = THREE.RepeatWrapping;
    this.boardTex = tex;
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const dark = new THREE.MeshLambertMaterial({ color: '#111' });
    const mk = (len, x, y, rotY) => {
      const g = new THREE.BoxGeometry(len, 0.9, 0.12);
      const m = new THREE.Mesh(g, [dark, dark, dark, dark, mat, mat]);
      m.position.copy(V(x, y, 0.45)); m.rotation.y = rotY; this.scene.add(m);
    };
    tex.repeat.set(2, 1);
    mk(L + 10, 52.5, -3.2, 0); mk(L + 10, 52.5, Wd + 3.2, Math.PI);
    mk(Wd - 12, -4.2, 34, -Math.PI / 2); mk(Wd - 12, L + 4.2, 34, Math.PI / 2);
  }

  buildStands() {
    const v = this.v, s = this.scene, night = v.night;
    const concrete = new THREE.MeshLambertMaterial({ color: night ? '#2a2f3a' : '#6b7280' });
    const roofM = new THREE.MeshLambertMaterial({ color: night ? '#151922' : '#3a3f4a' });
    const stands = [ // [center x, center y, length, rotation (faces pitch), distance]
      { cx: 52.5, cy: -6, len: L + 24, rot: 0 },
      { cx: 52.5, cy: Wd + 6, len: L + 60, rot: Math.PI },
      { cx: -7, cy: 34, len: Wd + 8, rot: -Math.PI / 2 },
      { cx: L + 7, cy: 34, len: Wd + 8, rot: Math.PI / 2 },
    ];
    const rowD = 0.85, rowH = 0.5;
    const fans = [];
    const hc = [v.kits[0].primary, v.kits[0].secondary], ac = [v.kits[1].primary, v.kits[1].secondary];
    const neutral = ['#d9d9d9', '#3a3f4b', '#5b6170', '#8a6f5a', '#2f3542', '#a3a9b6', '#6b4f3a', '#e6e1d5'];
    stands.forEach((st, si) => {
      const grp = new THREE.Group();
      const near = si === 0; // the main camera sits above this one: keep it low and open
      const rows = near ? 9 : 22;
      // stepped terrace
      for (let r = 0; r < rows; r++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(st.len, rowH, rowD), concrete);
        step.position.set(0, r * rowH + rowH / 2, r * rowD); step.receiveShadow = false; grp.add(step);
      }
      if (!near) {
        const back = new THREE.Mesh(new THREE.BoxGeometry(st.len, rows * rowH + 6, 1), concrete);
        back.position.set(0, (rows * rowH + 6) / 2, rows * rowD + 0.5); grp.add(back);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(st.len + 2, 0.5, rows * rowD + 4), roofM);
        roof.position.set(0, rows * rowH + 6, rows * rowD / 2); grp.add(roof);
      }
      if (night && !near) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(st.len, 0.35, 0.35), new THREE.MeshBasicMaterial({ color: '#fffbe8' }));
        strip.position.set(0, rows * rowH + 5.6, -1.4); grp.add(strip);
      }
      // place group: local +z points away from the pitch
      const c = V(st.cx, st.cy, 0);
      grp.position.copy(c);
      grp.rotation.y = st.rot;
      grp.updateMatrixWorld(true);
      s.add(grp);
      // fans on each row
      const per = Math.floor(st.len / 0.62);
      for (let r = 0; r < rows; r++) for (let i = 0; i < per; i++) {
        if (Math.random() < 0.06) continue;
        const lx = -st.len / 2 + (i + 0.5) * (st.len / per) + (Math.random() - 0.5) * 0.15;
        const p = new THREE.Vector3(lx, (r + 1) * rowH + 0.32, r * rowD + 0.15).applyMatrix4(grp.matrixWorld);
        const xFrac = (lx + st.len / 2) / st.len;
        const homeEnd = si === 2 || (si < 2 && xFrac < 0.45);
        const awayEnd = si === 3 && Math.random() < 0.85;
        const rr = Math.random();
        const col = awayEnd ? ac[rr < 0.6 ? 0 : 1] : homeEnd && rr < 0.75 ? hc[rr < 0.5 ? 0 : 1] : rr < 0.4 ? hc[0] : neutral[(Math.random() * neutral.length) | 0];
        fans.push({ p, col, rot: st.rot });
      }
    });
    const geo = new THREE.BoxGeometry(0.4, 0.6, 0.28);
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    this.crowdUniforms = { uTime: { value: 0 }, uExcite: { value: 0.2 } };
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.crowdUniforms.uTime; sh.uniforms.uExcite = this.crowdUniforms.uExcite;
      sh.vertexShader = 'uniform float uTime; uniform float uExcite;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float ph = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float jump = max(0.0, sin(uTime * (5.0 + ph * 4.0) + ph * 40.0));
        float on = step(1.0 - uExcite, ph);
        transformed.y += jump * jump * 0.45 * on * uExcite + sin(uTime * 1.3 + ph * 20.0) * 0.03;`);
    };
    const inst = new THREE.InstancedMesh(geo, mat, fans.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
    fans.forEach((f, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.rot);
      sc.set(1, 0.85 + Math.random() * 0.3, 1);
      m4.compose(f.p, q, sc); inst.setMatrixAt(i, m4);
      col.set(f.col); inst.setColorAt(i, col);
    });
    s.add(inst);
    // floodlight towers
    if (night) {
      const glow = new THREE.SpriteMaterial({ map: this.textTexture((g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.25, 'rgba(255,250,220,0.6)'); gr.addColorStop(1, 'rgba(255,250,220,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, 128, 128), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      for (const [x, y] of [[-12, -14], [L + 12, -14], [-12, Wd + 14], [L + 12, Wd + 14]]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 42, 8), concrete); pole.position.copy(V(x, y, 21)); s.add(pole);
        const sp = new THREE.Sprite(glow); sp.position.copy(V(x, y, 43)); sp.scale.set(16, 16, 1); s.add(sp);
      }
    }
  }

  // ---------- players ----------
  kitTexture(kit, num) {
    return this.textTexture((g, w, h) => {
      g.fillStyle = kit.primary; g.fillRect(0, 0, w, h);
      g.fillStyle = kit.secondary;
      switch (kit.pattern) {
        case 'stripes': for (let x = 0; x < w; x += w / 10) g.fillRect(x, 0, w / 22, h); break;
        case 'pinstripe': for (let x = 0; x < w; x += w / 24) g.fillRect(x, 0, w / 120, h); break;
        case 'hoops': for (let y = 0; y < h; y += h / 5) g.fillRect(0, y, w, h / 11); break;
        case 'halves': g.fillRect(0, 0, w / 4, h); g.fillRect(w / 2, 0, w / 4, h); break;
        case 'sash': g.save(); g.translate(w * 0.75, h / 2); g.rotate(0.6); g.fillRect(-w * 0.04, -h, w * 0.08, h * 2); g.restore(); break;
        default: g.fillRect(0, 0, w, h * 0.07);
      }
      if (num !== '' && num !== undefined) {
        const light = kit.pattern === 'plain' || kit.pattern === 'sleeves';
        g.fillStyle = light ? kit.secondary : '#ffffff';
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
        g.font = `800 ${h * 0.5}px "Barlow Condensed", "Arial Narrow", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.strokeText(String(num), w * 0.5, h * 0.5); g.fillText(String(num), w * 0.5, h * 0.5); // back
        g.font = `800 ${h * 0.16}px "Barlow Condensed", sans-serif`; g.fillText(String(num), w * 0.0 + w * 0.03, h * 0.3); // chest (wraps at the seam)
      }
    }, 256, 128);
  }

  buildPlayers() {
    const G = {
      torso: new THREE.CylinderGeometry(0.205, 0.16, 0.5, 14, 1),
      shorts: new THREE.CylinderGeometry(0.165, 0.17, 0.24, 12, 1),
      head: new THREE.SphereGeometry(0.115, 14, 10),
      hair: new THREE.SphereGeometry(0.123, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.4),
      thigh: new THREE.CapsuleGeometry(0.075, 0.3, 4, 8),
      shin: new THREE.CapsuleGeometry(0.058, 0.32, 4, 8),
      boot: new THREE.BoxGeometry(0.24, 0.07, 0.1),
      upper: new THREE.CapsuleGeometry(0.055, 0.2, 4, 8),
      fore: new THREE.CapsuleGeometry(0.045, 0.2, 4, 8),
      hand: new THREE.SphereGeometry(0.05, 8, 6),
      neck: new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8),
      card: new THREE.BoxGeometry(0.02, 0.12, 0.09),
      flag: new THREE.BoxGeometry(0.02, 0.22, 0.3),
      stick: new THREE.CylinderGeometry(0.01, 0.01, 0.5, 5),
    };
    this.G = G;
    const matCache = new Map();
    const mat = (key, make) => { if (!matCache.has(key)) matCache.set(key, make()); return matCache.get(key); };
    const std = c => new THREE.MeshLambertMaterial({ color: c });
    this.rigs = this.v.figs.map(P => {
      const kit = P.kit;
      const shirt = new THREE.MeshLambertMaterial({ map: this.kitTexture(kit, P.num) });
      const sleeve = mat('sl' + (kit.pattern === 'sleeves' ? kit.secondary : kit.primary), () => std(kit.pattern === 'sleeves' ? kit.secondary : kit.primary));
      const shorts = mat('sh' + kit.shorts, () => std(kit.shorts));
      const socks = mat('so' + kit.socks, () => std(kit.socks));
      const skin = mat('sk' + (P.look?.skin ?? 1), () => std(SKIN[P.look?.skin ?? 1]));
      const hair = mat('ha' + (P.look?.hair ?? 0), () => std(HAIR[P.look?.hair ?? 0]));
      const boots = mat('boot', () => std('#151515'));
      const gloves = mat('glove', () => std('#f0f0f0'));
      const M = (g, m, sh = true) => { const x = new THREE.Mesh(g, m); x.castShadow = sh; return x; };
      const root = new THREE.Group();
      const body = new THREE.Group(); root.add(body); // body tilts for dives and falls
      const hips = new THREE.Group(); hips.position.y = 0.95; body.add(hips);
      const sh = M(G.shorts, shorts); sh.position.y = -0.04; sh.scale.set(0.82, 1, 1); hips.add(sh);
      const torso = new THREE.Group(); hips.add(torso);
      const tm = M(G.torso, shirt); tm.position.y = 0.3; tm.scale.set(0.72, 1, 1); tm.rotation.y = Math.PI; torso.add(tm);
      const neck = M(G.neck, skin); neck.position.y = 0.6; torso.add(neck);
      const head = new THREE.Group(); head.position.y = 0.74; torso.add(head);
      head.add(M(G.head, skin)); const hr = M(G.hair, hair); hr.position.set(-0.015, 0.012, 0); hr.rotation.z = 0.4; head.add(hr);
      const legs = [-1, 1].map(side => {
        const hip = new THREE.Group(); hip.position.set(0, -0.08, side * 0.095); hips.add(hip);
        const th = M(G.thigh, socks === shorts ? shorts : skin); th.position.y = -0.2; hip.add(th);
        const knee = new THREE.Group(); knee.position.y = -0.42; hip.add(knee);
        const shn = M(G.shin, socks); shn.position.y = -0.2; knee.add(shn);
        const ankle = new THREE.Group(); ankle.position.y = -0.42; knee.add(ankle);
        const bt = M(G.boot, boots); bt.position.set(0.05, -0.02, 0); ankle.add(bt);
        return { hip, knee, ankle };
      });
      const arms = [-1, 1].map(side => {
        const shd = new THREE.Group(); shd.position.set(0, 0.51, side * 0.24); torso.add(shd);
        const up = M(G.upper, sleeve); up.position.y = -0.14; shd.add(up);
        const elbow = new THREE.Group(); elbow.position.y = -0.28; shd.add(elbow);
        const fo = M(G.fore, skin); fo.position.y = -0.13; elbow.add(fo);
        const hd = M(G.hand, P.role === 'GK' ? gloves : skin); hd.position.y = -0.27; elbow.add(hd);
        return { shd, elbow, hand: hd };
      });
      let prop = null;
      if (P.role === 'REF') { prop = M(G.card, mat('card', () => new THREE.MeshBasicMaterial({ color: '#ffd400' }))); prop.position.set(0, -0.32, 0); arms[1].elbow.add(prop); prop.visible = false; }
      if (P.role === 'LIN') {
        prop = new THREE.Group();
        const st = M(G.stick, mat('stick', () => std('#ddd'))); st.position.y = -0.3; prop.add(st);
        const fl = M(G.flag, mat('flag', () => new THREE.MeshBasicMaterial({ color: '#ffd400' }))); fl.position.set(0, -0.45, 0.15); prop.add(fl);
        prop.position.y = -0.27; prop.rotation.z = Math.PI; arms[1].elbow.add(prop);
      }
      this.scene.add(root);
      return { P, root, body, hips, torso, head, legs, arms, prop };
    });
  }

  animate(rig, P, dt) {
    const { root, body, hips, torso, head, legs, arms } = rig;
    root.visible = !P.gone && !(P.off && P.team >= 0);
    if (!root.visible) return;
    root.position.copy(V(P.x, P.y, 0));
    root.rotation.y = P.hd ?? (P.face > 0 ? 0 : Math.PI);
    const pose = P.pose, sp = P.speed || 0, spd = clamp(sp / 7.5, 0, 1);
    const ph = P.phase || 0;
    const gait = pose === POSE.run || pose === POSE.dejected || pose === POSE.celebrate || pose === POSE.flag || pose === POSE.card;
    // reset
    body.rotation.set(0, 0, 0); body.position.set(0, 0, 0);
    hips.position.y = 0.95; torso.rotation.set(0, 0, 0); head.rotation.set(0, 0, 0);
    // legs
    for (let k = 0; k < 2; k++) {
      const side = k ? 1 : -1, lph = ph + (side > 0 ? 0 : Math.PI);
      let th = 0, bend = 0.08;
      if (gait && sp > 0.25) { th = Math.sin(lph) * (0.12 + 0.75 * spd); bend = Math.max(0, Math.sin(lph - 1.3)) * (0.3 + 1.5 * spd) + 0.1; }
      legs[k].hip.rotation.set(0, 0, th);
      legs[k].knee.rotation.set(0, 0, -bend);
      legs[k].ankle.rotation.set(0, 0, bend * 0.3 - th * 0.2);
    }
    // arms
    for (let k = 0; k < 2; k++) {
      const side = k ? 1 : -1, aph = ph + (side > 0 ? Math.PI : 0);
      const ua = gait && sp > 0.25 ? Math.sin(aph) * (0.15 + 0.8 * spd) : 0.05;
      arms[k].shd.rotation.set(side * 0.12, 0, ua);
      arms[k].elbow.rotation.set(0, 0, 0.35 + 1.0 * spd);
    }
    const lean = spd * 0.28;
    torso.rotation.z = -lean;
    if (gait && sp > 0.25) { hips.position.y = 0.95 - Math.abs(Math.cos(ph)) * 0.06 * spd + 0.02 * spd; torso.rotation.y = Math.sin(ph) * 0.12 * spd; }
    else { torso.rotation.z = Math.sin(this.time * 1.6 + (P.seed || 0)) * 0.02; }
    const t = P.poseT || 0;
    switch (pose) {
      case POSE.kick: {
        const k = clamp(1 - t / 0.35, 0, 1), e = k < 0.35 ? -k / 0.35 : (k - 0.35) / 0.65;
        legs[1].hip.rotation.z = lerp(-0.7, 1.4, clamp(e * 0.5 + 0.5, 0, 1)); legs[1].knee.rotation.z = -lerp(1.3, 0.1, clamp(e, 0, 1));
        legs[0].hip.rotation.z = -0.2; legs[0].knee.rotation.z = -0.35;
        arms[0].shd.rotation.x = -0.9; arms[1].shd.rotation.x = 0.7; arms[0].shd.rotation.z = 0.4;
        torso.rotation.z = 0.12; torso.rotation.x = 0.15;
        break;
      }
      case POSE.header: {
        const k = clamp(1 - t / 0.7, 0, 1), up = Math.sin(k * Math.PI);
        body.position.y = up * 0.55;
        legs[0].knee.rotation.z = -1.1 * up; legs[1].knee.rotation.z = -0.8 * up;
        torso.rotation.z = lerp(0.35, -0.5, k); head.rotation.z = lerp(0.3, -0.5, k);
        arms[0].shd.rotation.x = -1.2; arms[1].shd.rotation.x = 1.2;
        break;
      }
      case POSE.dive: {
        const k = clamp(1 - t / 1.3, 0, 1), roll = Math.min(1, k * 3);
        // dive towards the side of the shot: local +z points to world y = -cos(heading)
        const dir = Math.sign(-Math.cos(root.rotation.y) * (P.diveDir || 1)) || 1;
        body.rotation.x = dir * roll * 1.35;
        body.position.y = Math.sin(Math.min(1, k * 2) * Math.PI) * 0.55 + roll * 0.25;
        body.position.z = dir * roll * 0.4;
        for (let i = 0; i < 2; i++) { arms[i].shd.rotation.set(0, 0, Math.PI * 0.95); arms[i].elbow.rotation.z = 0.1; }
        legs[0].hip.rotation.z = 0.2; legs[1].hip.rotation.z = -0.2;
        break;
      }
      case POSE.celebrate: {
        for (let i = 0; i < 2; i++) { const side = i ? 1 : -1; arms[i].shd.rotation.set(side * 2.5, 0, 0.2); arms[i].elbow.rotation.z = 0.3; }
        body.position.y = Math.abs(Math.sin(this.time * 7 + (P.seed || 0))) * 0.2 * (sp < 2 ? 1 : 0.3);
        torso.rotation.z = -lean * 0.5 + 0.15;
        break;
      }
      case POSE.down: {
        body.rotation.z = -1.45; body.position.y = 0.2; body.position.x = -0.9;
        legs[0].knee.rotation.z = -0.6; arms[0].shd.rotation.z = 1.2;
        break;
      }
      case POSE.dejected: {
        for (let i = 0; i < 2; i++) { const side = i ? 1 : -1; arms[i].shd.rotation.set(side * 2.3, 0, 0.9); arms[i].elbow.rotation.z = 2.2; }
        head.rotation.z = -0.35; torso.rotation.z = -0.15;
        break;
      }
      case POSE.card: { arms[1].shd.rotation.set(0.25, 0, Math.PI * 0.95); arms[1].elbow.rotation.z = 0; if (rig.prop) { rig.prop.visible = true; rig.prop.material.color.set(P.card || '#ffd400'); } break; }
      case POSE.flag: { if (P.flagUp > 0) { arms[1].shd.rotation.set(0.2, 0, Math.PI * 0.95); arms[1].elbow.rotation.z = 0; } break; }
    }
    if (pose !== POSE.card && rig.prop && P.role === 'REF') rig.prop.visible = false;
  }

  buildBall() {
    const tex = this.textTexture((g, w, h) => {
      g.fillStyle = '#f7f7f7'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1a1a1a';
      for (let i = 0; i < 12; i++) { const x = (i % 6) * w / 6 + (i < 6 ? 0 : w / 12), y = i < 6 ? h * 0.3 : h * 0.72; g.beginPath(); for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; g.lineTo(x + Math.cos(a) * w / 30, y + Math.sin(a) * h / 14); } g.fill(); }
    }, 256, 128);
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11 * 1.35, 18, 12), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 }));
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);
    this.trail = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }));
  }

  // ---------- camera ----------
  updateCamera(src, dt) {
    const v = this.v, b = src.ball, cam = v.cam;
    let pos, look, fov;
    const R = v.replay;
    const snap = v.camSnap3d; v.camSnap3d = false;
    if (v.camMode === 'tactical' && !R) {
      look = V(clamp(cam.fx, 30, 75), 34, 0); pos = V(clamp(cam.fx, 30, 75), -38, 82); fov = 38;
    } else if (R) {
      const end = R.frames[R.frames.length - 1], n = v.figs.length * 9;
      const gx = end[n] > 52.5 ? L : 0, d = gx > 0 ? 1 : -1;
      const finish = R.slowAt !== undefined && R.i > R.slowAt;
      if (R.angle !== (finish ? 'goal' : 'high')) { R.angle = finish ? 'goal' : 'high'; this.cut = true; }
      if (finish) { // behind the goal, slightly off-centre and raised
        pos = V(gx + d * 6.3, 34 + 4, 6.5); look = V(b.x, b.y, 0.8);
        const dist = Math.hypot(b.x - (gx + d * 6.3), b.y - 38);
        fov = clamp(2 * Math.atan(9 / dist) * 180 / Math.PI, 14, 48);
      } else { // high camera behind the attack
        pos = V(b.x - d * 20, b.y + (34 - b.y) * 0.2 - 14, 16); look = V(b.x + d * 8, b.y, 0); fov = 46;
      }
    } else if (v.celebFocus) {
      const P = v.celebFocus; pos = V(P.x - 6, P.y - 11, 3.2); look = V(P.x, P.y, 1.2); fov = 34;
    } else {
      // main TV camera on the halfway line, high in the main stand: pans and zooms
      const fx = cam.fx, fy = clamp(b.y, 0, Wd);
      look = V(fx, lerp(34, fy, 0.7), 0);
      pos = V(52.5 + (fx - 52.5) * 0.3, -34, 21);
      fov = 33 / cam.zoom;
    }
    const k = snap || this.cut ? 1 : Math.min(1, dt * (R ? 6 : 3.5));
    this.cut = false;
    this.camPos.lerp(pos, k); this.camLook.lerp(look, Math.min(1, k * 1.6)); this.fov = lerp(this.fov, fov, k);
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
  }

  resize(W, H, dpr) {
    this.renderer.setPixelRatio(Math.min(dpr, 1.5)); this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H; this.camera.updateProjectionMatrix();
    this.W = W; this.H = H;
  }

  project(x, y, z = 0) {
    const p = V(x, y, z).project(this.camera);
    return [(p.x + 1) / 2 * this.W, (1 - p.y) / 2 * this.H, p.z < 1 ? 30 : 0];
  }

  render(src, dt) {
    this.time += dt;
    const v = this.v;
    this.crowdUniforms.uTime.value = this.time;
    this.crowdUniforms.uExcite.value = clamp(v.excite * 1.1 + (v.flash > 0.05 ? 0.6 : 0) + (v.hype || 0), 0.05, 1);
    this.boardTex.offset.x = (this.time * 0.02) % 1;
    for (let i = 0; i < this.rigs.length; i++) this.animate(this.rigs[i], src.figs[i], dt);
    const b = src.ball;
    this.ballMesh.position.copy(V(b.x, b.y, (b.z || 0) + 0.11 * 1.35));
    this.ballMesh.rotation.z = -(b.spin || 0);
    this.updateNets(src.bulge);
    this.updateCamera(src, dt);
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this.renderer.dispose();
    this.glCanvas.remove();
  }
}
