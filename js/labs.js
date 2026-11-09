import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const LAB_BG = 0x0b1220; // dark studio backdrop — keeps emissive queries readable

/* ── shared helpers ── */
function makeRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(LAB_BG, 1);
  return renderer;
}

function fit(renderer, camera, canvas) {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}

function wireBox(w, h, d, color, opacity = 0.9) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const edges = new THREE.EdgesGeometry(geo);
  return new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity })
  );
}

function glowSphere(r, color) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(r, 16, 16),
    new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.85,
      metalness: 0.1, roughness: 0.3, transparent: true, opacity: 0.95
    })
  );
  return m;
}


/** Drag-rotate for lab canvases. Wheel still scrolls page (zoom off). */
function attachOrbit(camera, domElement, targetVec) {
  const tgt = targetVec instanceof THREE.Vector3
    ? targetVec.clone()
    : new THREE.Vector3(...(Array.isArray(targetVec) ? targetVec : [0, 0.6, 0]));

  camera.lookAt(tgt);
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableRotate = true;
  controls.target.copy(tgt);
  controls.update();

  // One-finger vertical swipe scrolls the page; rotate via mouse / two-finger
  domElement.style.touchAction = 'pan-y';
  controls.touches = {
    ONE: THREE.TOUCH.PAN,           // pan disabled → ignore; browser handles pan-y
    TWO: THREE.TOUCH.DOLLY_ROTATE   // zoom off → rotate
  };

  const homePos = camera.position.clone();
  const homeTarget = controls.target.clone();
  let anim = 0;
  let fitRoot = null;
  const margin = 1.14;

  function setHomeFromCamera() {
    homePos.copy(camera.position);
    homeTarget.copy(controls.target);
  }

  function expandContentBox(root, box) {
    root.updateWorldMatrix(true, true);
    root.traverse((obj) => {
      if (obj.isLight || obj.isCamera) return;
      if (obj.type === 'GridHelper' || obj.type === 'AxesHelper') return;
      if (obj.userData && obj.userData.skipFit) return;
      if (!(obj.isMesh || obj.isLine || obj.isLineSegments || obj.isPoints)) return;
      const was = obj.visible;
      obj.visible = true; // include hidden step objects so framing stays safe
      box.expandByObject(obj);
      obj.visible = was;
    });
  }

  /** Frame all content in root with ~12% margin; updates orbit home. */
  function fitContent(root, m = margin) {
    if (root) fitRoot = root;
    if (!fitRoot) return;
    const box = new THREE.Box3();
    expandContentBox(fitRoot, box);
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const sx = Math.max(size.x, 0.01);
    const sy = Math.max(size.y, 0.01);
    const sz = Math.max(size.z, 0.01);

    // Prefer a pleasant elevated viewing angle (keep current azimuth if set)
    let dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0.25, 0.55, 1);
    dir.normalize();
    if (dir.y < 0.18) dir.y = 0.28;
    // Avoid bird's-eye that leaves the top half empty
    if (dir.y > 0.48) dir.y = 0.36;
    dir.normalize();

    // Seed distance from AABB + FOV, then refine with AABB corner NDC fit
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const aspect = Math.max(camera.aspect || 1, 0.1);
    const distV = (sy * 0.5) / Math.tan(fov * 0.5);
    const distH = (sx * 0.5) / Math.tan(fov * 0.5) / aspect;
    let dist = Math.max(distV, distH, sz * 0.7, 2.5) * m;

    const corners = [
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.min.z),
      new THREE.Vector3(box.min.x, box.max.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ];
    const pad = 1 / m; // NDC limit so ~12% margin when m≈1.14
    const ndc = new THREE.Vector3();

    for (let iter = 0; iter < 8; iter++) {
      camera.position.copy(center).addScaledVector(dir, dist);
      controls.target.copy(center);
      camera.near = Math.max(0.05, dist / 100);
      camera.far = Math.max(100, dist * 20);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);

      let maxAbs = 0;
      for (const c of corners) {
        ndc.copy(c).project(camera);
        if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) continue;
        maxAbs = Math.max(maxAbs, Math.abs(ndc.x), Math.abs(ndc.y));
      }
      if (maxAbs <= pad || maxAbs < 1e-6) break;
      dist *= (maxAbs / pad) * 1.02;
    }

    camera.position.copy(center).addScaledVector(dir, dist);
    controls.target.copy(center);
    camera.near = Math.max(0.05, dist / 100);
    camera.far = Math.max(100, dist * 20);
    camera.updateProjectionMatrix();
    controls.update();
    setHomeFromCamera();
  }

  function easeHome(ms = 650) {
    if (reduceMotion || ms <= 0) {
      camera.position.copy(homePos);
      controls.target.copy(homeTarget);
      controls.update();
      return;
    }
    const fromPos = camera.position.clone();
    const fromTarget = controls.target.clone();
    const t0 = performance.now();
    if (anim) cancelAnimationFrame(anim);
    const tick = (now) => {
      const u = Math.min(1, (now - t0) / ms);
      const e = u * u * (3 - 2 * u);
      camera.position.lerpVectors(fromPos, homePos, e);
      controls.target.lerpVectors(fromTarget, homeTarget, e);
      controls.update();
      if (u < 1) anim = requestAnimationFrame(tick);
      else anim = 0;
    };
    anim = requestAnimationFrame(tick);
  }

  return { controls, easeHome, fitContent, setHomeFromCamera };
}


/* ── Shared street kit + scroll-zoom rig (light labs) ── */
/** Side profile (x = length, front = +x, y = up) extruded across the car's width. */
function extrudeProfile(points, width, bevel) {
  const shape = new THREE.Shape();
  shape.moveTo(...points[0]);
  points.slice(1).forEach((pt) => (pt.length === 4 ? shape.quadraticCurveTo(...pt) : shape.lineTo(...pt)));
  shape.closePath();
  const depth = Math.max(0.01, width - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 10,
  });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(-Math.PI / 2); // +x (front) → +z
  return geo;
}

let carShadowTex = null;
function carShadowTexture() {
  if (carShadowTex) return carShadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,.75)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  carShadowTex = new THREE.CanvasTexture(c);
  return carShadowTex;
}

/** Stylised low-poly sedan: beveled body, glass greenhouse, wheels, LED light bars, contact shadow. */
function makeCar(color, len = 1.9, wid = 0.9, h = 0.55) {
  const g = new THREE.Group();
  const L = len / 2;
  const bev = Math.min(wid, h) * 0.08;
  const clear = h * 0.2, belt = h * 0.55, roof = h * 0.96;

  const body = new THREE.Mesh(
    extrudeProfile([
      [-L, clear], [L, clear], [L, belt * 0.78],
      [L * 0.98, belt, L * 0.72, belt],             // rounded nose → hood
      [-L * 0.82, belt],
      [-L, belt * 0.98, -L, belt * 0.72],           // rounded tail
    ], wid, bev),
    new THREE.MeshPhysicalMaterial({ color, metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15 })
  );
  g.add(body);

  const glass = new THREE.Mesh(
    extrudeProfile([
      [L * 0.5, belt], [L * 0.12, roof, L * 0.02, roof],   // raked windshield
      [-L * 0.42, roof], [-L * 0.72, belt],                  // fastback rear
    ], wid * 0.8, bev * 0.8),
    new THREE.MeshPhysicalMaterial({ color: 0x0b1220, emissive: 0x0c4a6e, emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.92 })
  );
  g.add(glass);

  const r = h * 0.23;
  const wheelGeo = new THREE.CylinderGeometry(r, r, wid * 0.16, 20);
  wheelGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.MeshStandardMaterial({ color: 0x0a0d14, roughness: 0.85 });
  const hubGeo = new THREE.CylinderGeometry(r * 0.55, r * 0.55, wid * 0.17, 14);
  hubGeo.rotateZ(Math.PI / 2);
  const hub = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.3 });
  [L * 0.62, -L * 0.6].forEach((z) => [-1, 1].forEach((side) => {
    const x = side * (wid / 2 - wid * 0.06);
    const w = new THREE.Mesh(wheelGeo, tire);
    w.position.set(x, r, z);
    const c = new THREE.Mesh(hubGeo, hub);
    c.position.set(x + side * 0.004, r, z);
    g.add(w, c);
  }));

  const bar = (col, z, y) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(wid * 0.82, h * 0.06, 0.03),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.6 })
    );
    m.position.set(0, y, z);
    g.add(m);
  };
  bar(0xe0f2fe, L + bev + 0.005, belt * 0.7);   // headlight strip
  bar(0xef4444, -L - bev - 0.005, belt * 0.8);  // tail-light strip

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(wid * 1.5, len * 1.25),
    new THREE.MeshBasicMaterial({ map: carShadowTexture(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  g.add(shadow);
  return g;
}

function addStreetGround(scene) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 28),
    new THREE.MeshStandardMaterial({ color: 0x0f1729, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.001;
  ground.userData.skipFit = true;
  scene.add(ground);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(6.2, 26),
    new THREE.MeshStandardMaterial({ color: 0x1b2436, roughness: 0.9, metalness: 0.05 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.002;
  road.userData.skipFit = true;
  scene.add(road);
  const laneMat = new THREE.MeshBasicMaterial({ color: 0x475569 });
  for (let i = -10; i <= 10; i++) {
    if (i === 0) continue;
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.9), laneMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.01, i * 1.4);
    dash.userData.skipFit = true;
    scene.add(dash);
  }
  const grid = new THREE.GridHelper(24, 24, 0x22304a, 0x1a2438);
  grid.position.y = 0.003;
  grid.material.transparent = true;
  grid.material.opacity = 0.7;
  scene.add(grid);
}

function makeFrustumFan(yaw, color = 0x22d3ee) {
  const g = new THREE.Group();
  const near = 0.3, far = 2.45, nw = 0.18, fw = 1.15, nh = 0.12, fh = 0.62;
  const corners = [
    new THREE.Vector3(-nw, -nh, near), new THREE.Vector3(nw, -nh, near),
    new THREE.Vector3(nw, nh, near), new THREE.Vector3(-nw, nh, near),
    new THREE.Vector3(-fw, -fh, far), new THREE.Vector3(fw, -fh, far),
    new THREE.Vector3(fw, fh, far), new THREE.Vector3(-fw, fh, far),
  ];
  const edgeIdx = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  const pts = [];
  edgeIdx.forEach(([a, b]) => { pts.push(corners[a], corners[b]); });
  g.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3 })
  ));
  const fanMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.025, side: THREE.DoubleSide, depthWrite: false
  });
  [[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]].forEach((idx) => {
    const v = idx.flatMap((i) => [corners[i].x, corners[i].y, corners[i].z]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      v[0],v[1],v[2], v[3],v[4],v[5], v[6],v[7],v[8],
      v[0],v[1],v[2], v[6],v[7],v[8], v[9],v[10],v[11],
    ]), 3));
    g.add(new THREE.Mesh(geo, fanMat));
  });
  g.rotation.y = yaw;
  g.position.y = 0.55;
  return g;
}

function makeQueryBox(col, size = [1.05, 0.78, 1.85]) {
  const g = new THREE.Group();
  const [w, h, d] = size;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
    new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 1 })
  );
  edges.position.y = h * 0.5;
  g.add(edges);
  const fill = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.14, depthWrite: false })
  );
  fill.position.y = h * 0.5;
  g.add(fill);
  const ref = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 14, 14),
    new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.2, transparent: true, opacity: 1 })
  );
  ref.position.y = h * 0.5;
  g.add(ref);
  g.userData = { edges, fill, ref, col };
  return g;
}

function makePlaceholderTex(hue) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 80;
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 128, 80);
  grd.addColorStop(0, `hsl(${hue}, 35%, 72%)`);
  grd.addColorStop(0.5, `hsl(${hue + 20}, 28%, 58%)`);
  grd.addColorStop(1, `hsl(${hue - 10}, 22%, 48%)`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 128, 80);
  ctx.fillStyle = 'rgba(30,41,59,.35)';
  ctx.fillRect(0, 48, 128, 32);
  ctx.fillStyle = 'rgba(248,250,252,.55)';
  ctx.fillRect(40, 30, 48, 22);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function easeInOut(u) {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

/** Clean in-scene text sprite (always faces camera). */
function makeTextLabel(text, opts = {}) {
  const color = opts.color || '#22d3ee';
  const w = opts.w || 320;
  const h = opts.h || 72;
  const c = document.createElement('canvas');
  c.width = w * 2; c.height = h * 2; // 2× for crisp text on large canvases
  const ctx = c.getContext('2d');
  ctx.scale(2, 2);
  // dark glass pill + accent dot (accent = opts.color)
  const pad = 8;
  const rw = w - pad * 2, rh = h - pad * 2, r = rh / 2;
  ctx.fillStyle = 'rgba(11,18,32,0.88)';
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(pad, pad, rw, rh, r);
  ctx.fill();
  ctx.stroke();
  const dot = rh * 0.18;
  ctx.font = `650 ${opts.size || 28}px "Pretendard Variable","Pretendard","Noto Sans KR",system-ui,sans-serif`;
  const tw = ctx.measureText(text).width;
  const x0 = (w - (tw + dot * 3)) / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x0 + dot, h / 2, dot, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f1f5f9';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x0 + dot * 3, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const s = new THREE.Sprite(mat);
  const scale = opts.scale || 1.35;
  s.scale.set(scale, scale * (h / w), 1);
  s.userData.isLabel = true;
  s.userData.labelText = text;
  return s;
}

/**
 * Scrubbable zoom between orbit home and a detail pose.
 * Optionally dims non-focus object groups (opacity → ~0.15).
 * reduced-motion: snap to detail when u>0.5 else home.
 */
/** Reserve bottom ~16% of the canvas for the sticky caption overlay. */
const CAPTION_RESERVE = 0.16;

/** Pull camera back and lift look-at so the subject sits above the caption band. */
function captionSafePose(pos, target, pull = 0.10, lift = 0.32) {
  const p = new THREE.Vector3(pos[0], pos[1], pos[2]);
  const t = new THREE.Vector3(target[0], target[1], target[2]);
  const dir = p.clone().sub(t);
  if (dir.lengthSq() > 1e-6) {
    p.addScaledVector(dir.normalize(), dir.length() * pull + pull * 0.8);
  }
  t.y += lift;
  p.y += lift * 0.55;
  return { pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
}

function makeZoomRig(camera, orbit) {
  const homePos = new THREE.Vector3();
  const homeTarget = new THREE.Vector3();
  const detailPos = new THREE.Vector3();
  const detailTarget = new THREE.Vector3();
  let hasDetail = false;
  let detailKey = null;
  let lastU = 0;
  let goal = -1;
  let anim = 0;
  let dimEntries = []; // { mat, base }
  let dimGroupsRef = [];

  function captureHome() {
    homePos.copy(camera.position);
    homeTarget.copy(orbit.controls.target);
  }
  function setHome(pos, target) {
    homePos.set(...pos);
    homeTarget.set(...target);
  }
  function setDetail(pos, target, dimGroups = []) {
    if (hasDetail && detailKey === pos) return; // same step — keep tween + dim state
    detailKey = pos;
    const safe = captionSafePose(pos, target);
    detailPos.set(safe.pos[0], safe.pos[1], safe.pos[2]);
    detailTarget.set(safe.target[0], safe.target[1], safe.target[2]);
    hasDetail = true;
    dimGroupsRef = (dimGroups || []).filter(Boolean);
    dimGroupsRef.forEach((g) => { g.visible = true; });
    dimEntries = [];
    dimGroupsRef.forEach((g) => {
      g.traverse((o) => {
        if (o.userData?.isLabel) return;
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        mats.forEach((m) => {
          if (!m || m.opacity === undefined) return;
          if (!m.transparent) m.transparent = true;
          if (m.userData._zoomBaseOpacity == null) m.userData._zoomBaseOpacity = m.opacity;
          dimEntries.push({ mat: m, base: m.userData._zoomBaseOpacity });
        });
      });
    });
  }
  /** Fade clutter, then hide it so the step's subject reads alone. */
  function applyDim(t) {
    const fade = Math.max(0, 1 - t * 1.15);
    dimEntries.forEach(({ mat, base }) => { mat.opacity = base * Math.max(0.05, fade); });
    dimGroupsRef.forEach((g) => { g.visible = t < 0.55; });
  }
  function clearDetail() {
    applyDim(0);
    hasDetail = false;
    detailKey = null;
    lastU = 0;
    goal = -1;
    dimEntries = [];
    dimGroupsRef = [];
  }
  /** Re-run the next scrub even if the goal is unchanged (after a camera snap). */
  function reset() { goal = -1; }
  /** Ease from the current camera to home (u≤.5) or detail (u>.5) and hold there. */
  function scrub(u) {
    const g = hasDetail && u > 0.5 ? 1 : 0;
    if (g === goal) return;
    goal = g;
    const fromPos = camera.position.clone();
    const fromTarget = orbit.controls.target.clone();
    const toPos = g ? detailPos : homePos;
    const toTarget = g ? detailTarget : homeTarget;
    const u0 = lastU;
    const t0 = performance.now();
    const ms = reduceMotion ? 0 : 900;
    cancelAnimationFrame(anim);
    const tick = (now) => {
      const e = ms ? easeInOut((now - t0) / ms) : 1;
      camera.position.lerpVectors(fromPos, toPos, e);
      orbit.controls.target.lerpVectors(fromTarget, toTarget, e);
      orbit.controls.update();
      lastU = u0 + (g - u0) * e;
      applyDim(lastU);
      anim = e < 1 ? requestAnimationFrame(tick) : 0;
    };
    anim = requestAnimationFrame(tick);
  }
  return { captureHome, setHome, setDetail, clearDetail, reset, scrub, get u() { return lastU; } };
}

const __labZoom = {};
window.__labZoom = __labZoom;

/** Screen-space AABBs for all visible in-scene labels (for overlap / caption checks). */
window.__labLabelBounds = function labLabelBounds(labId) {
  const d = window.__labDebug?.[labId];
  if (!d?.scene || !d?.camera || !d?.canvas) return [];
  const { scene, camera, canvas } = d;
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  camera.updateMatrixWorld(true);
  const out = [];
  const wp = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.userData?.isLabel || !o.visible) return;
    let p = o.parent, ok = true;
    while (p) { if (p.visible === false) { ok = false; break; } p = p.parent; }
    if (!ok) return;
    o.getWorldPosition(wp);
    const ndc = wp.clone().project(camera);
    if (ndc.z > 1 || ndc.z < -1) return;
    const dist = camera.position.distanceTo(wp);
    const vFov = (camera.fov * Math.PI) / 180;
    const worldPerPx = (2 * Math.tan(vFov / 2) * dist) / h;
    const pw = Math.max(8, o.scale.x / worldPerPx);
    const ph = Math.max(8, o.scale.y / worldPerPx);
    const sx = (ndc.x * 0.5 + 0.5) * w;
    const sy = (-ndc.y * 0.5 + 0.5) * h;
    out.push({
      text: o.userData.labelText || '',
      x: sx - pw / 2, y: sy - ph / 2, w: pw, h: ph,
      cx: sx, cy: sy,
      inCaption: sy + ph / 2 > h * (1 - CAPTION_RESERVE),
    });
  });
  return out;
};

window.__labLabelOverlaps = function labLabelOverlaps(labId) {
  const boxes = window.__labLabelBounds(labId);
  const hits = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 2 && oy > 2) hits.push([a.text || i, b.text || j, Math.round(ox), Math.round(oy)]);
    }
  }
  return hits;
};
window.addEventListener('lab:progress', (e) => {
  const { lab, step, progress } = e.detail || {};
  if (lab && __labZoom[lab]) __labZoom[lab](step, progress);
});

function bootStreetLab(canvas, opts = {}) {
  const root = canvas.closest('.method-scrolly') || canvas.closest('.lab');
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(LAB_BG, 14, 32);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
  const home = opts.home || { pos: [3.55, 3.15, 3.85], target: [-0.75, 0.45, 0.2] };
  camera.position.set(...home.pos);
  const orbit = attachOrbit(camera, canvas, new THREE.Vector3(...home.target));
  scene.add(new THREE.AmbientLight(0xffffff, 0.78));
  const key = new THREE.DirectionalLight(0xffffff, 0.95);
  key.position.set(5, 8, 4); scene.add(key);
  addStreetGround(scene);
  const zoom = makeZoomRig(camera, orbit);
  return { root, renderer, scene, camera, orbit, zoom, home };
}

function setStreetHome(camera, orbit, zoom, home, snap = false) {
  // Mild caption-safe lift so overview steps also clear the HUD
  const safe = captionSafePose(home.pos, home.target, 0.06, 0.22);
  zoom.setHome(safe.pos, safe.target);
  if (!snap) return;
  camera.position.set(...safe.pos);
  orbit.controls.target.set(...safe.target);
  camera.near = 0.08; camera.far = 50;
  camera.updateProjectionMatrix();
  orbit.controls.update();
  orbit.setHomeFromCamera();
  zoom.reset();
}


const __labAPI = {};
window.__labAPI = __labAPI;
const __labDebug = {};
window.__labDebug = __labDebug;

function bindLabUI(root, steps, onStep, labName) {
  // Optional legacy panel (may be absent in scrolly layout)
  const title = root?.querySelector?.('[data-role="title"]');
  const body = root?.querySelector?.('[data-role="body"]');
  const dots = root?.querySelector?.('[data-role="dots"]');
  const btnPrev = root?.querySelector?.('[data-act="prev"]');
  const btnNext = root?.querySelector?.('[data-act="next"]');
  const btnPlay = root?.querySelector?.('[data-act="play"]');
  let i = 0;
  let playing = false;
  let timer = null;

  if (dots) {
    dots.innerHTML = '';
    steps.forEach((_, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', `스텝 ${idx + 1}`);
      b.addEventListener('click', () => go(idx, false));
      dots.appendChild(b);
    });
  }

  function render() {
    if (title) title.textContent = steps[i].title;
    if (body) body.textContent = steps[i].body;
    if (dots) [...dots.children].forEach((d, idx) => d.classList.toggle('on', idx === i));
    onStep(i, steps[i]);
  }
  function go(n, fromPlay) {
    i = ((n % steps.length) + steps.length) % steps.length;
    render();
    if (!fromPlay) stop();
  }
  function stop() {
    playing = false;
    clearInterval(timer);
    timer = null;
    if (btnPlay) btnPlay.textContent = '▶ 재생';
  }
  if (btnPlay) btnPlay.addEventListener('click', () => {
    if (playing) { stop(); return; }
    playing = true;
    btnPlay.textContent = '⏸ 일시정지';
    timer = setInterval(() => go(i + 1, true), 2200);
  });
  if (btnPrev) btnPrev.addEventListener('click', () => go(i - 1, false));
  if (btnNext) btnNext.addEventListener('click', () => go(i + 1, false));

  if (labName) {
    __labAPI[labName] = (step) => go(step, false);
  }
  render();
  return { go, get index() { return i; } };
}

window.addEventListener('lab:step', (e) => {
  const { lab, step } = e.detail || {};
  if (lab && __labAPI[lab]) __labAPI[lab](step);
});

/* ════════════════════════════════════════════
   StreamPETR — street scene + query boxes + queue
   (light theme; scroll-synced steps)
   ════════════════════════════════════════════ */
function initStreamPETR() {
  const canvas = document.getElementById('lab-streampetr');
  if (!canvas) return;
  const root = canvas.closest('.method-scrolly') || canvas.closest('.lab');
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(LAB_BG, 14, 32);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
  camera.position.set(6.8, 3.4, 8.2);
  const orbit = attachOrbit(camera, canvas, new THREE.Vector3(-0.6, 0.55, 0.3));
  const zoom = makeZoomRig(camera, orbit);

  scene.add(new THREE.AmbientLight(0xffffff, 0.78));
  const key = new THREE.DirectionalLight(0xffffff, 0.95);
  key.position.set(5, 8, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xc4b5fd, 0.35);
  fill.position.set(-4, 3, -2); scene.add(fill);

  addStreetGround(scene);

  const ego = makeCar(0x0e7490, 2.0, 0.95, 0.58);
  ego.position.set(0, 0, 0);
  scene.add(ego);

  // Surrounding traffic (move along road)
  const traffic = [
    { car: makeCar(0xdc2626, 1.8, 0.88, 0.52), x: -2.0, z: 5.5, speed: 0.55, phase: 0.2, park: 2.4 },
    { car: makeCar(0x1d4ed8, 2.1, 0.95, 0.6), x: 2.1, z: -4.2, speed: 0.42, phase: 1.1, park: -2.2 },
    { car: makeCar(0x15803d, 1.7, 0.85, 0.5), x: -1.9, z: -7.5, speed: 0.48, phase: 2.4, park: -2.6 },
    { car: makeCar(0x8b5cf6, 1.85, 0.9, 0.55), x: 2.0, z: 8.0, speed: 0.38, phase: 0.7, park: 2.6 },
  ];
  traffic.forEach((tr) => {
    tr.car.position.set(tr.x, 0, tr.z);
    tr.car.traverse((o) => { o.userData.skipFit = true; });
    scene.add(tr.car);
  });

  // ── 6 camera frustums (translucent fans) ──
  const frustumGroup = new THREE.Group();
  const yaws = [-1.2, -0.6, 0, 0.6, 1.2, Math.PI];
  const frustCols = [0x22d3ee, 0x22d3ee, 0x22d3ee, 0x22d3ee, 0x22d3ee, 0x8b5cf6];
  yaws.forEach((yaw, i) => frustumGroup.add(makeFrustumFan(yaw, frustCols[i])));
  scene.add(frustumGroup);

  // Static fit anchors (traffic excluded from fit because it wraps far)
  const fitAnchors = new THREE.Group();
  [
    // Intentional framing hull (~ fills card at low angle)
    [0.2, 0.35, 0.2],
    [2.4, 0.9, 2.1], [-2.0, 0.9, 2.1], [2.4, 0.9, -1.8], [-2.0, 0.9, -1.8],
    [-4.6, 0.75, 1.4], [-4.6, 0.75, -1.4], [-4.6, 0.55, 0],
    [0.2, 1.05, 0.2], [1.6, 0.85, 1.0], [-1.2, 0.85, 1.0],
  ].forEach(([x,y,z]) => {
    const a = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 0.3),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    a.position.set(x, y, z);
    fitAnchors.add(a);
  });
  scene.add(fitAnchors);

  // Current image planes at frustum far (step 5) — placeholder gradient textures
  const imgGroup = new THREE.Group();
  imgGroup.visible = false;
  scene.add(imgGroup);
  const imgPlanes = [];
  yaws.slice(0, 6).forEach((yaw, i) => {
    const tex = makePlaceholderTex(190 + i * 18);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.46),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    const f = farPos(yaw, 2.55);
    plane.position.copy(f);
    plane.position.y = 1.15;
    plane.lookAt(0, 1.0, 0);
    imgGroup.add(plane);
    imgPlanes.push(plane);
  });
  function farPos(yaw, dist) {
    return new THREE.Vector3(Math.sin(yaw) * dist, 0, Math.cos(yaw) * dist);
  }

  // Current-frame queries on nearby cars (world space, follow cars)
  const currQueries = [
    { box: makeQueryBox(0xdb2777), trafficIdx: 0, offset: new THREE.Vector3(0, 0, 0) },
    { box: makeQueryBox(0xdb2777, [0.9, 0.65, 1.9]), trafficIdx: 1, offset: new THREE.Vector3(0, 0, 0) },
    { box: makeQueryBox(0xdb2777, [0.85, 0.6, 1.6]), trafficIdx: 2, offset: new THREE.Vector3(0, 0, 0) },
    { box: makeQueryBox(0xdb2777), trafficIdx: 3, offset: new THREE.Vector3(0, 0, 0) },
  ];
  const currGroup = new THREE.Group();
  currGroup.visible = false;
  currQueries.forEach((q) => {
    q.box.traverse((o) => { o.userData.skipFit = true; });
    currGroup.add(q.box);
  });
  scene.add(currGroup);

  // Memory queue: layered along time axis (−X / past), Top-K boxes per layer
  const QUEUE_LAYERS = 4;
  const queueRoot = new THREE.Group();
  queueRoot.position.set(-2.15, 0.4, 0);
  queueRoot.visible = false;
  scene.add(queueRoot);
  const queueLayers = [];
  const qCols = [0x67e8f9, 0x22d3ee, 0x06b6d4, 0x0891b2];
  for (let L = 0; L < QUEUE_LAYERS; L++) {
    const layer = new THREE.Group();
    layer.position.x = -L * 0.95;
    const boxes = [];
    for (let k = 0; k < 3; k++) {
      const b = makeQueryBox(qCols[L], [0.95, 0.65, 1.45]);
      b.position.set(0, 0, (k - 1) * 1.35);
      b.scale.setScalar(1 - L * 0.04);
      const op = 1 - L * 0.14;
      b.userData.edges.material.opacity = op;
      b.userData.edges.material.linewidth = 2;
      b.userData.fill.material.opacity = 0.14;
      b.userData.ref.material.opacity = op;
      b.userData.ref.material.emissiveIntensity = 1.25 - L * 0.15;
      layer.add(b);
      boxes.push(b);
    }
    // time-axis label tick
    const tick = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 4.2),
      new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.5 })
    );
    tick.position.set(0, 0.05, 0);
    layer.add(tick);
    queueRoot.add(layer);
    queueLayers.push({ group: layer, boxes, age: L });
  }
  // time axis line
  const axis = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0.5, 0.15, 0), new THREE.Vector3(-QUEUE_LAYERS * 0.95 - 0.3, 0.15, 0)
    ]),
    new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.55 })
  );
  queueRoot.add(axis);

  // Propagated / aligned past queries (step 3) — copies that slide toward current
  const alignedGroup = new THREE.Group();
  alignedGroup.visible = false;
  scene.add(alignedGroup);
  const aligned = [];
  for (let i = 0; i < 6; i++) {
    const b = makeQueryBox(0x8b5cf6, [0.75, 0.55, 1.3]);
    alignedGroup.add(b);
    aligned.push({
      box: b,
      from: new THREE.Vector3(-4.5 - (i % 3) * 0.2, 0.3, (i % 3 - 1) * 1.4),
      to: new THREE.Vector3(
        traffic[i % traffic.length].x * 0.85,
        0,
        traffic[i % traffic.length].z * 0.55
      ),
      u: 0,
    });
  }

  // Hybrid attention links (dashed flowing lines)
  const attnGroup = new THREE.Group();
  attnGroup.visible = false;
  scene.add(attnGroup);
  const attnLines = [];
  function rebuildAttn() {
    while (attnGroup.children.length) {
      const ch = attnGroup.children[0];
      attnGroup.remove(ch);
      ch.geometry?.dispose?.();
    }
    attnLines.length = 0;
    currQueries.forEach((cq, ci) => {
      queueLayers.forEach((layer, li) => {
        layer.boxes.forEach((qb, ki) => {
          if ((ci + ki + li) % 2 !== 0 && li > 1) return; // sparse
          const weight = Math.max(0.15, 1 - li * 0.22 - Math.abs(ki - 1) * 0.1);
          const mat = new THREE.LineDashedMaterial({
            color: weight > 0.55 ? 0x67e8f9 : 0xa78bfa,
            transparent: true,
            opacity: 0.5 + weight * 0.45,
            dashSize: 0.28,
            gapSize: 0.1,
            linewidth: 2,
          });
          const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(), new THREE.Vector3()
          ]);
          const line = new THREE.Line(geo, mat);
          line.computeLineDistances();
          attnGroup.add(line);
          attnLines.push({ line, cq, qb, weight, mat, dash: 0 });
        });
      });
    });
  }
  rebuildAttn();

  // Image cross-attn rays (step 5)
  const rayGroup = new THREE.Group();
  rayGroup.visible = false;
  scene.add(rayGroup);
  const rays = [];
  currQueries.forEach((cq, ci) => {
    const plane = imgPlanes[ci % imgPlanes.length];
    const mat = new THREE.LineBasicMaterial({
      color: 0x34d399, transparent: true, opacity: 0.85
    });
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(), new THREE.Vector3()
    ]);
    const line = new THREE.Line(geo, mat);
    rayGroup.add(line);
    rays.push({ line, cq, plane });
  });

  // Velocity / Δt correction markers (step 3)
  const corrGroup = new THREE.Group();
  corrGroup.visible = false;
  scene.add(corrGroup);
  aligned.forEach((a) => {
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0.2).normalize(),
      new THREE.Vector3(),
      0.7,
      0xf59e0b,
      0.18,
      0.12
    );
    corrGroup.add(arrow);
    a.arrow = arrow;
  });

  const clutterSP = [ego, frustumGroup, ...traffic.map((tr) => tr.car)];
  function dimGroupsSP(st) {
    if (!st?.zoom?.dim) return [];
    if (st.zoom.dim === 'cross') return [...clutterSP, queueRoot, alignedGroup];
    return clutterSP;
  }
  const steps = [
    { title: '1. 현재 프레임 쿼리', body: '주변 차량에 붙은 3D query box(분홍)와 기준점이 현재 프레임에서 나타납니다. 아직 메모리와 섞이지 않습니다.', phase: 0 },
    { title: '2. FIFO Memory Queue', body: '과거 Top-K foreground query가 시간축을 따라 층층이 쌓입니다. 오래된 레이어일수록 흐려집니다.', phase: 1, zoom: { pos: [2.8, 2.8, 4.2], target: [-2.0, 0.75, 0], dim: 'clutter' } },
    { title: '3. Ego Transform + MLN', body: '자차가 전진하며 과거 박스가 현재 좌표로 미끄러져 옵니다. 주황 화살표는 v·Δt 보정(MLN)을 나타냅니다.', phase: 2 },
    { title: '4. Hybrid Attention', body: '현재 쿼리(Q)와 메모리 큐(K/V) 사이 점선이 흐릅니다. 굵고 밝은 선일수록 attention weight가 큽니다.', phase: 3, zoom: { pos: [4.4, 4.6, 6.0], target: [-1.3, 0.4, 0], dim: 'clutter' } },
    { title: '5. 이미지 Cross-Attn', body: '쿼리에서 현재 카메라 frustum·이미지 평면으로 광선이 닿습니다. 과거 이미지는 다시 보지 않습니다.', phase: 4, zoom: { pos: [6.2, 5.4, 6.4], target: [0, 0.7, 0], dim: 'cross' } },
    { title: '6. Top-K → 큐 갱신', body: '점수가 높은 박스가 큐 맨 앞으로 올라가고, 가장 오래된 레이어는 빠져나갑니다.', phase: 5, zoom: { pos: [2.8, 2.8, 4.2], target: [-2.4, 0.75, 0], dim: 'clutter' } },
  ];

  let phase = 0;
  let phaseT0 = performance.now();
  let egoBaseZ = 0;

  function applyPhase(p) {
    phase = p;
    phaseT0 = performance.now();
    currGroup.visible = p < 5; // step 6: current queries are pushed into the queue
    queueRoot.visible = p >= 1;
    alignedGroup.visible = p >= 2 && p < 5;
    corrGroup.visible = p === 2;
    attnGroup.visible = p === 3;
    imgGroup.visible = p === 4;
    rayGroup.visible = p === 4;

    // reset queue layer opacities / positions
    queueLayers.forEach((layer, L) => {
      layer.group.visible = true;
      layer.group.position.x = -L * 0.95;
      layer.group.position.y = 0;
      const op = 0.95 - L * 0.18;
      layer.boxes.forEach((b) => {
        b.userData.edges.material.opacity = op;
        b.userData.ref.material.opacity = op;
        b.userData.edges.material.color.set(qCols[L]);
        b.userData.ref.material.color.set(qCols[L]);
        b.userData.ref.material.emissive.set(qCols[L]);
        b.scale.setScalar(1 - L * 0.06);
      });
    });

    if (p >= 5) {
      // top-k rise: first layer becomes pink (updated), oldest exits
      queueLayers[0].boxes.forEach((b) => {
        b.userData.edges.material.color.set(0xdb2777);
        b.userData.ref.material.color.set(0xdb2777);
        b.userData.ref.material.emissive.set(0xdb2777);
        b.userData.ref.material.emissiveIntensity = 1.3;
      });
    }

    aligned.forEach((a) => { a.u = 0; a.box.position.copy(a.from); });
    ego.position.z = 0;
    egoBaseZ = 0;
    zoom.clearDetail();
    const stepMeta = steps.find((s) => s.phase === p) || steps[p];
    if (stepMeta?.zoom) zoom.setDetail(stepMeta.zoom.pos, stepMeta.zoom.target, dimGroupsSP(stepMeta));
    orbit.controls.update();
    renderer.render(scene, camera);
  }

  bindLabUI(root, steps, (i) => applyPhase(steps[i].phase), 'streampetr');
  __labDebug['streampetr'] = { scene, camera, canvas, orbit, renderer };
  __labZoom['streampetr'] = (step, progress) => {
    const st = steps[step];
    if (!st?.zoom) { zoom.scrub(0); return; }
    if (st.zoom.dim) zoom.setDetail(st.zoom.pos, st.zoom.target, dimGroupsSP(st));
    zoom.scrub(1);
  };

  let running = false;
  const io = new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0.12 });
  io.observe(canvas);
  fit(renderer, camera, canvas);
  // initial visibility for fit bounds
  /** Steeper look-down so objects rise in frame (less empty sky). */
  function frameStreet() {
    const tgt = new THREE.Vector3(-0.9, 0.3, 0.2);
    const pos = new THREE.Vector3(5.0, 4.6, 5.6);
    camera.position.copy(pos);
    orbit.controls.target.copy(tgt);
    camera.near = 0.08;
    camera.far = 45;
    camera.updateProjectionMatrix();
    orbit.controls.update();
    orbit.setHomeFromCamera();
    zoom.captureHome();
    zoom.reset();
  }

  frameStreet();
  applyPhase(0);

  window.addEventListener('resize', () => {
    fit(renderer, camera, canvas);
    frameStreet();
  });

  const _tmp = new THREE.Vector3();
  const _tmp2 = new THREE.Vector3();

  function frame(now) {
    requestAnimationFrame(frame);
    if (!running) {
      orbit.controls.update();
      return;
    }
    const clock = now * 0.001;
    const elapsed = (now - phaseT0) / 1000;
    const motion = reduceMotion ? 0 : 1;

    // traffic motion — parked near ego while Q↔K/V and image rays are shown
    const parked = phase === 3 || phase === 4;
    traffic.forEach((tr) => {
      if (parked) {
        tr.car.position.z += (tr.park - tr.car.position.z) * (motion ? 0.08 : 1);
      } else if (motion) {
        tr.car.position.z = ((tr.z + clock * tr.speed * 1.2 + tr.phase * 3) % 14) - 7;
      } else {
        tr.car.position.z = tr.z;
      }
    });

    // sync current query boxes to cars
    currQueries.forEach((q) => {
      const car = traffic[q.trafficIdx].car;
      q.box.position.set(car.position.x, 0.02, car.position.z);
      q.box.rotation.y = car.rotation.y;
      if (!reduceMotion) {
        q.box.userData.ref.material.emissiveIntensity = 0.85 + Math.sin(clock * 3 + q.trafficIdx) * 0.25;
      }
    });

    // ego nudge on step 3
    if (phase === 2 && motion) {
      ego.position.z = Math.min(1.8, elapsed * 0.55);
      frustumGroup.position.z = ego.position.z;
    } else if (phase !== 2) {
      // keep ego near 0 except mild idle
      if (motion && phase < 2) ego.position.z = Math.sin(clock * 0.35) * 0.08;
      frustumGroup.position.z = ego.position.z;
    }
    frustumGroup.position.x = ego.position.x;

    // aligned slide (step 3)
    if (phase === 2) {
      aligned.forEach((a, i) => {
        const u = reduceMotion ? 1 : Math.min(1, elapsed * 0.55 - i * 0.08);
        a.u = Math.max(0, u);
        a.box.position.lerpVectors(a.from, a.to, a.u);
        // slight Δt correction offset
        a.box.position.x += Math.sin(a.u * Math.PI) * 0.15;
        if (a.arrow) {
          a.arrow.position.copy(a.box.position).add(new THREE.Vector3(0.2, 0.55, 0));
          a.arrow.visible = a.u > 0.15 && a.u < 0.95;
        }
      });
    }

    // attention dash flow (step 4)
    if (phase === 3) {
      attnLines.forEach((a) => {
        const p0 = a.cq.box.getWorldPosition(_tmp);
        p0.y += 0.35;
        const p1 = a.qb.getWorldPosition(_tmp2);
        p1.y += 0.3;
        const pos = a.line.geometry.attributes.position;
        pos.setXYZ(0, p0.x, p0.y, p0.z);
        pos.setXYZ(1, p1.x, p1.y, p1.z);
        pos.needsUpdate = true;
        a.line.computeLineDistances();
        if (motion) {
          a.mat.dashOffset = -(clock * (1.2 + a.weight * 2.5));
          a.mat.needsUpdate = true;
        }
      });
    }

    // rays to image planes (step 5)
    if (phase === 4) {
      rays.forEach((r) => {
        const p0 = r.cq.box.getWorldPosition(_tmp);
        p0.y += 0.35;
        const p1 = r.plane.getWorldPosition(_tmp2);
        const pos = r.line.geometry.attributes.position;
        pos.setXYZ(0, p0.x, p0.y, p0.z);
        pos.setXYZ(1, p1.x, p1.y, p1.z);
        pos.needsUpdate = true;
        if (motion) r.line.material.opacity = 0.8 + Math.sin(clock * 4) * 0.2;
      });
    }

    // Top-K update animation (step 6)
    if (phase === 5) {
      const u = reduceMotion ? 1 : Math.min(1, elapsed * 0.7);
      // new layer rises
      queueLayers[0].group.position.y = (1 - u) * 1.2;
      queueLayers[0].boxes.forEach((b) => b.scale.setScalar(0.85 + 0.2 * u));
      // oldest exits left + fade
      const last = queueLayers[QUEUE_LAYERS - 1];
      last.group.position.x = -((QUEUE_LAYERS - 1) * 0.95) - u * 1.6;
      last.boxes.forEach((b) => {
        b.userData.edges.material.opacity = 0.95 - 0.18 * (QUEUE_LAYERS - 1) - u * 0.7;
        b.userData.ref.material.opacity = b.userData.edges.material.opacity;
      });
      // shift middle layers slightly toward front
      for (let L = 1; L < QUEUE_LAYERS - 1; L++) {
        queueLayers[L].group.position.x = -L * 0.95 + u * 0.28;
      }
    }

    // queue idle fade by age when visible
    if (phase >= 1 && phase < 5 && motion) {
      queueLayers.forEach((layer, L) => {
        layer.group.position.y = Math.sin(clock * 0.8 + L) * 0.02;
      });
    }

    orbit.controls.update();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}

/* ════════════════════════════════════════════
   Sparse4D v1 — image feature queue + 4D keypoints
   ════════════════════════════════════════════ */
function initS4Dv1() {
  const canvas = document.getElementById('lab-s4dv1');
  if (!canvas) return;
  const home = { pos: [8.4, 5.6, 3.4], target: [0.4, 0.5, -2.6] }; // side-on: time axis (−z) runs across the frame
  const { root, renderer, scene, camera, orbit, zoom } = bootStreetLab(canvas, { home });

  const ego = makeCar(0x0e7490);
  scene.add(ego);
  const frustumGroup = new THREE.Group();
  [-1.1, -0.55, 0, 0.55, 1.1, Math.PI].forEach((yaw, i) => {
    frustumGroup.add(makeFrustumFan(yaw, i === 5 ? 0x8b5cf6 : 0x22d3ee));
  });
  scene.add(frustumGroup);

  const traffic = [
    { car: makeCar(0xdc2626, 1.8, 0.88, 0.52), x: -2.0, z: 4.5, speed: 0.45, phase: 0.3 },
    { car: makeCar(0x1d4ed8, 2.0, 0.92, 0.58), x: 2.0, z: -3.8, speed: 0.38, phase: 1.4 },
  ];
  traffic.forEach((tr) => {
    tr.car.position.set(tr.x, 0, tr.z);
    tr.car.traverse((o) => { o.userData.skipFit = true; });
    scene.add(tr.car);
  });

  // Past T image-feature stacks (ghost poses along -Z)
  const T = 4;
  const pastStacks = [];
  const pastGhosts = [];
  for (let ti = 0; ti < T; ti++) {
    const g = new THREE.Group();
    g.position.set(-0.3, 0, -2.2 - ti * 2.0);
    const ghost = makeCar(0x64748b, 1.9, 0.9, 0.55);
    ghost.traverse((o) => {
      if (o.material) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.25 + ti * 0.08;
      }
    });
    g.add(ghost);
    pastGhosts.push(ghost);
    for (let c = 0; c < 3; c++) {
      const p = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62, 0.4),
        new THREE.MeshBasicMaterial({
          map: makePlaceholderTex(200 - ti * 15),
          transparent: true, opacity: 0.38 + ti * 0.06, side: THREE.DoubleSide
        })
      );
      p.position.set(1.6, 1.05 + c * 0.42, 0);
      p.rotation.y = 1.0; // face the side-on camera
      g.add(p);
    }
    // label tick
    const tick = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.08),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee })
    );
    tick.position.set(0, 1.8, 0);
    g.add(tick);
    scene.add(g);
    pastStacks.push(g);
  }

  // Current anchor + 4D keypoints
  const anchor = makeQueryBox(0xfbbf24, [1.2, 0.85, 2.0]);
  anchor.position.set(1.6, 0.02, 1.4);
  scene.add(anchor);
  const kpGroup = new THREE.Group();
  scene.add(kpGroup);
  const kpLabel = makeTextLabel('keypoints', { color: '#f472b6', scale: 0.85, size: 26, w: 280, h: 64 });
  kpLabel.position.set(1.6, 1.35, 1.4);
  kpGroup.add(kpLabel);
  const kps = [];
  for (let i = 0; i < 10; i++) {
    const s = glowSphere(0.07, 0xdb2777);
    const a = (i / 10) * Math.PI * 2;
    s.position.set(
      1.6 + Math.cos(a) * 0.45,
      0.45 + Math.sin(a * 2) * 0.28,
      1.4 + Math.sin(a) * 0.7
    );
    kpGroup.add(s);
    kps.push(s);
  }

  // Projection rays to past planes
  const rayGroup = new THREE.Group();
  scene.add(rayGroup);
  const rayLines = [];
  kps.forEach((kp, ki) => {
    if (ki % 2) return; // thin readable rays — every other keypoint
    pastStacks.forEach((stack, ti) => {
      if (ti > 1) return; // only nearest two past stacks
      const mat = new THREE.LineDashedMaterial({
        color: 0xf472b6, transparent: true, opacity: 0.85,
        dashSize: 0.2, gapSize: 0.1
      });
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      rayGroup.add(line);
      rayLines.push({ line, kp, stack, ti });
    });
  });

  // Sampling pulse markers on planes
  const sampleGroup = new THREE.Group();
  scene.add(sampleGroup);

  const clutterV1 = [ego, frustumGroup, ...traffic.map((tr) => tr.car)];
  const focusV1 = [anchor, kpGroup, rayGroup, sampleGroup, ...pastStacks];
  function dimGroupsV1(st) {
    if (!st?.zoom?.dim) return [];
    // Keypoints: hide stacks for readable KP; projection/sampling keep planes, hide ghosts
    if (st.phase === 2) return [...clutterV1, ...pastStacks];
    if (st.phase === 3 || st.phase === 4) return [...clutterV1, ...pastGhosts];
    return clutterV1;
  }
  const steps = [
    { title: '1. 이미지 feature 큐', body: 'T개 시점의 멀티뷰 feature가 큐에 쌓입니다. Instance가 아니라 이미지를 기억합니다.', phase: 0 },
    { title: '2. 3D 앵커', body: '후보 instance는 3D anchor box로 표현됩니다.', phase: 1 },
    { title: '3. 4D Keypoints', body: '앵커 안에서 고정·학습 keypoints가 생깁니다. 시공간 샘플링의 발판입니다.', phase: 2, zoom: { pos: [4.9, 3.3, 5.5], target: [1.55, 0.75, 1.35], dim: 'clutter' } },
    { title: '4. 과거 프레임에 투영', body: 'keypoints를 각 과거 timestamp·카메라 평면에 투영합니다.', phase: 3, zoom: { pos: [8.2, 4.8, 2.6], target: [1.2, 0.9, -1.2], dim: 'clutter' } },
    { title: '5. Deformable sampling', body: '투영 위치 주변 multi-scale feature를 deformable sampling합니다.', phase: 4, zoom: { pos: [7.4, 4.2, 1.6], target: [1.4, 1.0, -1.6], dim: 'clutter' } },
    { title: '6. 앵커 정제', body: '모은 feature로 앵커를 정제합니다. Instance는 넘기지 않고 feature 큐만 갱신합니다.', phase: 5 },
  ];

  let phase = 0;
  let phaseT0 = performance.now();
  function applyPhase(p) {
    phase = p;
    phaseT0 = performance.now();
    pastStacks.forEach((g, ti) => {
      g.visible = p >= 0;
      g.children.forEach((ch) => {
        if (ch.material && ch.material.opacity !== undefined && ch.type === 'Mesh') {
          // leave cars/planes
        }
      });
    });
    anchor.visible = p >= 1;
    kpGroup.visible = p >= 2;
    rayGroup.visible = p >= 2; // thin projection rays readable with keypoints zoom
    sampleGroup.visible = p >= 4;
    const st = steps.find((s) => s.phase === p);
    zoom.clearDetail();
    setStreetHome(camera, orbit, zoom, home);
    if (st?.zoom) zoom.setDetail(st.zoom.pos, st.zoom.target, dimGroupsV1(st));
    renderer.render(scene, camera);
  }

  bindLabUI(root, steps, (i) => applyPhase(steps[i].phase), 's4dv1');
  __labDebug['s4dv1'] = { scene, camera, canvas, orbit, renderer };
  __labZoom['s4dv1'] = (step, progress) => {
    const st = steps[step];
    if (!st?.zoom) { zoom.scrub(0); return; }
    if (st.zoom.dim) zoom.setDetail(st.zoom.pos, st.zoom.target, dimGroupsV1(st));
    zoom.scrub(1);
  };

  let running = false;
  new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0.12 }).observe(canvas);
  fit(renderer, camera, canvas);
  setStreetHome(camera, orbit, zoom, home, true);
  applyPhase(0);
  window.addEventListener('resize', () => { fit(renderer, camera, canvas); setStreetHome(camera, orbit, zoom, home, true); });

  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  (function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;
    const clock = now * 0.001;
    const motion = reduceMotion ? 0 : 1;
    traffic.forEach((tr) => {
      tr.car.position.z = motion ? ((tr.z + clock * tr.speed * 1.2 + tr.phase * 3) % 14) - 7 : tr.z;
    });
    if (phase >= 3) {
      rayLines.forEach((r) => {
        r.kp.getWorldPosition(_a);
        _b.set(r.stack.position.x + 1.6, 1.2, r.stack.position.z);
        const pos = r.line.geometry.attributes.position;
        pos.setXYZ(0, _a.x, _a.y, _a.z);
        pos.setXYZ(1, _b.x, _b.y, _b.z);
        pos.needsUpdate = true;
        r.line.computeLineDistances();
        if (motion) r.line.material.dashOffset = -clock * 1.4;
      });
    }
    if (phase >= 2 && motion) {
      kps.forEach((s, i) => {
        s.material.emissiveIntensity = 0.9 + Math.sin(clock * 3 + i) * 0.3;
      });
    }
    orbit.controls.update();
    renderer.render(scene, camera);
  })(performance.now());
}

/* ════════════════════════════════════════════
   Sparse4D v2 — recurrent instance + current images
   ════════════════════════════════════════════ */
function initS4Dv2() {
  const canvas = document.getElementById('lab-s4dv2');
  if (!canvas) return;
  const home = { pos: [5.8, 5.0, 6.4], target: [-0.4, 0.3, -0.4] };
  const { root, renderer, scene, camera, orbit, zoom } = bootStreetLab(canvas, { home });

  const ego = makeCar(0x0e7490);
  scene.add(ego);
  const frustumGroup = new THREE.Group();
  [-1.0, -0.5, 0, 0.5, 1.0, Math.PI].forEach((yaw, i) => {
    frustumGroup.add(makeFrustumFan(yaw, i === 5 ? 0x8b5cf6 : 0x22d3ee));
  });
  scene.add(frustumGroup);

  // t-1 instances (left / past)
  const pastGroup = new THREE.Group();
  pastGroup.position.set(-3.2, 0, -1.2);
  scene.add(pastGroup);
  const pastInst = [];
  const cols = [0x22d3ee, 0x8b5cf6, 0x34d399, 0xfbbf24];
  for (let i = 0; i < 4; i++) {
    const box = makeQueryBox(cols[i], [0.95, 0.7, 1.6]);
    box.position.set((i % 2) * 1.3 - 0.4, 0, Math.floor(i / 2) * 1.7 - 0.6);
    pastGroup.add(box);
    pastInst.push(box);
  }

  // Propagated to t (center) via ego + v·Δt
  const currGroup = new THREE.Group();
  scene.add(currGroup);
  const currInst = pastInst.map((p, i) => {
    const b = makeQueryBox(cols[i], [0.95, 0.7, 1.6]);
    b.position.set(p.position.x + 2.8, 0, p.position.z + 1.5);
    currGroup.add(b);
    return b;
  });

  // Motion arrows
  const arrowGroup = new THREE.Group();
  scene.add(arrowGroup);
  const arrows = pastInst.map((p, i) => {
    const dir = new THREE.Vector3(2.8, 0, 1.5).normalize();
    const ah = new THREE.ArrowHelper(dir, p.position.clone().add(new THREE.Vector3(-3.2, 0.6, -1.2)), 1.6, 0xf59e0b, 0.22, 0.14);
    arrowGroup.add(ah);
    return ah;
  });

  // Current-only image planes
  const imgGroup = new THREE.Group();
  scene.add(imgGroup);
  for (let i = 0; i < 5; i++) {
    const yaw = -1.0 + i * 0.5;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.28),
      new THREE.MeshBasicMaterial({ map: makePlaceholderTex(160 + i * 12), transparent: true, opacity: 0.32, side: THREE.DoubleSide })
    );
    plane.position.set(Math.sin(yaw) * 3.0, 1.55, Math.cos(yaw) * 3.0);
    plane.lookAt(0, 1.2, 0);
    imgGroup.add(plane);
  }
  const sampleLabel = makeTextLabel('current image sample', { color: '#34d399', scale: 0.85, size: 22, w: 360, h: 64 });
  sampleLabel.position.set(1.6, 2.25, 0.4);
  imgGroup.add(sampleLabel);

  // Newborn single-frame layer
  const newborn = makeQueryBox(0xdb2777, [0.9, 0.65, 1.5]);
  newborn.position.set(2.2, 0, -2.4);
  scene.add(newborn);

  // Sample rays current only
  const sampleRays = new THREE.Group();
  scene.add(sampleRays);
  const sLines = [];
  currInst.forEach((b, i) => {
    const plane = imgGroup.children[i % imgGroup.children.length];
    const mat = new THREE.LineBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.7 });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), mat);
    sampleRays.add(line);
    sLines.push({ line, b, plane });
  });

  const clutterV2 = [ego, frustumGroup, pastGroup];
  const steps = [
    { title: '1. 이전 instance', body: 't−1의 anchor와 instance feature가 상태로 남습니다. 과거 이미지 큐는 없습니다.', phase: 0 },
    { title: '2. Ego + v·Δt 투영', body: '앵커를 ego motion과 속도 v·Δt로 현재 시각 좌표계로 투영합니다.', phase: 1 },
    { title: '3. 현재 이미지만 샘플', body: '투영된 앵커에서 현재 프레임 이미지 feature만 deformable sampling합니다.', phase: 2, zoom: { pos: [5.4, 5.0, 4.6], target: [0.6, 0.9, 1.0], dim: 'clutter' } },
    { title: '4. Recurrent 갱신', body: 'Fₜ = decode(Fₜ₋₁, 현재 샘플). instance feature가 재귀적으로 이어집니다.', phase: 3 },
    { title: '5. Single-frame 경로', body: '새 객체는 single-frame layer에서 초기화되고, 전파 객체는 multi-frame layer가 담당합니다.', phase: 4 },
    { title: '6. 부가 모듈', body: 'EDA·camera encoding·dense depth supervision이 학습을 보강합니다.', phase: 5 },
  ];

  let phase = 0;
  function applyPhase(p) {
    phase = p;
    pastGroup.visible = p >= 0;
    arrowGroup.visible = p === 1;
    currGroup.visible = p >= 1;
    imgGroup.visible = p >= 2;
    sampleRays.visible = p >= 2 && p < 5;
    newborn.visible = p >= 4;
    zoom.clearDetail();
    setStreetHome(camera, orbit, zoom, home);
    const st = steps.find((s) => s.phase === p);
    if (st?.zoom) zoom.setDetail(st.zoom.pos, st.zoom.target, st.zoom.dim ? clutterV2 : []);
    renderer.render(scene, camera);
  }

  bindLabUI(root, steps, (i) => applyPhase(steps[i].phase), 's4dv2');
  __labDebug['s4dv2'] = { scene, camera, canvas, orbit, renderer };
  __labZoom['s4dv2'] = (step, progress) => {
    const st = steps[step];
    if (!st?.zoom) { zoom.scrub(0); return; }
    // Dim ego/frustums/past — keep current anchors + smaller image planes readable
    if (st.zoom.dim) zoom.setDetail(st.zoom.pos, st.zoom.target, clutterV2);
    zoom.scrub(1);
  };

  let running = false;
  new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0.12 }).observe(canvas);
  fit(renderer, camera, canvas);
  setStreetHome(camera, orbit, zoom, home, true);
  applyPhase(0);
  window.addEventListener('resize', () => { fit(renderer, camera, canvas); setStreetHome(camera, orbit, zoom, home, true); });

  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  (function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;
    const clock = now * 0.001;
    const motion = reduceMotion ? 0 : 1;
    if (phase === 1 && motion) {
      const u = Math.min(1, ((now % 2000) / 2000));
      currInst.forEach((b, i) => {
        const from = pastInst[i].position.clone().add(pastGroup.position);
        const to = new THREE.Vector3(pastInst[i].position.x + 2.8, 0, pastInst[i].position.z + 1.5);
        b.position.lerpVectors(from, to, easeInOut(u));
      });
    }
    if (phase >= 2) {
      sLines.forEach((s) => {
        s.b.getWorldPosition(_a); _a.y += 0.4;
        s.plane.getWorldPosition(_b);
        const pos = s.line.geometry.attributes.position;
        pos.setXYZ(0, _a.x, _a.y, _a.z);
        pos.setXYZ(1, _b.x, _b.y, _b.z);
        pos.needsUpdate = true;
      });
    }
    if (motion) ego.rotation.y = Math.sin(clock * 0.3) * 0.06;
    orbit.controls.update();
    renderer.render(scene, camera);
  })(performance.now());
}

/* ════════════════════════════════════════════
   Sparse4D v3 — v2 + DN / QE / decoupled attn
   ════════════════════════════════════════════ */
function initS4Dv3() {
  const canvas = document.getElementById('lab-s4dv3');
  if (!canvas) return;
  const home = { pos: [5.4, 4.6, 6.4], target: [0, 0.45, 0.2] };
  const { root, renderer, scene, camera, orbit, zoom } = bootStreetLab(canvas, { home });

  const ego = makeCar(0x0e7490);
  scene.add(ego);
  const frustumGroup = new THREE.Group();
  [-1.0, -0.5, 0, 0.5, 1.0, Math.PI].forEach((yaw, i) => {
    frustumGroup.add(makeFrustumFan(yaw, i === 5 ? 0x8b5cf6 : 0x22d3ee));
  });
  scene.add(frustumGroup);

  // Inference path = v2 gray anchors
  const infer = new THREE.Group();
  scene.add(infer);
  for (let i = 0; i < 3; i++) {
    const b = makeQueryBox(0x94a3b8, [0.9, 0.65, 1.5]);
    b.position.set((i - 1) * 1.5, 0, 0.8);
    infer.add(b);
  }

  // Training-only noisy GT
  const trainGroup = new THREE.Group();
  scene.add(trainGroup);
  const noisy = [];
  const gt = [];
  for (let i = 0; i < 3; i++) {
    const g = makeQueryBox(0x34d399, [1.0, 0.75, 1.7]);
    g.position.set((i - 1) * 1.5, 0, -1.2);
    trainGroup.add(g);
    gt.push(g);
    const n = makeQueryBox(0xf59e0b, [1.0, 0.75, 1.7]);
    n.position.set((i - 1) * 1.5 + 0.25, 0.05, -1.0);
    trainGroup.add(n);
    noisy.push(n);
  }
  // TRAIN-ONLY badge (sprite-like plane)
  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.35),
    new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.92, side: THREE.DoubleSide })
  );
  badge.position.set(0, 2.1, -1.1);
  trainGroup.add(badge);
  const trainLab = makeTextLabel('TRAIN-ONLY', { color: '#fbbf24', scale: 0.9, size: 24, w: 300, h: 60 });
  trainLab.position.set(0, 2.55, -1.1);
  trainGroup.add(trainLab);

  // Quality estimation badges
  const qeGroup = new THREE.Group();
  scene.add(qeGroup);
  infer.children.forEach((b, i) => {
    const center = glowSphere(0.12, 0x22d3ee);
    center.position.copy(b.position); center.position.y = 1.15;
    qeGroup.add(center);
    const yaw = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), b.position.clone().add(new THREE.Vector3(0, 1.0, 0)), 0.7, 0x8b5cf6, 0.15, 0.1);
    qeGroup.add(yaw);
  });

  // Decoupled attention: larger bars + non-overlapping labels (L/R of bars, concat below)
  const decGroup = new THREE.Group();
  decGroup.position.set(0, 1.7, 2.15);
  scene.add(decGroup);
  const featBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 1.1, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 0.55 })
  );
  featBar.position.set(-0.42, 0, 0);
  const embBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 1.1, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x8b5cf6, emissive: 0x8b5cf6, emissiveIntensity: 0.55 })
  );
  embBar.position.set(0.42, 0, 0);
  const concat = wireBox(1.7, 1.45, 0.7, 0xcbd5e1, 0.85);
  concat.position.set(0, 0, 0);
  decGroup.add(featBar, embBar, concat);
  const labFeat = makeTextLabel('feature', { color: '#22d3ee', scale: 0.72, size: 26, w: 280, h: 64 });
  labFeat.position.set(-0.95, 0.85, 0.35); // above-left of cyan bar
  const labEmb = makeTextLabel('anchor emb', { color: '#a78bfa', scale: 0.78, size: 24, w: 320, h: 64 });
  labEmb.position.set(1.05, 0.85, 0.35); // above-right of violet bar
  const labCat = makeTextLabel('concat', { color: '#e2e8f0', scale: 0.75, size: 26, w: 260, h: 64 });
  labCat.position.set(0, -1.05, 0.25); // below frame, clear of bar labels
  decGroup.add(labFeat, labEmb, labCat);

  const clutterV3 = [ego, frustumGroup];
  function dimGroupsV3(st) {
    if (!st?.zoom?.dim) return [];
    // DN: keep trainGroup; QE: keep infer+qe; Decoupled: keep decGroup only
    if (st.phase === 1) return [...clutterV3, infer, qeGroup];
    if (st.phase === 3) return [...clutterV3, trainGroup];
    if (st.phase === 4) return [...clutterV3, infer, trainGroup, qeGroup];
    return [...clutterV3];
  }
  const steps = [
    { title: '1. v2와 같은 추론', body: '배포·추론 그래프는 Sparse4D v2 recurrent pipeline을 그대로 씁니다.', phase: 0 },
    { title: '2. Temporal Instance Denoising', body: '학습 때 GT에 noise를 주고 복원합니다. 추론 그래프에는 없습니다 (TRAIN-ONLY).', phase: 1, zoom: { pos: [4.4, 3.2, 3.8], target: [0, 0.95, -1.1], dim: 'clutter' } },
    { title: '3. 노이즈 → GT 복원', body: 'noisy instance가 초록 GT에 가깝게 돌아가며 temporal association을 강화합니다.', phase: 2 },
    { title: '4. Quality Estimation', body: 'centerness·yawness 헤드가 로컬화 품질을 예측합니다.', phase: 3, zoom: { pos: [4.4, 3.0, 4.4], target: [0, 1.0, 0.75], dim: 'clutter' } },
    { title: '5. Decoupled Attention', body: 'instance feature와 anchor embedding을 더하지 않고 concat한 뒤 attention합니다.', phase: 4, zoom: { pos: [2.4, 2.9, 5.6], target: [0, 1.5, 2.15], dim: 'clutter' } },
    { title: '6. 정리', body: '온디바이스 추론 = v2 + (QE 헤드·concat 차원). Denoising은 학습 전용입니다.', phase: 5 },
  ];

  let phase = 0;
  function applyPhase(p) {
    phase = p;
    infer.visible = true;
    trainGroup.visible = p >= 1 && p < 4;
    noisy.forEach((n) => { n.visible = p >= 1 && p < 3; });
    qeGroup.visible = p >= 3;
    decGroup.visible = p >= 4;
    zoom.clearDetail();
    setStreetHome(camera, orbit, zoom, home);
    const st = steps.find((s) => s.phase === p);
    // Per-zoom focus: never dim the subject of that step
    const dimV3 = dimGroupsV3(st);
    if (st?.zoom) zoom.setDetail(st.zoom.pos, st.zoom.target, dimV3);
    renderer.render(scene, camera);
  }

  bindLabUI(root, steps, (i) => applyPhase(steps[i].phase), 's4dv3');
  __labDebug['s4dv3'] = { scene, camera, canvas, orbit, renderer };
  __labZoom['s4dv3'] = (step, progress) => {
    const st = steps[step];
    if (!st?.zoom) { zoom.scrub(0); return; }
    zoom.setDetail(st.zoom.pos, st.zoom.target, dimGroupsV3(st));
    zoom.scrub(1);
  };

  let running = false;
  new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0.12 }).observe(canvas);
  fit(renderer, camera, canvas);
  setStreetHome(camera, orbit, zoom, home, true);
  applyPhase(0);
  window.addEventListener('resize', () => { fit(renderer, camera, canvas); setStreetHome(camera, orbit, zoom, home, true); });

  (function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;
    const clock = now * 0.001;
    const motion = reduceMotion ? 0 : 1;
    if (phase === 2 && motion) {
      noisy.forEach((n, i) => {
        n.position.lerp(gt[i].position, 0.03);
      });
    }
    if (phase >= 4 && motion) {
      featBar.position.y = Math.sin(clock * 2) * 0.05;
      embBar.position.y = Math.sin(clock * 2 + 1) * 0.05;
    }
    if (motion) ego.rotation.y = Math.sin(clock * 0.25) * 0.05;
    orbit.controls.update();
    renderer.render(scene, camera);
  })(performance.now());
}

/* ════════════════════════════════════════════
   Foundation4D — scene tokens + multi-head
   ════════════════════════════════════════════ */
function initF4D() {
  const canvas = document.getElementById('lab-f4d');
  if (!canvas) return;
  const home = { pos: [6.2, 5.4, 7.0], target: [0, 0.7, 0] };
  const { root, renderer, scene, camera, orbit, zoom } = bootStreetLab(canvas, { home });

  const ego = makeCar(0x0e7490, 2.0, 0.95, 0.58);
  scene.add(ego);
  const frustumGroup = new THREE.Group();
  const yaws = [-1.15, -0.55, 0, 0.55, 1.15, Math.PI];
  yaws.forEach((yaw, i) => frustumGroup.add(makeFrustumFan(yaw, i === 5 ? 0x8b5cf6 : 0x22d3ee)));
  scene.add(frustumGroup);

  // Multi-cam video strips
  const camGroup = new THREE.Group();
  scene.add(camGroup);
  yaws.forEach((yaw, i) => {
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 0.7),
      new THREE.MeshBasicMaterial({ map: makePlaceholderTex(180 + i * 14), transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    p.position.set(Math.sin(yaw) * 2.5, 1.0, Math.cos(yaw) * 2.5);
    p.lookAt(0, 1.0, 0);
    camGroup.add(p);
  });

  // Factorized attention rings (view / time)
  const attnGroup = new THREE.Group();
  scene.add(attnGroup);
  const viewRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.03, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55 })
  );
  viewRing.rotation.x = Math.PI / 2;
  viewRing.position.y = 1.0;
  const timeRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.8, 0.03, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.55 })
  );
  timeRing.position.set(0, 1.2, 0);
  attnGroup.add(viewRing, timeRing);

  // Scene token lattice
  const tokens = new THREE.Group();
  tokens.position.set(0, 1.35, 0);
  scene.add(tokens);
  const tokenMeshes = [];
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      for (let y = 0; y <= 2; y++) {
        if ((x + z + y) % 2) continue;
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.22, 0.22),
          new THREE.MeshStandardMaterial({
            color: 0x8b5cf6, emissive: 0x8b5cf6, emissiveIntensity: 0.4,
            transparent: true, opacity: 0.45
          })
        );
        m.position.set(x * 0.5, y * 0.42, z * 0.5);
        tokens.add(m);
        tokenMeshes.push(m);
      }
    }
  }

  // Multi heads — compact row so all four + labels fit with side margin
  const heads = new THREE.Group();
  heads.position.set(0, 2.85, 0);
  scene.add(heads);
  const headCols = [0x22d3ee, 0x34d399, 0xfbbf24, 0xdb2777];
  const headNames = ['Geometry', 'Detection', 'Occupancy', 'Gaussian'];
  headCols.forEach((c, i) => {
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(1.05, 0.48),
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.4, side: THREE.DoubleSide, transparent: true, opacity: 0.82 })
    );
    p.position.set((i - 1.5) * 1.42, 0, 0);
    heads.add(p);
    const lab = makeTextLabel(headNames[i], { color: '#e2e8f0', scale: 1.1, size: 24, w: 260, h: 56 });
    lab.position.set((i - 1.5) * 1.42, 0.5, 0.08);
    heads.add(lab);
  });

  // Detection boxes from scene tokens
  const detGroup = new THREE.Group();
  scene.add(detGroup);
  [[-1.8, 0, 2.2], [2.0, 0, 1.5], [-0.5, 0, -2.5]].forEach((pos) => {
    const b = makeQueryBox(0x22d3ee, [1.0, 0.7, 1.7]);
    b.position.set(...pos);
    detGroup.add(b);
  });

  const clutterF4d = [ego, frustumGroup, detGroup];
  const steps = [
    { title: '1. 멀티 카메라 입력', body: 'C대 카메라 × T 시점 영상이 들어옵니다. 비동기 입력도 표현할 수 있습니다.', phase: 0 },
    { title: '2. Factorized attention', body: '이미지 내부 이후 view/time attention을 번갈아 적용합니다.', phase: 1, zoom: { pos: [4.4, 3.2, 4.6], target: [0, 1.15, 0], dim: 'clutter' } },
    { title: '3. Scene tokens', body: '장면 전체를 표현하는 scene token 격자가 형성됩니다.', phase: 2, zoom: { pos: [5.0, 4.0, 5.6], target: [0, 1.0, 0], dim: 'clutter' } },
    { title: '4. 멀티 헤드 디코더', body: '공유 토큰에서 Geometry · Detection · Occupancy · Gaussian 헤드가 갈라집니다.', phase: 3, zoom: { pos: [0, 3.8, 6.6], target: [0, 2.0, 0], dim: 'heads' } },
    { title: '5. 3D 검출·점유', body: '검출 박스와 occupancy가 장면 토큰 위에서 동시에 읽힙니다.', phase: 4 },
    { title: '6. Video 추론', body: '윈도우 출력을 pose graph로 정렬하고 객체 트랙을 이어 긴 클립을 처리합니다.', phase: 5 },
  ];

  let phase = 0;
  function applyPhase(p) {
    phase = p;
    camGroup.visible = true;
    attnGroup.visible = p >= 1;
    tokens.visible = p >= 2;
    tokenMeshes.forEach((m) => { m.visible = p >= 2; m.material.opacity = p >= 2 ? 0.55 : 0.2; });
    heads.visible = p >= 3;
    detGroup.visible = p >= 4;
    zoom.clearDetail();
    setStreetHome(camera, orbit, zoom, home);
    const st = steps.find((s) => s.phase === p);
    if (st?.zoom) zoom.setDetail(st.zoom.pos, st.zoom.target, dimGroupsF4d(st));
    renderer.render(scene, camera);
  }

  function dimGroupsF4d(st) {
    if (!st?.zoom?.dim) return [];
    if (st.zoom.dim === 'heads') return [...clutterF4d, camGroup, attnGroup];
    return clutterF4d;
  }
  bindLabUI(root, steps, (i) => applyPhase(steps[i].phase), 'f4d');
  __labDebug['f4d'] = { scene, camera, canvas, orbit, renderer };
  __labZoom['f4d'] = (step, progress) => {
    const st = steps[step];
    if (!st?.zoom) { zoom.scrub(0); return; }
    if (st.zoom.dim) zoom.setDetail(st.zoom.pos, st.zoom.target, dimGroupsF4d(st));
    zoom.scrub(1);
  };

  let running = false;
  new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0.12 }).observe(canvas);
  fit(renderer, camera, canvas);
  setStreetHome(camera, orbit, zoom, home, true);
  applyPhase(0);
  window.addEventListener('resize', () => { fit(renderer, camera, canvas); setStreetHome(camera, orbit, zoom, home, true); });

  (function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;
    const clock = now * 0.001;
    const motion = reduceMotion ? 0 : 1;
    if (motion) {
      tokens.rotation.y = clock * 0.12;
      if (phase >= 1) {
        viewRing.rotation.z = clock * 0.4;
        timeRing.rotation.y = clock * 0.55;
      }
      tokenMeshes.forEach((m, i) => {
        m.material.emissiveIntensity = 0.35 + Math.sin(clock * 2 + i) * 0.2;
      });
      ego.rotation.y = Math.sin(clock * 0.25) * 0.06;
    }
    orbit.controls.update();
    renderer.render(scene, camera);
  })(performance.now());
}


/* boot when visible-ish */
function boot() {
  initStreamPETR();
  initS4Dv1();
  initS4Dv2();
  initS4Dv3();
  initF4D();
}
window.__bootLabs = boot;
// Boot is triggered from main.js after papers are rendered.

