import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── shared helpers ── */
function makeRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0x05070c, 1);
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
    if (dir.y < 0.22) dir.y = 0.38;
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
    if (reduceMotion) {
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
   StreamPETR — FIFO queue + ego align + hybrid
   ════════════════════════════════════════════ */
function initStreamPETR() {
  const canvas = document.getElementById('lab-streampetr');
  if (!canvas) return;
  const root = canvas.closest('.method-scrolly') || canvas.closest('.lab');
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 3.2, 6.2);
  const orbit = attachOrbit(camera, canvas, new THREE.Vector3(0, 0.6, 0));
  scene.add(new THREE.AmbientLight(0x88aaff, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(3, 5, 4); scene.add(key);

  const grid = new THREE.GridHelper(12, 24, 0x1c3a4a, 0x121a28);
  grid.material.transparent = true; grid.material.opacity = 0.5;
  scene.add(grid);

  // Ego
  const ego = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.28, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x1a2438, metalness: 0.6, roughness: 0.35, emissive: 0x0a2030, emissiveIntensity: 0.3 })
  );
  ego.position.set(0, 0.14, 0);
  scene.add(ego);

  // Memory queue slots (FIFO) — left side
  const queueGroup = new THREE.Group();
  queueGroup.position.set(-2.6, 0.9, 0);
  scene.add(queueGroup);
  const slots = [];
  for (let k = 0; k < 5; k++) {
    const col = new THREE.Group();
    col.position.x = k * 0.55;
    for (let n = 0; n < 3; n++) {
      const q = glowSphere(0.12, 0x6ee7ff);
      q.position.y = n * 0.35;
      q.material.opacity = 0.35;
      col.add(q);
      slots.push({ mesh: q, k, n });
    }
    queueGroup.add(col);
  }
  // label plane via sprite-like box
  const queueFrame = wireBox(2.9, 1.3, 0.4, 0x6ee7ff, 0.35);
  queueFrame.position.set(1.1, 0.35, 0);
  queueGroup.add(queueFrame);

  // Current queries
  const currGroup = new THREE.Group();
  currGroup.position.set(0.2, 0.5, 1.6);
  scene.add(currGroup);
  const currQs = [];
  for (let i = 0; i < 6; i++) {
    const q = glowSphere(0.13, 0xf472b6);
    q.position.set((i % 3) * 0.4 - 0.4, Math.floor(i / 3) * 0.4, 0);
    currGroup.add(q);
    currQs.push(q);
  }

  // Propagated (aligned) queries mid
  const propGroup = new THREE.Group();
  propGroup.position.set(-0.6, 0.7, -0.8);
  scene.add(propGroup);
  const propQs = [];
  for (let i = 0; i < 6; i++) {
    const q = glowSphere(0.11, 0xa78bfa);
    q.position.set((i % 3) * 0.35 - 0.35, Math.floor(i / 3) * 0.35, 0);
    q.visible = false;
    propGroup.add(q);
    propQs.push(q);
  }

  // Image feature planes (current)
  const imgGroup = new THREE.Group();
  imgGroup.position.set(2.2, 1.0, 0);
  scene.add(imgGroup);
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x34d399, emissive: 0x14532d, emissiveIntensity: 0.4, side: THREE.DoubleSide, transparent: true, opacity: 0.55 })
    );
    p.position.set(0, (i - 1.5) * 0.55, 0);
    p.rotation.y = -0.4;
    imgGroup.add(p);
  }

  // Attention links
  const linkMat = new THREE.LineBasicMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0.0 });
  const linkGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.5, 1.6),
    new THREE.Vector3(-0.6, 0.7, -0.8),
    new THREE.Vector3(0, 0.5, 1.6),
    new THREE.Vector3(2.8, 1.0, 0)
  ]);
  const links = new THREE.LineSegments(linkGeo, linkMat);
  scene.add(links);

  const steps = [
    { title: '1. 현재 프레임 쿼리', body: '현재 멀티뷰에서 초기 object query(분홍)가 만들어집니다. 아직 메모리와 섞이지 않은 상태입니다.', phase: 0 },
    { title: '2. FIFO Memory Queue', body: '과거 Top-K foreground query가 큐(왼쪽, 청록)에 저장되어 있습니다. 크기는 고정 — 새 값이 들어오면 가장 오래된 것이 빠집니다.', phase: 1 },
    { title: '3. Ego Transform + MLN', body: '큐의 쿼리 중심을 현재 ego 좌표로 명시 변환하고, E·v·Δt로 조건화된 MLN이 암묵적 모션을 보정합니다. 정렬된 쿼리(보라)가 나타납니다.', phase: 2 },
    { title: '4. Hybrid Attention', body: '현재 쿼리를 Q로, 현재 쿼리+전체 큐를 K/V로 두는 hybrid attention으로 시간 정보를 섞습니다.', phase: 3 },
    { title: '5. 이미지 Cross-Attn', body: '이어서 현재 프레임 이미지 feature에 cross-attention하여 검출을 갱신합니다. 과거 이미지는 다시 보지 않습니다.', phase: 4 },
    { title: '6. Top-K → 큐 갱신', body: 'foreground Top-K만 골라 Updated Memory Queue에 push합니다. 다음 프레임에서 같은 루프가 반복됩니다.', phase: 5 }
  ];

  let phase = 0;
  function applyPhase(p) {
    phase = p;
    slots.forEach(s => { s.mesh.material.opacity = p >= 1 ? 0.85 : 0.25; });
    propQs.forEach(q => { q.visible = p >= 2; });
    linkMat.opacity = p >= 3 ? 0.55 : 0;
    imgGroup.visible = p >= 4;
    // emphasize top-k selection
    currQs.forEach((q, i) => {
      q.material.emissiveIntensity = p >= 5 ? (i < 3 ? 1.2 : 0.2) : 0.85;
      q.material.opacity = p >= 5 && i >= 3 ? 0.25 : 0.95;
    });
    if (p >= 5) {
      slots.forEach((s, i) => { if (i < 3) s.mesh.material.color.set(0xf472b6); });
    } else {
      slots.forEach(s => s.mesh.material.color.set(0x6ee7ff));
    }
  }

    bindLabUI(root, steps, (i) => { applyPhase(steps[i].phase); orbit.easeHome(); }, 'streampetr');
  __labDebug['streampetr'] = { scene, camera, canvas, orbit, renderer };

  let running = false;
  const io = new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0.15 });
  io.observe(canvas);
  fit(renderer, camera, canvas);
  orbit.fitContent(scene);
  window.addEventListener('resize', () => {
    fit(renderer, camera, canvas);
    orbit.fitContent(scene);
  });
  let t0 = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;
    const t = (now - t0) / 1000;
    if (!reduceMotion) {
      ego.rotation.y = Math.sin(t * 0.4) * 0.15;
      queueGroup.position.y = 0.9 + Math.sin(t * 0.8) * 0.03;
      if (phase >= 2) propGroup.rotation.y = Math.sin(t) * 0.1;
    }
    orbit.controls.update();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}

/* ════════════════════════════════════════════
   Sparse4D v1 — keypoints across T frames
   ════════════════════════════════════════════ */
function initS4Dv1() {
  const canvas = document.getElementById('lab-s4dv1');
  if (!canvas) return;
  const root = canvas.closest('.method-scrolly') || canvas.closest('.lab');
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(4.5, 3.5, 5.5);
  const orbit = attachOrbit(camera, canvas, new THREE.Vector3(0, 0.8, 0));
  scene.add(new THREE.AmbientLight(0x88aaff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 0.85); key.position.set(2, 4, 3); scene.add(key);
  scene.add(new THREE.GridHelper(10, 20, 0x1c3a4a, 0x121a28));

  // T feature frames as vertical stacks of planes
  const T = 4;
  const frames = [];
  for (let t = 0; t < T; t++) {
    const g = new THREE.Group();
    g.position.set(-3 + t * 1.5, 1.2, -1.2);
    for (let c = 0; c < 3; c++) {
      const p = new THREE.Mesh(
        new THREE.PlaneGeometry(1.0, 0.65),
        new THREE.MeshStandardMaterial({
          color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 0.25,
          transparent: true, opacity: 0.35 + t * 0.1, side: THREE.DoubleSide
        })
      );
      p.position.y = (c - 1) * 0.75;
      g.add(p);
    }
    scene.add(g);
    frames.push(g);
  }

  // Anchor box
  const anchor = wireBox(1.2, 0.8, 2.0, 0xfbbf24, 0.9);
  anchor.position.set(1.5, 0.5, 1.2);
  scene.add(anchor);

  // Keypoints
  const kps = [];
  const kpGroup = new THREE.Group();
  scene.add(kpGroup);
  for (let i = 0; i < 8; i++) {
    const s = glowSphere(0.08, 0xf472b6);
    const a = (i / 8) * Math.PI * 2;
    s.position.set(1.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a * 2) * 0.25, 1.2 + Math.sin(a) * 0.8);
    kpGroup.add(s);
    kps.push(s);
  }

  // Projection rays to each past frame
  const rayMat = new THREE.LineBasicMaterial({ color: 0xf472b6, transparent: true, opacity: 0 });
  const rayPts = [];
  kps.forEach((kp, i) => {
    frames.forEach((f, ti) => {
      if (ti === T - 1 && i > 3) return;
      rayPts.push(kp.position.clone(), new THREE.Vector3(f.position.x, 1.2, f.position.z));
    });
  });
  const rays = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(rayPts), rayMat);
  scene.add(rays);

  const steps = [
    { title: '1. 이미지 feature 큐', body: '현재를 포함한 T개 시점의 멀티뷰 feature가 큐에 쌓입니다. Instance 상태가 아니라 이미지를 기억합니다.', phase: 0 },
    { title: '2. 3D 앵커', body: '각 후보 instance는 3D anchor box로 표현됩니다. 아직 과거 프레임을 보지 않은 상태입니다.', phase: 1 },
    { title: '3. 4D Keypoints', body: '앵커로부터 고정·학습 keypoints를 생성합니다. 이 점들이 시공간 샘플링의 발판이 됩니다.', phase: 2 },
    { title: '4. 과거 프레임에 투영', body: 'keypoints를 각 과거 timestamp·카메라 평면에 투영합니다. 각 timestamp·카메라 평면에 투영·샘플링합니다.', phase: 3 },
    { title: '5. Deformable sampling', body: '투영 위치 주변에서 multi-scale feature를 deformable sampling하고 hierarchy fusion합니다.', phase: 4 },
    { title: '6. 앵커 정제', body: '모은 feature로 앵커를  refinement합니다. 다음 프레임에서도 instance를 넘기지 않고, feature 큐만 갱신합니다.', phase: 5 }
  ];

  function applyPhase(p) {
    frames.forEach((f, ti) => {
      f.children.forEach(ch => {
        ch.material.opacity = p >= 0 ? (0.3 + (ti / T) * 0.4) : 0.15;
        ch.material.emissiveIntensity = p >= 4 && ti < T - 1 ? 0.7 : 0.25;
      });
    });
    anchor.visible = p >= 1;
    kpGroup.visible = p >= 2;
    rayMat.opacity = p >= 3 ? 0.45 : 0;
    if (p >= 5) anchor.scale.setScalar(1.08);
    else anchor.scale.setScalar(1);
  }

    bindLabUI(root, steps, (i) => { applyPhase(steps[i].phase); orbit.easeHome(); }, 's4dv1');
  __labDebug['s4dv1'] = { scene, camera, canvas, orbit, renderer };
  let running = false;
  new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0.15 }).observe(canvas);
  fit(renderer, camera, canvas);
  orbit.fitContent(scene);
  window.addEventListener('resize', () => {
    fit(renderer, camera, canvas);
    orbit.fitContent(scene);
  });
  let t0 = performance.now();
  (function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;
    const t = (now - t0) / 1000;
    if (!reduceMotion) {
      kpGroup.rotation.y = Math.sin(t * 0.5) * 0.05;
      anchor.rotation.y = Math.sin(t * 0.3) * 0.08;
    }
    orbit.controls.update();
    renderer.render(scene, camera);
  })(performance.now());
}

/* ════════════════════════════════════════════
   Sparse4D v2 — recurrent instance carry
   ════════════════════════════════════════════ */
function initS4Dv2() {
  const canvas = document.getElementById('lab-s4dv2');
  if (!canvas) return;
  const root = canvas.closest('.method-scrolly') || canvas.closest('.lab');
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0.5, 3.4, 6.5);
  const orbit = attachOrbit(camera, canvas, new THREE.Vector3(0, 0.6, 0));
  scene.add(new THREE.AmbientLight(0x88aaff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(3, 5, 2); scene.add(key);
  scene.add(new THREE.GridHelper(12, 24, 0x1c3a4a, 0x121a28));

  // Past instances (t-1)
  const past = new THREE.Group();
  past.position.set(-2.5, 0.5, 0);
  scene.add(past);
  const pastBoxes = [];
  const colors = [0x6ee7ff, 0xa78bfa, 0x34d399, 0xfbbf24];
  for (let i = 0; i < 4; i++) {
    const b = wireBox(0.9, 0.6, 1.5, colors[i], 0.7);
    b.position.set((i % 2) * 1.2, 0, Math.floor(i / 2) * 1.6 - 0.8);
    past.add(b);
    const feat = glowSphere(0.12, colors[i]);
    feat.position.copy(b.position); feat.position.y = 0.55;
    past.add(feat);
    pastBoxes.push({ box: b, feat });
  }

  // Current image only
  const imgs = new THREE.Group();
  imgs.position.set(2.8, 1.2, 0);
  scene.add(imgs);
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x34d399, emissive: 0x14532d, emissiveIntensity: 0.35, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })
    );
    p.position.y = (i - 1.5) * 0.6;
    p.rotation.y = -0.35;
    imgs.add(p);
  }

  // Propagated anchors at t
  const curr = new THREE.Group();
  curr.position.set(0.3, 0.5, 0);
  scene.add(curr);
  const currBoxes = [];
  for (let i = 0; i < 4; i++) {
    const b = wireBox(0.9, 0.6, 1.5, colors[i], 0.95);
    b.position.set((i % 2) * 1.2, 0, Math.floor(i / 2) * 1.6 - 0.8);
    b.visible = false;
    curr.add(b);
    const feat = glowSphere(0.12, colors[i]);
    feat.position.copy(b.position); feat.position.y = 0.55;
    feat.visible = false;
    curr.add(feat);
    currBoxes.push({ box: b, feat });
  }

  // New object (single-frame path)
  const newborn = wireBox(0.8, 0.55, 1.3, 0xf472b6, 0.9);
  newborn.position.set(1.8, 0.4, -2.2);
  newborn.visible = false;
  scene.add(newborn);

  // Motion arrows
  const arrowMat = new THREE.LineBasicMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0 });
  const arrows = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-2.5, 0.8, 0), new THREE.Vector3(0.3, 0.8, 0)
    ]),
    arrowMat
  );
  scene.add(arrows);

  const steps = [
    { title: '1. 이전 instance', body: 't−1의 anchor와 instance feature Fₜ₋₁이 상태처럼 남습니다. 과거 이미지 feature 큐는 더 이상 없습니다.', phase: 0 },
    { title: '2. Ego + v·Δt 투영', body: '앵커를 ego motion과 속도 v·Δt로 현재 시각 좌표계에 투영합니다.', phase: 1 },
    { title: '3. 현재 이미지만 샘플', body: '투영된 앵커에서 현재 프레임 이미지 feature만 deformable sampling합니다.', phase: 2 },
    { title: '4. Recurrent 갱신', body: 'Fₜ = decode(Fₜ₋₁, 현재 샘플). instance feature가 재귀적으로 이어집니다.', phase: 3 },
    { title: '5. Single-frame 경로', body: '새로 나타난 객체는 single-frame layer에서 초기화됩니다. 전파된 객체는 multi-frame layer가 담당합니다.', phase: 4 },
    { title: '6. 부가 모듈', body: 'EDA로 aggregation을 가볍게 하고, camera parameter encoding·dense depth supervision으로 학습을 보강합니다.', phase: 5 }
  ];

  function applyPhase(p) {
    arrowMat.opacity = p >= 1 ? 0.7 : 0;
    currBoxes.forEach(o => {
      o.box.visible = p >= 1;
      o.feat.visible = p >= 3;
    });
    imgs.children.forEach(c => { c.material.emissiveIntensity = p >= 2 ? 0.7 : 0.25; });
    newborn.visible = p >= 4;
    if (p >= 1) {
      // show motion shift
      curr.position.x = 0.3;
    }
  }

    bindLabUI(root, steps, (i) => { applyPhase(steps[i].phase); orbit.easeHome(); }, 's4dv2');
  __labDebug['s4dv2'] = { scene, camera, canvas, orbit, renderer };
  let running = false;
  new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0.15 }).observe(canvas);
  fit(renderer, camera, canvas);
  orbit.fitContent(scene);
  window.addEventListener('resize', () => {
    fit(renderer, camera, canvas);
    orbit.fitContent(scene);
  });
  let t0 = performance.now();
  (function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;
    const t = (now - t0) / 1000;
    if (!reduceMotion) {
      past.position.x = -2.5 + Math.sin(t * 0.5) * 0.05;
      curr.position.x = 0.3 + Math.sin(t * 0.5) * 0.05;
    }
    orbit.controls.update();
    renderer.render(scene, camera);
  })(performance.now());
}

/* ════════════════════════════════════════════
   Sparse4D v3 — denoising / QE / decoupled
   ════════════════════════════════════════════ */
function initS4Dv3() {
  const canvas = document.getElementById('lab-s4dv3');
  if (!canvas) return;
  const root = canvas.closest('.method-scrolly') || canvas.closest('.lab');
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0.2, 2.8, 6.2);
  const orbit = attachOrbit(camera, canvas, new THREE.Vector3(0, 0.8, 0));
  scene.add(new THREE.AmbientLight(0x88aaff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(3, 4, 3); scene.add(key);
  scene.add(new THREE.GridHelper(10, 20, 0x1c3a4a, 0x121a28));

  // GT box vs noisy boxes (denoising)
  const gt = wireBox(1.2, 0.7, 2.0, 0x34d399, 1);
  gt.position.set(-1.5, 0.45, 0);
  scene.add(gt);
  const noisy = [];
  for (let i = 0; i < 3; i++) {
    const b = wireBox(1.2, 0.7, 2.0, 0xfbbf24, 0.7);
    b.position.set(-1.5 + (Math.random() - 0.5) * 0.8, 0.45, (Math.random() - 0.5) * 0.8);
    b.rotation.y = (Math.random() - 0.5) * 0.5;
    b.visible = false;
    scene.add(b);
    noisy.push(b);
  }

  // Quality heads
  const qeGroup = new THREE.Group();
  qeGroup.position.set(1.6, 1.0, 0);
  qeGroup.visible = false;
  scene.add(qeGroup);
  const center = glowSphere(0.2, 0x6ee7ff);
  qeGroup.add(center);
  const yaw = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 1.2, 0xa78bfa, 0.25, 0.18);
  qeGroup.add(yaw);
  const qeBox = wireBox(1.2, 0.7, 2.0, 0x6ee7ff, 0.8);
  qeBox.position.set(0, -0.55, 0);
  qeGroup.add(qeBox);

  // Decoupled attention: two bars (feature | anchor) vs summed
  const dec = new THREE.Group();
  dec.position.set(0, 1.8, 1.8);
  dec.visible = false;
  scene.add(dec);
  const featBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 1.0, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x6ee7ff, emissive: 0x6ee7ff, emissiveIntensity: 0.5 })
  );
  featBar.position.x = -0.4;
  const ancBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 1.0, 0.35),
    new THREE.MeshStandardMaterial({ color: 0xa78bfa, emissive: 0xa78bfa, emissiveIntensity: 0.5 })
  );
  ancBar.position.x = 0.4;
  const concatFrame = wireBox(1.4, 1.3, 0.5, 0xffffff, 0.4);
  dec.add(featBar, ancBar, concatFrame);

  // Inference = v2 badge (recurrent path mini)
  const infer = new THREE.Group();
  infer.position.set(0, 0.5, -2.2);
  scene.add(infer);
  for (let i = 0; i < 3; i++) {
    const b = wireBox(0.7, 0.45, 1.1, 0x94a3b8, 0.6);
    b.position.x = (i - 1) * 1.1;
    infer.add(b);
  }

  const steps = [
    { title: '1. v2와 같은 추론', body: '배포·추론 그래프는 Sparse4D v2의 recurrent pipeline을 그대로 씁니다. 아래 회색 앵커가 그 경로입니다.', phase: 0 },
    { title: '2. Temporal Instance Denoising', body: '학습 때 GT instance에 noise를 주고(노란 박스) 복원하도록 학습합니다. DN-DETR 계열이며 추론 그래프에는 없습니다.', phase: 1 },
    { title: '3. 노이즈 → GT 복원', body: '모델이 noisy instance를 초록 GT에 가깝게 되돌리며 temporal association을 더 단단히 배웁니다.', phase: 2 },
    { title: '4. Quality Estimation', body: 'centerness·yawness 헤드가 로컬화 품질을 예측합니다. 점수 정렬·트래킹에 쓰입니다.', phase: 3 },
    { title: '5. Decoupled Attention', body: 'instance feature(청록)와 anchor embedding(보라)을 더하지 않고 concat한 뒤 attention합니다. 위치 신호가 특징에 묻히지 않습니다.', phase: 4 },
    { title: '6. 정리', body: '온디바이스에서는 추론= v2 + (QE 헤드·concat 차원). Denoising은 학습 전용입니다.', phase: 5 }
  ];

  function applyPhase(p) {
    noisy.forEach(b => { b.visible = p >= 1 && p < 3; });
    if (p >= 2) {
      noisy.forEach((b, i) => {
        b.position.lerp(new THREE.Vector3(-1.5, 0.45, 0), 0.4);
        b.rotation.y *= 0.5;
      });
    }
    if (p >= 3) { noisy.forEach(b => b.visible = false); }
    qeGroup.visible = p >= 3;
    dec.visible = p >= 4;
    infer.children.forEach(c => { c.material.opacity = p === 0 ? 0.85 : 0.35; });
  }

    bindLabUI(root, steps, (i) => { applyPhase(steps[i].phase); orbit.easeHome(); }, 's4dv3');
  __labDebug['s4dv3'] = { scene, camera, canvas, orbit, renderer };
  let running = false;
  new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0.15 }).observe(canvas);
  fit(renderer, camera, canvas);
  orbit.fitContent(scene);
  window.addEventListener('resize', () => {
    fit(renderer, camera, canvas);
    orbit.fitContent(scene);
  });
  let t0 = performance.now();
  (function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;
    const t = (now - t0) / 1000;
    if (!reduceMotion) {
      qeGroup.rotation.y = t * 0.4;
      dec.rotation.y = Math.sin(t * 0.6) * 0.15;
    }
    orbit.controls.update();
    renderer.render(scene, camera);
  })(performance.now());
}


/* ════════════════════════════════════════════
   Foundation4D — scene tokens + factorized attn
   ════════════════════════════════════════════ */
function initF4D() {
  const canvas = document.getElementById('lab-f4d');
  if (!canvas) return;
  const root = canvas.closest('.method-scrolly') || canvas.closest('.lab');
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
  camera.position.set(0.4, 4.2, 8.5);
  const orbit = attachOrbit(camera, canvas, new THREE.Vector3(0, 1.0, 0));
  scene.add(new THREE.AmbientLight(0x88aaff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 0.95); key.position.set(4, 6, 3); scene.add(key);
  scene.add(new THREE.GridHelper(16, 32, 0x1c3a4a, 0x121a28));

  const egoMat = new THREE.MeshStandardMaterial({ color: 0x1a2438, metalness: 0.55, roughness: 0.35, emissive: 0x0a2030, emissiveIntensity: 0.35 });
  const ego = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 2.2), egoMat);
  ego.position.y = 0.2;
  scene.add(ego);

  const frust = new THREE.Group();
  scene.add(frust);
  const yaws = [-1.2, -0.55, 0, 0.55, 1.2, Math.PI];
  yaws.forEach((yaw, i) => {
    const g = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: i === 5 ? 0xa78bfa : 0x6ee7ff, transparent: true, opacity: 0.55 });
    const near = 0.2, far = 2.2, nw = 0.2, fw = 1.0, nh = 0.12, fh = 0.55;
    const pts = [
      [-nw,-nh,near],[nw,-nh,near],[nw,nh,near],[-nw,nh,near],[-nw,-nh,near],
      [-nw,-nh,near],[-fw,-fh,far],[nw,-nh,near],[fw,-fh,far],[nw,nh,near],[fw,fh,far],[-nw,nh,near],[-fw,fh,far],
      [-fw,-fh,far],[fw,-fh,far],[fw,fh,far],[-fw,fh,far],[-fw,-fh,far]
    ].map(p => new THREE.Vector3(...p));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    g.rotation.y = yaw;
    g.position.y = 0.55;
    frust.add(g);
  });

  // Scene token lattice
  const tokens = new THREE.Group();
  tokens.position.set(0, 0.9, 0);
  scene.add(tokens);
  const tokenMeshes = [];
  const tMat = new THREE.MeshStandardMaterial({ color: 0xa78bfa, emissive: 0xa78bfa, emissiveIntensity: 0.4, transparent: true, opacity: 0.35 });
  for (let x = -3; x <= 3; x++) {
    for (let z = -3; z <= 3; z++) {
      for (let y = 0; y <= 2; y++) {
        if ((x + z + y) % 2) continue;
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), tMat.clone());
        m.position.set(x * 0.55, y * 0.45, z * 0.55);
        m.visible = false;
        tokens.add(m);
        tokenMeshes.push(m);
      }
    }
  }

  // Heads as colored panels
  const heads = new THREE.Group();
  heads.position.set(0, 2.6, 0);
  heads.visible = false;
  scene.add(heads);
  const headCols = [0x6ee7ff, 0x34d399, 0xfbbf24, 0xf472b6];
  const headLabels = ['Geo', 'Det', 'Occ', 'Gauss'];
  headCols.forEach((c, i) => {
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.55),
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
    );
    p.position.x = (i - 1.5) * 1.3;
    heads.add(p);
  });

  // Detection boxes
  const detGroup = new THREE.Group();
  detGroup.visible = false;
  scene.add(detGroup);
  [[-2, 0.4, 2], [2.2, 0.4, 1.2], [0.5, 0.45, -2.5]].forEach((pos, i) => {
    const b = wireBox(1.0, 0.7, 1.8, 0x6ee7ff, 0.85);
    b.position.set(...pos);
    detGroup.add(b);
  });

  const steps = [
    { title: '1. 멀티 카메라 입력', body: 'C대 카메라 × T 시점 영상이 들어옵니다. 각 이미지는 촬영 시각을 가져 비동기 입력도 표현할 수 있습니다.', phase: 0 },
    { title: '2. Factorized attention', body: '이미지 내부 attention 후, 같은 시점의 카메라 간(view) 또는 같은 카메라의 시간축(time) attention을 번갈아 적용합니다.', phase: 1 },
    { title: '3. Scene tokens', body: '장면 전체를 표현하는 scene token 격자가 형성됩니다. Sparse object query가 아니라 dense-ish 장면 표현입니다.', phase: 2 },
    { title: '4. 멀티 헤드 디코더', body: '공유 토큰에서 Geometry · Detection · Occupancy · Gaussian 헤드가 갈라집니다.', phase: 3 },
    { title: '5. 3D 검출·점유', body: '검출 박스와 occupancy가 장면 토큰 위에서 동시에 읽힙니다.', phase: 4 },
    { title: '6. Video 추론', body: '윈도우 출력을 pose graph로 정렬하고 객체 트랙을 이어 긴 주행 클립을 처리합니다.', phase: 5 },
  ];

  function applyPhase(p) {
    frust.visible = true;
    frust.children.forEach(ch => {
      ch.children[0].material.opacity = p >= 1 ? 0.85 : 0.4;
    });
    tokenMeshes.forEach((m, i) => {
      m.visible = p >= 2;
      m.material.opacity = p >= 2 ? 0.25 + (i % 5) * 0.08 : 0;
      m.material.emissiveIntensity = p >= 2 ? 0.55 : 0.2;
    });
    heads.visible = p >= 3;
    detGroup.visible = p >= 4;
    if (p >= 5) {
      tokens.rotation.y = 0.25;
    }
  }

    bindLabUI(root, steps, (i) => { applyPhase(steps[i].phase); orbit.easeHome(); }, 'f4d');
  __labDebug['f4d'] = { scene, camera, canvas, orbit, renderer };
  let running = false;
  new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0.15 }).observe(canvas);
  fit(renderer, camera, canvas);
  orbit.fitContent(scene);
  window.addEventListener('resize', () => {
    fit(renderer, camera, canvas);
    orbit.fitContent(scene);
  });
  let t0 = performance.now();
  (function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;
    const t = (now - t0) / 1000;
    if (!reduceMotion) {
      ego.rotation.y = Math.sin(t * 0.35) * 0.1;
      frust.rotation.y = ego.rotation.y;
      tokens.rotation.y = t * 0.08;
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

