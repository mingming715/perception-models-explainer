import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas = document.getElementById('hero-canvas');
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0xf2f4f1, 0);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xf2f4f1, 8, 22);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(5.0, 1.15, 7.2);
const heroTarget = new THREE.Vector3(4.4, 0.55, 0);
camera.lookAt(heroTarget);
const heroOrbit = new OrbitControls(camera, canvas);
heroOrbit.enableDamping = true;
heroOrbit.dampingFactor = 0.06;
heroOrbit.enableZoom = false;
heroOrbit.enablePan = false;
heroOrbit.target.copy(heroTarget);
canvas.style.touchAction = 'pan-y';
heroOrbit.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };


// Soft ambient + cool key light
scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const key = new THREE.DirectionalLight(0xffffff, 0.95);
key.position.set(3, 4, 5);
scene.add(key);
const rim = new THREE.DirectionalLight(0xc4b5fd, 0.45);
rim.position.set(-4, 1, -2);
scene.add(rim);

// ── Ego vehicle (simplified box + cabin) ──
const ego = new THREE.Group();
const bodyMat = new THREE.MeshStandardMaterial({
  color: 0x1e293b, metalness: 0.55, roughness: 0.4,
  emissive: 0x0ea5e9, emissiveIntensity: 0.08
});
const accentMat = new THREE.MeshStandardMaterial({
  color: 0x0891b2, metalness: 0.35, roughness: 0.25,
  emissive: 0x22d3ee, emissiveIntensity: 0.65
});
const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.28, 2.1), bodyMat);
body.position.y = 0.18;
ego.add(body);
const cabinMat = bodyMat.clone();
cabinMat.transparent = false;
cabinMat.opacity = 1;
const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.32, 1.1), cabinMat);
cabin.position.set(0, 0.42, -0.15);
ego.add(cabin);
// Headlight strips
[-0.32, 0.32].forEach(x => {
  const l = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.06), accentMat);
  l.position.set(x, 0.2, 1.06);
  ego.add(l);
});
ego.position.set(4.0, 0, 0.15);
// ego removed from hero — was overlapping title text
// scene.add(ego);

// ── Ground grid (subtle) ──
const grid = new THREE.GridHelper(18, 36, 0xa8b0a8, 0xd0d6cf);
grid.position.y = 0;
grid.material.transparent = true;
grid.material.opacity = 0.7;
scene.add(grid);

// ── Sparse queries floating as glowing orbs with trails ──
const queryGroup = new THREE.Group();
queryGroup.position.set(4.1, 0, 0);
scene.add(queryGroup);

const N = 28;
const queries = [];
const palette = [0x6ee7ff, 0xa78bfa, 0x34d399, 0x7dd3fc];
for (let i = 0; i < N; i++) {
  const color = palette[i % palette.length];
  const mat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.9,
    metalness: 0.1, roughness: 0.25, transparent: true, opacity: 0.92
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.055 + Math.random() * 0.04, 16, 16), mat);
  const angle = (i / N) * Math.PI * 2;
  const r = 1.4 + (i % 5) * 0.35;
  mesh.position.set(
    Math.cos(angle) * r + (Math.random() - 0.5) * 0.4,
    0.25 + Math.random() * 1.1,
    Math.sin(angle) * r * 0.85 + (Math.random() - 0.5) * 0.5
  );
  queryGroup.add(mesh);

  // soft halo
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 12, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1 })
  );
  mesh.add(halo);

  queries.push({
    mesh,
    base: mesh.position.clone(),
    phase: Math.random() * Math.PI * 2,
    speed: 0.4 + Math.random() * 0.6,
    amp: 0.08 + Math.random() * 0.12
  });
}

// Connecting arcs between nearby queries (sparse graph)
const lineMat = new THREE.LineBasicMaterial({
  color: 0x0e7490, transparent: true, opacity: 0.28
});
const linkGeom = new THREE.BufferGeometry();
const linkPos = [];
for (let i = 0; i < N; i++) {
  for (let j = i + 1; j < N; j++) {
    if (queries[i].base.distanceTo(queries[j].base) < 1.15) {
      linkPos.push(
        queries[i].base.x, queries[i].base.y, queries[i].base.z,
        queries[j].base.x, queries[j].base.y, queries[j].base.z
      );
    }
  }
}
linkGeom.setAttribute('position', new THREE.Float32BufferAttribute(linkPos, 3));
const links = new THREE.LineSegments(linkGeom, lineMat);
queryGroup.add(links);

// ── Scene-token lattice (right side, denser, cooler) ──
const tokenGroup = new THREE.Group();
tokenGroup.position.set(6.4, 0.65, -0.1);
scene.add(tokenGroup);
const tokenMat = new THREE.MeshStandardMaterial({
  color: 0xa78bfa, emissive: 0xa78bfa, emissiveIntensity: 0.45,
  transparent: true, opacity: 0.55, metalness: 0.2, roughness: 0.4
});
const tokens = [];
for (let x = -2; x <= 2; x++) {
  for (let z = -2; z <= 2; z++) {
    for (let y = 0; y <= 2; y++) {
      if ((x + z + y) % 2 !== 0) continue;
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), tokenMat.clone());
      t.position.set(x * 0.32, y * 0.32, z * 0.32);
      t.material.opacity = 0.25 + Math.random() * 0.45;
      tokenGroup.add(t);
      tokens.push({ mesh: t, phase: Math.random() * Math.PI * 2 });
    }
  }
}

// Camera frustums (wire)
function makeFrustum(color, yaw) {
  const g = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 });
  const near = 0.15, far = 1.6, nw = 0.18, fw = 0.85, nh = 0.12, fh = 0.5;
  const pts = [
    // near rect
    [-nw,-nh,near],[nw,-nh,near],[nw,nh,near],[-nw,nh,near],[-nw,-nh,near],
    // to far
    [-nw,-nh,near],[-fw,-fh,far],
    [nw,-nh,near],[fw,-fh,far],
    [nw,nh,near],[fw,fh,far],
    [-nw,nh,near],[-fw,fh,far],
    // far rect
    [-fw,-fh,far],[fw,-fh,far],[fw,fh,far],[-fw,fh,far],[-fw,-fh,far]
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p)));
  g.add(new THREE.Line(geo, mat));
  g.rotation.y = yaw;
  g.position.y = 0.45;
  return g;
}
const frustums = new THREE.Group();
[-1.1, -0.55, 0, 0.55, 1.1, Math.PI].forEach((yaw, i) => {
  const f = makeFrustum(i === 5 ? 0x34d399 : 0x6ee7ff, yaw);
  f.position.copy(ego.position);
  f.position.y = 0.5;
  frustums.add(f);
});
// scene.add(frustums);

// Floating particles (dust)
const dustCount = 120;
const dustGeo = new THREE.BufferGeometry();
const dustArr = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
  dustArr[i*3] = (Math.random() - 0.5) * 14;
  dustArr[i*3+1] = Math.random() * 4;
  dustArr[i*3+2] = (Math.random() - 0.5) * 14;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustArr, 3));
const dust = new THREE.Points(
  dustGeo,
  new THREE.PointsMaterial({ color: 0x64748b, size: 0.022, transparent: true, opacity: 0.35 })
);
scene.add(dust);

let running = true;
const ro = new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0.05 });
ro.observe(canvas);

function resize() {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener('resize', resize);

let t0 = performance.now();
let mx = 0, my = 0;
window.addEventListener('pointermove', (e) => {
  mx = (e.clientX / window.innerWidth - 0.5) * 2;
  my = (e.clientY / window.innerHeight - 0.5) * 2;
}, { passive: true });

function frame(now) {
  requestAnimationFrame(frame);
  if (!running && !reduce) return;
  const t = (now - t0) / 1000;
  const motion = reduce ? 0 : 1;

  heroOrbit.update();

  // ego/frustums omitted from hero composition

  queries.forEach((q, i) => {
    const bob = Math.sin(t * q.speed + q.phase) * q.amp * motion;
    q.mesh.position.y = q.base.y + bob;
    q.mesh.position.x = q.base.x + Math.cos(t * 0.3 + q.phase) * 0.04 * motion;
    // pulse emissive
    q.mesh.material.emissiveIntensity = 0.7 + Math.sin(t * 2 + i) * 0.25 * motion;
  });

  // update link positions loosely (static base is fine visually)
  tokenGroup.rotation.y = t * 0.15 * motion;
  tokens.forEach((tk, i) => {
    tk.mesh.material.opacity = 0.28 + (0.35 + Math.sin(t * 1.4 + tk.phase) * 0.25) * (motion || 0.5);
  });

  dust.rotation.y = t * 0.02 * motion;

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Expose ready flag for screenshot timing
window.__heroReady = true;
