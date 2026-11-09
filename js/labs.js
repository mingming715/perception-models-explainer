import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── shared helpers ── */
function makeRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0xf4f5f2, 1);
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
   StreamPETR — street scene + query boxes + queue
   (light theme; scroll-synced steps)
   ════════════════════════════════════════════ */
function initStreamPETR() {
  const canvas = document.getElementById('lab-streampetr');
  if (!canvas) return;
  const root = canvas.closest('.method-scrolly') || canvas.closest('.lab');
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf4f5f2, 14, 32);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
  camera.position.set(5.5, 5.0, 8.5);
  const orbit = attachOrbit(camera, canvas, new THREE.Vector3(0, 0.7, 0.4));

  scene.add(new THREE.AmbientLight(0xffffff, 0.78));
  const key = new THREE.DirectionalLight(0xffffff, 0.95);
  key.position.set(5, 8, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xc4b5fd, 0.35);
  fill.position.set(-4, 3, -2); scene.add(fill);

  // ── Ground + road lanes ──
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 28),
    new THREE.MeshStandardMaterial({ color: 0xe6ebe3, roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.001;
  ground.userData.skipFit = true;
  scene.add(ground);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(6.2, 26),
    new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.92, metalness: 0.05 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.002;
  road.userData.skipFit = true;
  scene.add(road);

  const laneMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
  for (let i = -10; i <= 10; i++) {
    if (i === 0) continue;
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.9), laneMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.01, i * 1.4);
    dash.userData.skipFit = true;
    scene.add(dash);
  }
  // curb lines
  [-3.05, 3.05].forEach((x) => {
    const curb = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 26), new THREE.MeshBasicMaterial({ color: 0xf1f5f9 }));
    curb.rotation.x = -Math.PI / 2;
    curb.position.set(x, 0.01, 0);
    curb.userData.skipFit = true;
    scene.add(curb);
  });

  // soft distant grid (subtle)
  const grid = new THREE.GridHelper(24, 24, 0xb8c0b8, 0xd5dbd4);
  grid.position.y = 0.003;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);

  // ── Low-poly vehicle builder ──
  function makeCar(color, len = 1.9, wid = 0.9, h = 0.55) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(wid, h * 0.55, len),
      new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.4 })
    );
    body.position.y = h * 0.32;
    g.add(body);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(wid * 0.85, h * 0.42, len * 0.45),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.3, roughness: 0.35, transparent: true, opacity: 0.85 })
    );
    cabin.position.set(0, h * 0.72, -len * 0.05);
    g.add(cabin);
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.7
    });
    [-wid * 0.32, wid * 0.32].forEach((x) => {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.05), lampMat);
      lamp.position.set(x, h * 0.35, len * 0.5);
      g.add(lamp);
    });
    return g;
  }

  const ego = makeCar(0x0e7490, 2.0, 0.95, 0.58);
  ego.position.set(0, 0, 0);
  scene.add(ego);

  // Surrounding traffic (move along road)
  const traffic = [
    { car: makeCar(0xdc2626, 1.8, 0.88, 0.52), x: -2.0, z: 5.5, speed: 0.55, phase: 0.2 },
    { car: makeCar(0x1d4ed8, 2.1, 0.95, 0.6), x: 2.1, z: -4.2, speed: 0.42, phase: 1.1 },
    { car: makeCar(0x15803d, 1.7, 0.85, 0.5), x: -1.9, z: -7.5, speed: 0.48, phase: 2.4 },
    { car: makeCar(0x7c3aed, 1.85, 0.9, 0.55), x: 2.0, z: 8.0, speed: 0.38, phase: 0.7 },
  ];
  traffic.forEach((tr) => {
    tr.car.position.set(tr.x, 0, tr.z);
    tr.car.traverse((o) => { o.userData.skipFit = true; });
    scene.add(tr.car);
  });

  // ── 6 camera frustums (translucent fans) ──
  function makeFrustumFan(yaw, color) {
    const g = new THREE.Group();
    const near = 0.35, far = 3.4, nw = 0.22, fw = 1.55, nh = 0.14, fh = 0.85;
    const corners = [
      new THREE.Vector3(-nw, -nh, near), new THREE.Vector3(nw, -nh, near),
      new THREE.Vector3(nw, nh, near), new THREE.Vector3(-nw, nh, near),
      new THREE.Vector3(-fw, -fh, far), new THREE.Vector3(fw, -fh, far),
      new THREE.Vector3(fw, fh, far), new THREE.Vector3(-fw, fh, far),
    ];
    const edgeIdx = [
      [0,1],[1,2],[2,3],[3,0],
      [4,5],[5,6],[6,7],[7,4],
      [0,4],[1,5],[2,6],[3,7],
    ];
    const pts = [];
    edgeIdx.forEach(([a, b]) => { pts.push(corners[a], corners[b]); });
    const line = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 })
    );
    g.add(line);
    // translucent fan faces (side + far)
    const fanMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false
    });
    const faces = [
      [0,1,5,4], [1,2,6,5], [2,3,7,6], [3,0,4,7], [4,5,6,7],
    ];
    faces.forEach((idx) => {
      const geo = new THREE.BufferGeometry();
      const v = idx.flatMap((i) => [corners[i].x, corners[i].y, corners[i].z]);
      // two tris
      const pos = new Float32Array([
        v[0],v[1],v[2], v[3],v[4],v[5], v[6],v[7],v[8],
        v[0],v[1],v[2], v[6],v[7],v[8], v[9],v[10],v[11],
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, fanMat));
    });
    g.rotation.y = yaw;
    g.position.y = 0.55;
    return g;
  }

  const frustumGroup = new THREE.Group();
  const yaws = [-1.2, -0.6, 0, 0.6, 1.2, Math.PI];
  const frustCols = [0x0891b2, 0x0891b2, 0x0891b2, 0x0891b2, 0x0891b2, 0x7c3aed];
  yaws.forEach((yaw, i) => frustumGroup.add(makeFrustumFan(yaw, frustCols[i])));
  scene.add(frustumGroup);

  // Static fit anchors (traffic excluded from fit because it wraps far)
  const fitAnchors = new THREE.Group();
  [
    [0, 0.6, 0], [3.6, 1.4, 3.6], [-3.6, 1.4, 3.6], [3.6, 1.4, -3.6], [-3.6, 1.4, -3.6],
    [-6.8, 1.2, 0], [-6.8, 1.2, 2.2], [-6.8, 1.2, -2.2], [0, 2.4, 0],
    [2.8, 1.6, 0], [-2.8, 1.6, 0],
  ].forEach(([x,y,z]) => {
    const a = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.45, 0.45),
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
    // faux road + car silhouette
    ctx.fillStyle = 'rgba(30,41,59,.35)';
    ctx.fillRect(0, 48, 128, 32);
    ctx.fillStyle = 'rgba(248,250,252,.55)';
    ctx.fillRect(40, 30, 48, 22);
    ctx.fillStyle = 'rgba(15,23,42,.25)';
    for (let i = 0; i < 8; i++) ctx.fillRect(8 + i * 15, 10, 6, 6);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const imgPlanes = [];
  yaws.slice(0, 6).forEach((yaw, i) => {
    const tex = makePlaceholderTex(190 + i * 18);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.95),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.92, side: THREE.DoubleSide })
    );
    const f = farPos(yaw, 3.15);
    plane.position.copy(f);
    plane.position.y = 0.85;
    plane.lookAt(0, 0.85, 0);
    imgGroup.add(plane);
    imgPlanes.push(plane);
  });
  function farPos(yaw, dist) {
    return new THREE.Vector3(Math.sin(yaw) * dist, 0, Math.cos(yaw) * dist);
  }

  // ── Query box attached to a vehicle (wire box + glowing ref point) ──
  function makeQueryBox(col, size = [0.95, 0.7, 1.7]) {
    const g = new THREE.Group();
    const [w, h, d] = size;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
      new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.95 })
    );
    edges.position.y = h * 0.5;
    g.add(edges);
    const fill = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, depthWrite: false })
    );
    fill.position.y = h * 0.5;
    g.add(fill);
    const ref = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 12),
      new THREE.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: 1.1,
        transparent: true, opacity: 0.95
      })
    );
    ref.position.y = h * 0.5;
    g.add(ref);
    g.userData = { edges, fill, ref, col };
    return g;
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
  queueRoot.position.set(-3.2, 0.4, 0);
  queueRoot.visible = false;
  scene.add(queueRoot);
  const queueLayers = [];
  const qCols = [0x0891b2, 0x0e7490, 0x155e75, 0x164e63];
  for (let L = 0; L < QUEUE_LAYERS; L++) {
    const layer = new THREE.Group();
    layer.position.x = -L * 1.05;
    const boxes = [];
    for (let k = 0; k < 3; k++) {
      const b = makeQueryBox(qCols[L], [0.7, 0.5, 1.2]);
      b.position.set(0, 0, (k - 1) * 1.5);
      b.scale.setScalar(1 - L * 0.06);
      const op = 0.95 - L * 0.18;
      b.userData.edges.material.opacity = op;
      b.userData.fill.material.opacity = 0.08;
      b.userData.ref.material.opacity = op;
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
      new THREE.Vector3(0.5, 0.15, 0), new THREE.Vector3(-QUEUE_LAYERS * 1.05 - 0.3, 0.15, 0)
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
    const b = makeQueryBox(0x7c3aed, [0.75, 0.55, 1.3]);
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
            color: weight > 0.55 ? 0x0891b2 : 0x7c3aed,
            transparent: true,
            opacity: 0.25 + weight * 0.55,
            dashSize: 0.18,
            gapSize: 0.12,
            linewidth: 1,
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
      color: 0x059669, transparent: true, opacity: 0.65
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

  const steps = [
    { title: '1. 현재 프레임 쿼리', body: '주변 차량에 붙은 3D query box(분홍)와 기준점이 현재 프레임에서 나타납니다. 아직 메모리와 섞이지 않습니다.', phase: 0 },
    { title: '2. FIFO Memory Queue', body: '과거 Top-K foreground query가 시간축을 따라 층층이 쌓입니다. 오래된 레이어일수록 흐려집니다.', phase: 1 },
    { title: '3. Ego Transform + MLN', body: '자차가 전진하며 과거 박스가 현재 좌표로 미끄러져 옵니다. 주황 화살표는 v·Δt 보정(MLN)을 나타냅니다.', phase: 2 },
    { title: '4. Hybrid Attention', body: '현재 쿼리(Q)와 메모리 큐(K/V) 사이 점선이 흐릅니다. 굵고 밝은 선일수록 attention weight가 큽니다.', phase: 3 },
    { title: '5. 이미지 Cross-Attn', body: '쿼리에서 현재 카메라 frustum·이미지 평면으로 광선이 닿습니다. 과거 이미지는 다시 보지 않습니다.', phase: 4 },
    { title: '6. Top-K → 큐 갱신', body: '점수가 높은 박스가 큐 맨 앞으로 올라가고, 가장 오래된 레이어는 빠져나갑니다.', phase: 5 },
  ];

  let phase = 0;
  let phaseT0 = performance.now();
  let egoBaseZ = 0;

  function applyPhase(p) {
    phase = p;
    phaseT0 = performance.now();
    currGroup.visible = p >= 0;
    queueRoot.visible = p >= 1;
    alignedGroup.visible = p >= 2 && p < 5;
    corrGroup.visible = p === 2;
    attnGroup.visible = p === 3;
    imgGroup.visible = p >= 4;
    rayGroup.visible = p === 4;

    // reset queue layer opacities / positions
    queueLayers.forEach((layer, L) => {
      layer.group.visible = true;
      layer.group.position.x = -L * 1.05;
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
    // sync sticky caption if present
    const cap = root?.querySelector?.('[data-role="sticky-caption"]');
    const stepMeta = steps.find((s) => s.phase === p) || steps[p];
    if (cap && stepMeta) cap.textContent = stepMeta.title.replace(/^\d+\.\s*/, '');
    orbit.controls.update();
    renderer.render(scene, camera);
  }

  bindLabUI(root, steps, (i) => { applyPhase(steps[i].phase); orbit.easeHome(); }, 'streampetr');
  __labDebug['streampetr'] = { scene, camera, canvas, orbit, renderer };

  let running = false;
  const io = new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0.12 });
  io.observe(canvas);
  fit(renderer, camera, canvas);
  // initial visibility for fit bounds
  currGroup.visible = true;
  queueRoot.visible = true;
  imgGroup.visible = true;
  orbit.fitContent(scene, 1.22);
  currGroup.visible = false;
  queueRoot.visible = false;
  imgGroup.visible = false;
  applyPhase(0);

  window.addEventListener('resize', () => {
    fit(renderer, camera, canvas);
    orbit.fitContent(scene, 1.22);
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

    // traffic motion
    traffic.forEach((tr) => {
      if (motion) {
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
        if (motion) r.line.material.opacity = 0.45 + Math.sin(clock * 4) * 0.2;
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
      last.group.position.x = -((QUEUE_LAYERS - 1) * 1.05) - u * 1.8;
      last.boxes.forEach((b) => {
        b.userData.edges.material.opacity = 0.95 - 0.18 * (QUEUE_LAYERS - 1) - u * 0.7;
        b.userData.ref.material.opacity = b.userData.edges.material.opacity;
      });
      // shift middle layers slightly toward front
      for (let L = 1; L < QUEUE_LAYERS - 1; L++) {
        queueLayers[L].group.position.x = -L * 1.05 + u * 0.3;
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
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 0.85); key.position.set(2, 4, 3); scene.add(key);
  scene.add(new THREE.GridHelper(10, 20, 0xb8c0b8, 0xd5dbd4));

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
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(3, 5, 2); scene.add(key);
  scene.add(new THREE.GridHelper(12, 24, 0xb8c0b8, 0xd5dbd4));

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
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(3, 4, 3); scene.add(key);
  scene.add(new THREE.GridHelper(10, 20, 0xb8c0b8, 0xd5dbd4));

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
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 0.95); key.position.set(4, 6, 3); scene.add(key);
  scene.add(new THREE.GridHelper(16, 32, 0xb8c0b8, 0xd5dbd4));

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

