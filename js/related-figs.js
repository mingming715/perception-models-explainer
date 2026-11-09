/** Inline SVG figures for the "기존 연구와 차별점" section. Our own drawings of each paper's
 *  related-work argument — not copies of paper figures. Styling lives in css/main.css (.rf-*). */

const PINK = '#db2777', CYAN = '#0891b2', VIOLET = '#7c3aed', AMBER = '#d97706', GREEN = '#059669', GRAY = '#94a3b8';

const svg = (w, h, body, label) =>
  `<svg class="rf" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">${body}</svg>`;

/** Panel card with title/subtitle on top and a 2-line verdict at the bottom. */
function panel(x, w, h, title, sub, verdict, ok, us = false) {
  const [l1, l2] = verdict;
  return `<rect class="rf-panel${us ? ' us' : ''}" x="${x}" y="0" width="${w}" height="${h}" rx="14"/>
    <text class="rf-title" x="${x + 16}" y="28">${title}</text>
    <text class="rf-sub" x="${x + 16}" y="47">${sub}</text>
    <line class="rf-rule" x1="${x + 16}" x2="${x + w - 16}" y1="${h - 62}" y2="${h - 62}"/>
    <text class="rf-cap" x="${x + 16}" y="${h - 38}">${l1}</text>
    <text class="rf-cap ${ok ? 'ok' : 'bad'}" x="${x + 16}" y="${h - 16}">${ok ? '✓' : '✗'} ${l2}</text>`;
}
const dot = (x, y, c, r = 6, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" ${extra}/>`;
const line = (x1, y1, x2, y2, c, cls = 'rf-link') => `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}"/>`;
const arrow = (x1, y1, x2, y2, c = '#64748b') =>
  `<line class="rf-arrow" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" marker-end="url(#rf-head)"/>`;
const img = (x, y, w, h, label, cls = '') =>
  `<rect class="rf-img ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>` +
  (label ? `<text class="rf-tiny" x="${x + w / 2}" y="${y + h + 14}" text-anchor="middle">${label}</text>` : '');
const t = (x, y, s, cls = 'rf-tiny', anchor = 'start') => `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${s}</text>`;
const DEFS = `<defs><marker id="rf-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#64748b"/></marker></defs>`;

/** Skewed BEV grid (parallelogram) with a car dot at relative position u∈[0,1]. */
function bev(x, y, u, label, faded) {
  const p = `${x},${y + 34} ${x + 150},${y + 34} ${x + 186},${y} ${x + 36},${y}`;
  let g = `<polygon class="rf-bev${faded ? ' faded' : ''}" points="${p}"/>`;
  for (let i = 1; i < 4; i++) {
    const f = i / 4;
    g += `<line class="rf-grid" x1="${x + 150 * f}" y1="${y + 34}" x2="${x + 36 + 150 * f}" y2="${y}"/>`;
  }
  g += `<line class="rf-grid" x1="${x + 18}" y1="${y + 17}" x2="${x + 168}" y2="${y + 17}"/>`;
  g += dot(x + 30 + 120 * u, y + 17, PINK, 5, faded ? 'opacity=".45"' : '');
  return g + t(x + 196, y + 22, label);
}

/** Isometric anchor box centred at (cx, cy). */
function cube(cx, cy, s, c = AMBER) {
  const d = s * 0.45;
  const x = cx - s / 2, y = cy - s / 2 + d / 2;
  return `<g class="rf-cube" stroke="${c}">
    <polygon points="${x},${y} ${x + s},${y} ${x + s},${y + s} ${x},${y + s}" fill="${c}" fill-opacity=".08"/>
    <polygon points="${x},${y} ${x + d},${y - d} ${x + s + d},${y - d} ${x + s},${y}" fill="${c}" fill-opacity=".14"/>
    <polygon points="${x + s},${y} ${x + s + d},${y - d} ${x + s + d},${y + s - d} ${x + s},${y + s}" fill="${c}" fill-opacity=".2"/>
  </g>`;
}

/* ── StreamPETR: three temporal paradigms (paper Fig. 1 argument) ── */
function streamPetr() {
  const H = 330;
  // (a) BEV temporal
  let a = panel(0, 300, H, '(a) BEV temporal', 'BEVFormer · BEVDet4D · SOLOFusion',
    ['과거 BEV 지도 전체를 현재로 warp', '격자는 정적 → 움직이는 차가 어긋남'], false);
  a += bev(24, 78, 0.15, 't−2', true) + bev(24, 128, 0.45, 't−1', true) + bev(24, 178, 0.8, 't', false);
  a += `<line class="rf-dash" x1="72" y1="95" x2="168" y2="195" stroke="${PINK}"/>`;
  a += t(150, 250, '같은 차가 프레임마다 다른 칸', 'rf-tiny', 'middle');

  // (b) perspective temporal
  let b = panel(330, 300, H, '(b) Perspective temporal', 'PETRv2 · DETR4D · Sparse4D v1',
    ['쿼리가 과거 이미지 T장을 매번 다시 읽음', '프레임 수만큼 연산이 늘어남'], false);
  const qs = [110, 150, 190], ims = [88, 140, 192];
  qs.forEach((qy) => ims.forEach((iy) => { b += line(388, qy, 520, iy + 18, GRAY); }));
  qs.forEach((qy) => { b += dot(388, qy, PINK, 8); });
  ims.forEach((iy, k) => { b += img(520, iy, 62, 36, '') + t(592, iy + 23, ['t−2', 't−1', 't'][k]); });
  b += t(388, 222, '현재 쿼리', 'rf-tiny', 'middle') + t(551, 248, '이미지 feature × T', 'rf-tiny', 'middle');

  // (c) object-centric (StreamPETR)
  let c = panel(660, 300, H, '(c) Object-centric · StreamPETR', '과거 = object query 메모리 큐',
    ['과거는 쿼리 4프레임×256개로만 전달', '가볍고, 물체 단위라 움직임 보정 쉬움'], true, true);
  [0, 1, 2].forEach((col) => [0, 1, 2, 3].forEach((r) => {
    c += dot(688 + col * 22, 104 + r * 26, CYAN, 6, `opacity="${0.45 + col * 0.25}"`);
  }));
  c += `<rect class="rf-queue" x="674" y="88" width="72" height="116" rx="8"/>`;
  c += t(710, 222, '메모리 큐', 'rf-tiny', 'middle');
  c += arrow(752, 146, 790, 146, CYAN);
  qs.forEach((qy) => { c += dot(806, qy, PINK, 8); });
  c += t(806, 222, '현재 쿼리', 'rf-tiny', 'middle');
  qs.forEach((qy) => { c += line(806, qy, 880, 158, GRAY); });
  c += img(880, 140, 56, 36, '현재 이미지만');
  return svg(960, H, DEFS + a + b + c, 'BEV temporal, perspective temporal, object-centric 비교');
}

/* ── Sparse4D v1: how features are sampled per anchor ── */
function sparse4dV1() {
  const H = 320;
  let a = panel(0, 300, H, '(a) DETR3D', '앵커 1개 = 기준점 1개',
    ['박스 중심점 하나만 이미지에 투영', '물체 내부 정보가 거의 안 들어옴'], false);
  a += cube(80, 150, 70) + dot(97, 150, PINK, 6);
  a += line(97, 150, 220, 150, PINK, 'rf-ray') + img(206, 112, 72, 76, '현재 이미지') + dot(242, 150, PINK, 5);

  let b = panel(330, 300, H, '(b) SRCN3D', '투영된 박스 영역 RoI-Align',
    ['박스가 덮는 영역을 통째로 샘플', '느리고, 뷰 간 정렬이 부정확'], false);
  b += cube(410, 150, 70);
  b += `<polygon class="rf-roi" points="372,118 448,118 520,128 520,172 372,190"/>`;
  b += img(536, 112, 72, 76, '현재 이미지') + `<rect class="rf-roibox" x="548" y="126" width="46" height="42" rx="3"/>`;

  let c = panel(660, 300, H, '(c) Sparse4D · 4D keypoints', '고정 7 + 학습 6 = keypoint 13개',
    ['keypoint × 과거 T프레임 × 뷰 × 스케일 샘플', '박스 내부 문맥 + 시간 정렬을 한 번에'], true, true);
  c += cube(730, 150, 70);
  [[747, 150], [747, 122], [747, 178], [717, 150], [777, 150], [760, 138], [734, 166]].forEach(([x, y]) => { c += dot(x, y, PINK, 4); });
  [[728, 128], [770, 170], [758, 120]].forEach(([x, y]) => { c += dot(x, y, VIOLET, 4); });
  [0, 1, 2].forEach((k) => {
    const x = 846 + k * 14, y = 96 + k * 22;
    c += img(x, y, 64, 54, '', k < 2 ? 'faded' : '');
    if (k === 2) [[x + 14, y + 16], [x + 36, y + 24], [x + 22, y + 38], [x + 48, y + 34]].forEach(([px, py]) => { c += dot(px, py, PINK, 3); });
  });
  c += line(790, 150, 870, 150, PINK, 'rf-ray') + t(890, 196, 't−2 · t−1 · t', 'rf-tiny', 'middle');
  return svg(960, H, DEFS + a + b + c, 'DETR3D, SRCN3D, Sparse4D 샘플링 방식 비교');
}

/* ── Sparse4D v2: multi-frame sampling vs recurrent (schematic) ── */
function sparse4dV2Schema() {
  const row = (y, title, sub, us, body) =>
    `<rect class="rf-panel${us ? ' us' : ''}" x="0" y="${y}" width="960" height="96" rx="14"/>
     <text class="rf-title" x="20" y="${y + 40}">${title}</text><text class="rf-sub" x="20" y="${y + 62}">${sub}</text>${body}`;
  const box = (x, y, w, label, c) => `<rect class="rf-node" x="${x}" y="${y}" width="${w}" height="40" rx="10" stroke="${c}"/>` + t(x + w / 2, y + 25, label, 'rf-node-t', 'middle');
  let r1 = box(260, 128, 130, '현재 앵커', AMBER);
  r1 += arrow(392, 148, 466, 148);
  ['t', 't−1', 't−2', '… t−T'].forEach((s, k) => { r1 += img(470 + k * 78, 126, 64, 44, '') + t(502 + k * 78, 153, s, 'rf-tiny', 'middle'); });
  r1 += arrow(782, 148, 808, 148) + box(812, 128, 128, '융합 → 정제', CYAN);
  let r2 = box(260, 24, 130, 't−1 instance', CYAN);
  r2 += arrow(392, 44, 446, 44) + box(450, 24, 170, 'ego + v·Δt 투영', AMBER);
  r2 += arrow(622, 44, 672, 44) + img(676, 22, 64, 44, '') + t(708, 49, 't만', 'rf-tiny', 'middle');
  r2 += arrow(742, 44, 808, 44) + box(812, 24, 128, 'Fₜ → 다음 프레임', CYAN);
  return svg(960, 202, DEFS +
    row(0, '(a) Sparse4D v1 · multi-frame', '과거 이미지를 매번 다시 샘플', false, `<g transform="translate(0,-104)">${r1}</g>`) +
    row(104, '(b) Sparse4D v2 · recurrent', '인스턴스 상태를 이어받음', true, `<g transform="translate(0,104)">${r2}</g>`),
    'Sparse4D v1 다중 프레임 샘플링과 v2 재귀 구조 비교');
}

/* ── Sparse4D v2 Table 1: FPS / GPU memory vs history frames T (small multiples, one axis each) ── */
function v2Chart(title, unit, v1, v2, max, fmt) {
  const T = [1, 2, 3, 5, 7, 9];
  const W = 460, H = 250, L = 52, R = 112, TOP = 40, B = 40;
  const x = (v) => L + ((v - 1) / 8) * (W - L - R);
  const y = (v) => TOP + (1 - v / max) * (H - TOP - B);
  let g = `<text class="rf-title" x="0" y="18">${title}</text>`;
  [0, 0.5, 1].forEach((f) => {
    const v = max * f;
    g += `<line class="rf-gridline" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>` + t(L - 8, y(v) + 4, fmt(v), 'rf-axis', 'end');
  });
  T.forEach((v) => { g += t(x(v), H - B + 18, v, 'rf-axis', 'middle'); });
  g += t((L + W - R) / 2, H - 2, '과거 프레임 수 T (v1)', 'rf-axis', 'middle');
  g += `<line class="rf-v2" x1="${L}" x2="${W - R}" y1="${y(v2)}" y2="${y(v2)}" stroke="${CYAN}"/>`;
  g += t(W - R + 8, y(v2) + 4, `v2 ${fmt(v2)}${unit}`, 'rf-direct');
  g += `<polyline class="rf-v1" fill="none" stroke="${VIOLET}" points="${T.map((v, i) => `${x(v)},${y(v1[i])}`).join(' ')}"/>`;
  T.forEach((v, i) => {
    g += `<g class="rf-pt"><circle cx="${x(v)}" cy="${y(v1[i])}" r="12" fill="transparent"/><circle cx="${x(v)}" cy="${y(v1[i])}" r="4.5" fill="${VIOLET}" stroke="var(--pan)" stroke-width="2"/><title>v1 · T=${v}: ${fmt(v1[i])}${unit}</title></g>`;
  });
  g += t(W - R + 8, y(v1[5]) + 4, `v1 ${fmt(v1[5])}${unit}`, 'rf-direct');
  return g;
}
function sparse4dV2Chart() {
  const fps = v2Chart('FPS ↑ (RTX 3090, R50, 704×256)', '', [21.5, 15.3, 12.6, 9.0, 7.1, 6.1], 19.4, 25, (v) => (Math.round(v * 10) / 10).toString());
  const mem = v2Chart('GPU 메모리 ↓ (MB)', '', [424, 515, 614, 792, 971, 1149], 432, 1200, (v) => Math.round(v).toString());
  return svg(960, 252, `<g>${fps}</g><g transform="translate(500,0)">${mem}</g>`, 'Sparse4D v1과 v2의 FPS 및 GPU 메모리 비교 (논문 Table 1)');
}

/* ── Sparse4D v3: denoising + decoupled attention ── */
function sparse4dV3() {
  const H = 320;
  const box = (x, y, w, h, c, dash) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${c}" fill-opacity=".08" stroke="${c}" stroke-width="2" ${dash ? 'stroke-dasharray="5 4"' : ''}/>`;
  let a = panel(0, 300, H, '(a) DN-DETR (2D)', '이미지 한 장 · 단일 프레임',
    ['GT 주변에 noisy 쿼리를 넣고 복원 학습', '시간축 연결은 없음'], false);
  a += box(100, 110, 90, 70, GREEN) + box(112, 98, 90, 70, AMBER, true) + box(86, 124, 90, 70, AMBER, true);
  a += t(146, 222, 'GT(초록) + noisy(주황)', 'rf-tiny', 'middle');

  let b = panel(330, 300, H, '(b) v3 · Temporal denoising', 'noisy 그룹을 다음 프레임까지 전파',
    ['그룹끼리 attention을 막아 매칭 모호성 제거', '3D·시간축 denoising (학습 전용)'], true, true);
  b += t(400, 84, 'frame t', 'rf-tiny', 'middle') + t(540, 84, 'frame t+1', 'rf-tiny', 'middle');
  b += box(372, 106, 56, 44, GREEN) + box(380, 98, 56, 44, AMBER, true) + box(366, 160, 56, 44, VIOLET, true);
  b += box(512, 106, 56, 44, GREEN) + box(518, 102, 56, 44, AMBER, true) + box(506, 160, 56, 44, VIOLET, true);
  b += arrow(442, 122, 500, 122, AMBER) + arrow(430, 184, 500, 184, VIOLET);
  b += `<line class="rf-dash" x1="352" x2="600" y1="154" y2="154" stroke="#64748b"/>` + t(476, 236, '그룹 1 / 그룹 2 는 서로 안 봄', 'rf-tiny', 'middle');

  let c = panel(660, 300, H, '(c) Decoupled attention', 'query↔query attention 입력을 분리',
    ['feature·embedding을 더하지 않고 이어붙임', '위치·내용이 안 섞여 엉뚱한 연관 감소'], true, true);
  const bar = (x, y, w, c2) => `<rect x="${x}" y="${y}" width="${w}" height="20" rx="4" fill="${c2}"/>`;
  c += t(680, 88, '기존 (add)', 'rf-tiny') + bar(680, 96, 60, CYAN) + t(750, 111, '+', 'rf-op') + bar(766, 96, 60, VIOLET) + t(836, 111, '=', 'rf-op');
  c += `<rect x="852" y="96" width="60" height="20" rx="4" fill="url(#rf-mix)"/>`;
  c += t(680, 158, 'v3 (concat)', 'rf-tiny') + bar(680, 166, 60, CYAN) + t(750, 181, '‖', 'rf-op') + bar(766, 166, 60, VIOLET) + t(836, 181, '=', 'rf-op');
  c += bar(852, 166, 34, CYAN) + bar(886, 166, 34, VIOLET);
  c += t(886, 214, '차원 2배 → attention', 'rf-tiny', 'middle');
  const mix = `<defs><linearGradient id="rf-mix"><stop offset="0" stop-color="${CYAN}"/><stop offset="1" stop-color="${VIOLET}"/></linearGradient></defs>`;
  return svg(960, H, DEFS + mix + a + b + c, 'DN-DETR, Sparse4D v3 temporal denoising, decoupled attention 비교');
}

/* ── Foundation4D: global vs factorized attention + task coverage ── */
function f4dAttention() {
  const H = 300;
  const grid = (x0, hi, title, sub, us) => {
    let g = `<rect class="rf-panel${us ? ' us' : ''}" x="${x0}" y="0" width="300" height="${H}" rx="14"/>
      <text class="rf-title" x="${x0 + 16}" y="28">${title}</text><text class="rf-sub" x="${x0 + 16}" y="47">${sub}</text>`;
    const cx = x0 + 86, cy = 80, s = 38;
    ['cam1', 'cam2', 'cam3', 'cam4'].forEach((n, i) => { g += t(cx + i * s + s / 2, cy - 8, n, 'rf-axis', 'middle'); });
    ['t₁', 't₂', 't₃'].forEach((n, j) => { g += t(cx - 10, cy + j * s + s / 2 + 4, n, 'rf-axis', 'end'); });
    for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) {
      const on = hi(i, j), self = i === 1 && j === 1;
      g += `<rect x="${cx + i * s + 2}" y="${cy + j * s + 2}" width="${s - 4}" height="${s - 4}" rx="6" class="rf-cell${on ? ' on' : ''}${self ? ' self' : ''}"/>`;
    }
    return g;
  };
  let g = grid(0, () => true, '(a) VGGT · 전역 attention', '모든 이미지가 서로를 봄', false);
  g += t(16, 248, '비용 ∝ (T·C·N)²', 'rf-cap') + t(16, 270, '✗ 카메라·시간이 늘면 급증', 'rf-cap bad');
  g += grid(330, (i, j) => j === 1, '(b) Foundation4D · 카메라 층', '같은 시각의 다른 카메라끼리', true);
  g += t(346, 248, '이미지 내부 attention 뒤에 적용', 'rf-cap') + t(346, 270, '✓ 한 번에 C장만 봄', 'rf-cap ok');
  g += grid(660, (i) => i === 1, '(c) Foundation4D · 시간 층', '같은 카메라의 다른 시각끼리', true);
  g += t(676, 248, '(b)와 (c)를 층마다 번갈아 16층', 'rf-cap') + t(676, 270, '✓ 한 번에 T장만 봄', 'rf-cap ok');
  return svg(960, H, g, 'VGGT 전역 attention과 Foundation4D factorized attention 비교');
}
function f4dTasks() {
  const cols = ['깊이·기하', '카메라 포즈', '3D 검출', 'Occupancy', 'Gaussian 재구성'];
  const rows = [
    ['VGGT', '단일 장면 기하 foundation', ['●', '●', '○', '○', '○']],
    ['GeoUP', 'VGGT를 주행 영상에 적용', ['●', '◐', '●', '●', '○']],
    ['Foundation4D', '인지 + 재구성 통합', ['●', '●', '●', '●', '●']],
  ];
  const X0 = 300, CW = 132, RH = 46;
  let g = '';
  cols.forEach((c, i) => { g += t(X0 + i * CW + CW / 2, 22, c, 'rf-colh', 'middle'); });
  rows.forEach(([name, sub, marks], r) => {
    const y = 40 + r * RH, us = r === 2;
    g += `<rect class="rf-row${us ? ' us' : ''}" x="0" y="${y}" width="960" height="${RH - 6}" rx="10"/>`;
    g += t(16, y + 18, name, 'rf-title') + t(16, y + 34, sub, 'rf-sub');
    marks.forEach((m, i) => { g += t(X0 + i * CW + CW / 2, y + 27, m, `rf-mark m${'●◐○'.indexOf(m)}`, 'middle'); });
  });
  g += t(0, 40 + 3 * RH + 14, '● 직접 예측   ◐ 알려진 카메라 포즈를 입력으로 받음(포즈는 보조 학습만)   ○ 다루지 않음 — 각 논문 Related work·본문 기준', 'rf-axis');
  return svg(960, 40 + 3 * RH + 22, g, 'VGGT, GeoUP, Foundation4D가 다루는 작업 비교');
}

export const RELATED_FIGS = {
  'stream-petr': [{ svg: streamPetr, cap: '시간 정보를 다루는 세 가지 방식. StreamPETR 논문 Fig. 1의 분류를 다시 그렸습니다.' }],
  'sparse4d-v1': [{ svg: sparse4dV1, cap: '앵커 하나에서 feature를 뽑는 방식 비교. Sparse4D는 keypoint를 시간축(4D)까지 확장합니다.' }],
  'sparse4d-v2': [
    { svg: sparse4dV2Schema, cap: 'v1은 과거 프레임마다 다시 샘플링하고, v2는 지난 프레임 instance를 넘겨받아 현재 이미지만 봅니다.' },
    { svg: sparse4dV2Chart, cap: '논문 Table 1 수치. v1은 과거 프레임 T가 늘수록 느려지고 메모리가 커지지만, v2는 T와 무관합니다 (점에 마우스를 올리면 값 표시).' },
  ],
  'sparse4d-v3': [{ svg: sparse4dV3, cap: 'v3의 두 학습·구조 개선을 기존 DETR 계열 기법과 나란히 비교했습니다.' }],
  'foundation4d': [
    { svg: f4dAttention, cap: '12장(T=3 × C=4) 윈도우에서 강조된 칸(cam2·t₂)이 attention할 수 있는 이미지. 실제로는 이미지마다 패치 토큰 수백 개가 들어갑니다.' },
    { svg: f4dTasks, cap: '가장 가까운 선행 연구와 다루는 출력 비교.' },
  ],
};
