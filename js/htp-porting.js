/** "04 HTP 포팅 난이도" section for Sparse4D v2 / v3 and StreamPETR (StreamPETR content: htp-streampetr.js).
 *  Facts and numbers come from the vault note "Sparse4D HTP 포팅 난이도 분석" (QNN docs, 2026-11-09 게시본).
 *  Items the note marks as 추정 keep that mark here. No latency numbers. Styling: css/main.css (.htp-*). */

import { spRows, spCards, spDiagram, SP_LEAD, SP_CAPTION, SP_FOOT, SP_NOTES } from './htp-streampetr.js';

const ANALYSIS_URL = 'https://cursor.com/canvas/store-5bf4aedf-7868-449e-adf6-6140f72b2dc7/437944e9-0a6c-425b-b220-fadc3d5de36b';

const LV = { g: '쉬움', y: '보통', r: '어려움', c: 'CPU' };
const est = '<span class="htp-est">추정</span>';

/* ── 8 representative blocks. cell = [level, reason] ── */
function rows(v3) {
  return [
    {
      id: 'backbone', name: '이미지 백본 + FPN', sub: 'R50 · 6캠 × 256×704',
      cells: [
        ['g', 'FPN 출력 4레벨 23MB(INT8)라 VTCM 밖 DDR 상주가 전제'],
        ['g', '표준 CNN이라 W8A8 PTQ가 통함'],
        ['g', '6캠 × 3 × 256 × 704 고정'],
        ['g', 'Conv · BN · ReLU · Resize만 사용'],
      ],
      overall: 'g',
      strategy: 'G1 독립 INT8 그래프. 출력은 GridSample 입력 형식(NHWC, 배치=카메라)',
    },
    {
      id: 'anchor', name: 'Anchor · 카메라 인코딩', sub: 'instance bank + anchor encoder + camera param encoder',
      cells: [
        ['g', '900×11 anchor + 900×256 feature 상수'],
        ['y', 'x·y·z가 ±수십 m라 8bit 계단이 약 0.47 m'],
        ['g', 'anchor 900개 고정'],
        ['g', '상수 인덱스 선택은 Slice로 바꿈'],
      ],
      overall: 'g',
      strategy: 'bank와 camera_embed는 상수로 접고, 첫 Linear 입력만 16bit',
    },
    {
      id: 'keypoint', name: 'Keypoint 생성 · 카메라 투영', sub: '7 고정 + 6 학습, 4×4 matmul, 깊이 나눗셈',
      cells: [
        ['g', '기하 텐서라 메모리 부담이 작음'],
        ['r', '미터 좌표 × exp(size)·회전, 투영행렬 값 수백~수천, 깊이 나눗셈'],
        ['g', 'keypoint 13개 고정'],
        ['y', `회전행렬 원소 대입이 ScatterND로 나갈 수 있음 ${est}`],
      ],
      overall: 'y',
      strategy: '회전을 Mul/Add/Concat으로 직접 쓰고 FP16 구간 유지. 깊이 < ε 점은 grid를 −2로 보내 버림',
    },
    {
      id: 'deform', name: 'Deformable aggregation', sub: '가중치 MLP + softmax(312-way × 8그룹) 포함',
      cells: [
        ['r', '특징맵 23MB(INT8)·46MB(16bit)를 앵커마다 임의 주소로 읽음. 레벨별로 풀면 층마다 72MB 중간 텐서'],
        ['r', 'GridSample은 입력·grid가 같은 비트폭. 8bit grid 0.69 px, softmax 312-way'],
        ['g', '900 × 13 × 6 × 4 정적'],
        ['r', 'deformable_aggregation CUDA 확장은 ONNX export 불가'],
      ],
      overall: 'r',
      strategy: 'use_deformable_func=False 경로로 레벨별 GridSample. 분해 방안 A → B/C → D 순서',
    },
    {
      id: 'attn', name: v3 ? 'Attention (decoupled)' : 'Attention',
      sub: v3 ? 'self · temporal cross MHA + FFN + LN, concat 512차원' : 'self · temporal cross MHA + FFN + LN',
      cells: [
        ['y', v3 ? 'self-attn 맵 900×900×8 = 6.5MB(INT8), 512차원 concat 입력' : 'self-attn 맵 900×900×8 = 6.5MB(INT8)로 VTCM 예약 4MB 초과'],
        ['y', v3 ? `900키 softmax·LN + concat 텐서가 스케일 하나를 공유 (두 입력 범위는 비슷 ${est})` : '900키 softmax·LN, 일반 트랜스포머 PTQ 수준'],
        ['g', 'query 900 · 캐시 600 고정'],
        ['g', 'MHA · FFN · LN 모두 HTP 기본 op'],
      ],
      overall: 'y',
      strategy: v3 ? 'A16W8 + softmax 16bit. W·[f; p] = W_f·f + W_p·p로 MatMul을 나눠 텐서별 스케일 유지' : 'A16W8 + softmax 16bit. 이미지 토큰 cross-attn이 없어 K/V가 작음',
    },
    {
      id: 'refine', name: v3 ? 'Refinement head + QE' : 'Refinement head',
      sub: v3 ? 'reg 11 + cls 10 + quality 2' : 'reg 11 + cls 10',
      cells: [
        ['g', v3 ? '900 × (11 + 10 + 2) 작은 출력' : '900 × (11 + 10) 작은 출력'],
        ['r', 'residual을 미터 anchor에 더해 다음 층·다음 프레임 anchor가 됨'],
        ['g', '900 고정'],
        ['y', `refine_state 대입이 ScatterND로 나갈 수 있음 ${est}`],
      ],
      overall: 'y',
      strategy: 'Slice + Add + Concat으로 재작성, 덧셈은 FP16, 1/Δt는 곱셈 입력',
    },
    {
      id: 'recur', name: 'Recurrent instance 전파', sub: 'ego · v·Δt 보정, top-k 600, concat',
      cells: [
        ['g', '600×256 + 600×11, 16bit 약 0.3MB'],
        ['r', '미터 상태를 프레임마다 재양자화 → 오차·decay(×0.6) 누적'],
        ['y', '첫 프레임은 캐시 없음, 2초 공백이면 reset'],
        ['y', `TopK·Gather는 지원, 대입은 ScatterND 가능 ${est}`],
      ],
      overall: 'y',
      strategy: '캐시·유효 mask·ego 4×4·1/Δt를 항상 그래프 입력으로, TopK·Gather는 HTP 안',
    },
    {
      id: 'post', name: '후처리', sub: 'top-k 300 · 정렬 · threshold · atan2 · ID',
      cells: [
        ['g', 'raw 900개 출력만 받음'],
        ['y', 'INT8 점수는 동률로 순위가 바뀔 수 있음'],
        ['r', 'threshold·ID 부여로 결과 개수가 동적'],
        ['y', 'ONNX에 Atan2 op 없음'],
      ],
      overall: 'c', overallText: '쉬움 (CPU)',
      strategy: 'HTP는 raw 900개(FP16)까지만 내고 나머지는 CPU',
    },
  ];
}

/* ── difficulty cards ── */
const BADGE = {
  fix: ['해결 가능', 'ok'],
  work: ['우회 가능', 'work'],
  trade: ['정확도 trade-off', 'trade'],
  cpu: ['CPU로 이관', 'cpu'],
  assume: ['설계 가정', 'assume'],
};
function cards(v3) {
  const list = [
    {
      badges: ['fix'], block: 'deform',
      title: 'deformable_aggregation CUDA op은 ONNX로 안 나감',
      issue: 'v2부터 쓰는 fused CUDA 확장(EDA)은 export 대상이 아닙니다.',
      fix: ['공식 <code>use_deformable_func=False</code> 경로: 레벨별 GridSample → Mul → ReduceSum. 6층 × 4레벨 = GridSample 24회',
        '또는 HTP 커스텀 op package(QHPI / legacy). 중간 텐서가 없지만 HVX·VTCM 타일링을 직접 구현하고 AIMET 캘리브레이션용 대응 연산이 필요'],
      verdict: '표준 op 경로로 정확도 기준선을 먼저 잡고, 프로파일에서 GridSample이 지배적일 때만 커스텀 op',
    },
    {
      badges: ['work'], block: 'deform',
      title: 'FPN 특징맵이 VTCM을 넘고, 샘플링은 DDR 랜덤 읽기',
      issue: '특징맵 23MB(INT8)·46MB(16bit)를 앵커마다 임의 주소로 읽습니다. 레벨별 GridSample 출력은 레벨당 18MB, 층당 72MB입니다.',
      fix: [`앵커 청크 분할: 900을 100개씩 9청크 → 중간 텐서 1/9. Mul+ReduceSum이 VTCM 안에서 끝날 여지 ${est}`,
        '카메라 아틀라스 + 점마다 보이는 상위 2캠: 샘플 6 → 2, 레벨당 GridSample 1회 (폭 1,056이라 16bit grid 필수)',
        '특징 해상도나 레벨 수를 줄이는 선택지도 있지만 원본 config와 달라져 재학습·정확도 확인이 필요'],
      verdict: `없앨 수는 없고 줄이는 문제. DDR 읽기 상한은 보이는 캠 2개 기준 약 96MB/층 ${est}, GridSample 랜덤 접근 성능은 공개 수치가 없어 실측 필요`,
    },
    {
      badges: ['trade'], block: 'deform',
      title: 'GridSample은 입력과 grid의 비트폭이 같아야 함',
      issue: `HTP op 표에는 UFIXED8끼리, UFIXED16끼리만 있습니다(혼합 조합은 미지원으로 가정 ${est}). 8bit grid는 stride-4 레벨(폭 176)에서 계단 0.69 px입니다.`,
      fix: ['둘 다 16bit: 정밀도는 확보되지만 특징맵도 16bit가 되어 DDR 트래픽 2배',
        '절충: stride-4 레벨만 16bit로 두고 나머지 레벨은 8bit, 레벨마다 grid 양자화 범위를 따로 잡기 (검증 필요)'],
      verdict: '정밀도와 DDR 대역 사이에서 고르는 문제',
    },
    {
      badges: ['fix'], block: 'keypoint',
      title: '미터 단위 기하 구간은 양자화에 민감',
      issue: v3
        ? 'keypoint, 투영, 깊이 나눗셈, refine residual이 층·프레임마다 이어집니다. v3는 같은 head에 quality 2 출력이 붙습니다.'
        : 'keypoint, 투영, 깊이 나눗셈, refine residual이 층·프레임마다 이어집니다.',
      fix: ['FP16 또는 16bit 섬으로 G2(디코더) 안에 유지',
        'CPU로 빼는 방법도 있지만 좌표가 층마다 anchor를 따라 바뀌어 층마다 HTP↔CPU 왕복이 생기므로 비권장'],
      verdict: 'INT8만 안 쓰면 해결. 혼합 정밀도 PTQ로 기하 구간만 FP16/16bit',
    },
    {
      badges: ['fix'], block: 'deform',
      title: '312-way softmax는 INT8로는 너무 묽음',
      issue: '6캠 × 4레벨 × 13점 = 312개에 퍼지면 평균 0.0032로, INT8 한 계단(1/255 = 0.0039)보다 작아 작은 가중치가 0이 됩니다.',
      fix: ['softmax 출력과 가중합 weights를 16bit 활성값으로',
        'HTP Softmax는 마지막 축만 지원하므로 transpose로 축을 맞춤'],
      verdict: '16bit로 두면 해결. 층당 224만 원소(16bit 약 4.5MB)라 VTCM 예약 4MB와 비슷',
    },
    {
      badges: ['work'], block: 'recur',
      title: 'recurrent 상태 오차 누적 · 첫 프레임',
      issue: '미터 상태를 프레임마다 재양자화해 오차와 confidence decay(×0.6)가 쌓입니다. 첫 프레임은 캐시가 없어 파이썬 분기로 그래프가 바뀌고, 2초 넘는 공백이면 reset됩니다.',
      fix: ['상태는 16bit 유지, 캐시는 CPU가 보관해 매 프레임 그래프 입력으로',
        '슬롯은 600개 고정 + 유효 mask',
        '첫 프레임·reset은 별도 그래프, 또는 0 초기화 + mask'],
      verdict: '구조는 해결되지만 누적 오차는 긴 시퀀스에서 anchor drift·ID switch로 확인해야 함 (필요하면 QAT)',
    },
    {
      badges: ['fix'], block: 'recur',
      title: 'TopK·Gather는 OK, in-place 대입은 ScatterND',
      issue: `k가 정적인 TopK와 Gather는 HTP가 지원합니다. 회전행렬·refine·confidence 원소 대입은 ONNX ScatterND로 나갈 수 있습니다 ${est}.`,
      fix: ['원소 대입을 Slice / Concat 식으로 재작성 (수학적으로 동일)'],
      verdict: 'export 전 코드 정리로 해결',
    },
    {
      badges: ['cpu'], block: 'post',
      title: '후처리는 결과 개수가 동적',
      issue: 'score threshold와 ID 부여는 출력 개수가 바뀌고, ONNX에는 Atan2가 없습니다. INT8 점수는 동률로 순위가 바뀔 수 있습니다.',
      fix: ['HTP는 raw 900개 출력(FP16)까지만 내고, top-k 300·정렬·threshold·atan2·ID는 CPU'],
      verdict: 'CPU 경계 데이터는 캐시 600개와 후처리뿐이라 KB 단위',
    },
    {
      badges: ['assume'], block: 'attn',
      title: '활성값 per-channel 양자화는 문서에서 미확인',
      issue: 'Conv2d·MatMul 양자화 표에는 per-axis가 가중치·bias에만 나열돼 있습니다. SA8650P 최대 VTCM 크기도 공개되지 않았습니다.',
      fix: ['concat된 이종 텐서는 per-tensor 스케일을 공유한다고 보고 설계', '<code>vtcm_mb</code>를 명시하고 프로파일로 확인'],
      verdict: '안전한 쪽(per-tensor)을 기본 가정으로',
    },
  ];
  if (v3) {
    list.splice(7, 0, {
      badges: ['fix'], block: 'attn', v3: true,
      title: 'v3 decoupled attention의 concat',
      issue: `feature와 anchor embed를 한 텐서로 이으면 스케일 하나를 공유합니다. 둘 다 LN 뒤라 범위는 비슷할 것으로 봅니다 ${est}.`,
      fix: ['W·[f; p] = W_f·f + W_p·p로 MatMul을 나눠 텐서별 스케일 유지',
        '512차원 projection과 어텐션 텐서 크기는 프로파일에서 확인'],
      verdict: '대체로 문제없음. 512차원 projection만 주의',
    });
  }
  return list;
}

/* ── SVG diagram ── */
const COL = { g: '#059669', y: '#d97706', r: '#dc2626', c: '#64748b' };
function block(id, x, y, w, h, lv, lines, tag) {
  const cx = x + w / 2;
  const n = lines.length + (tag ? 1 : 0);
  const lh = 17;
  let ty = y + h / 2 - ((n - 1) * lh) / 2 + 5;
  let txt = lines.map((s) => { const r = `<text class="htp-bt" x="${cx}" y="${ty}" text-anchor="middle">${s}</text>`; ty += lh; return r; }).join('');
  if (tag) txt += `<text class="htp-tag" x="${cx}" y="${ty}" text-anchor="middle">${tag}</text>`;
  return `<g class="htp-blk lv-${lv}" data-htp="${id}" tabindex="0" role="button" aria-label="${lines.join(' ')}${tag ? ' ' + tag : ''} — 종합 ${LV[lv]}">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" style="--c:${COL[lv]}"/>${txt}</g>`;
}
function diagram(v3) {
  const W = 1140, H = 400;
  const by = 96, bh = 92; // block row
  const arr = (x1, y1, x2, y2) => `<line class="htp-arrow" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#htp-head)"/>`;
  const mid = by + bh / 2;
  let g = `<defs><marker id="htp-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#64748b"/></marker></defs>`;
  // input
  g += `<g class="htp-in"><rect x="0" y="${by + 10}" width="104" height="${bh - 20}" rx="10"/>
    <text class="htp-bt" x="52" y="${mid - 3}" text-anchor="middle">카메라</text><text class="htp-bt" x="52" y="${mid + 15}" text-anchor="middle">이미지 ×6</text></g>`;
  g += arr(106, mid, 128, mid);
  g += block('backbone', 132, by, 128, bh, 'g', ['Backbone', '+ FPN']);
  g += arr(262, mid, 290, mid);
  // decoder container
  const dx = 296, dw = 666;
  g += `<rect class="htp-dec" x="${dx}" y="40" width="${dw}" height="186" rx="16"/>`;
  g += `<text class="htp-dec-t" x="${dx + 18}" y="70">Decoder ×6</text>`;
  g += `<text class="htp-dec-s" x="${dx + dw - 18}" y="70" text-anchor="end">G2 · A16W8, 기하 구간 FP16</text>`;
  const inner = [
    ['anchor', 'g', ['Anchor ·', '카메라 인코딩'], null],
    ['keypoint', 'y', ['Keypoint 생성 ·', '카메라 투영'], null],
    ['deform', 'r', ['Deformable', 'aggregation'], null],
    ['attn', 'y', ['Attention'], v3 ? 'decoupled concat' : null],
    ['refine', 'y', ['Refinement', 'head'], v3 ? '+ quality estimation' : null],
  ];
  const bw = 116, gap = 14, x0 = dx + 14;
  inner.forEach(([id, lv, lines, tag], i) => {
    const x = x0 + i * (bw + gap);
    g += block(id, x, by, bw, bh, lv, lines, tag);
    if (i < inner.length - 1) g += arr(x + bw + 1, mid, x + bw + gap - 1, mid);
  });
  // post (CPU)
  g += arr(dx + dw + 2, mid, 994, mid);
  g += block('post', 998, by, 142, bh, 'c', ['후처리', '(CPU)']);
  // recurrent loop
  const rx = 470, ry = 280, rw = 318, rh = 64;
  g += block('recur', rx, ry, rw, rh, 'y', ['Recurrent instance 전파', '(ego 보정 · top-k 600 · 캐시)']);
  const refX = x0 + 4 * (bw + gap) + bw / 2, ancX = x0 + bw / 2;
  g += `<path class="htp-loop" d="M ${refX} ${by + bh + 2} C ${refX} ${ry + rh / 2}, ${rx + rw + 60} ${ry + rh / 2}, ${rx + rw + 3} ${ry + rh / 2}" marker-end="url(#htp-head)"/>`;
  g += `<path class="htp-loop" d="M ${rx - 3} ${ry + rh / 2} C ${ancX + 20} ${ry + rh / 2}, ${ancX} ${ry + 10}, ${ancX} ${by + bh + 4}" marker-end="url(#htp-head)"/>`;
  g += `<text class="htp-loop-t" x="${(rx + rw / 2)}" y="${ry - 12}" text-anchor="middle">다음 프레임으로 instance 상태를 넘김</text>`;
  // legend
  const ly = H - 14;
  const leg = [['g', '쉬움'], ['y', '보통'], ['r', '어려움'], ['c', 'CPU']];
  let lx = 0;
  g += `<text class="htp-leg-h" x="${lx}" y="${ly}">종합 난이도</text>`;
  lx += 92;
  leg.forEach(([lv, s]) => {
    g += `<rect class="htp-leg lv-${lv}" x="${lx}" y="${ly - 12}" width="16" height="16" rx="4" style="--c:${COL[lv]}"/><text class="htp-leg-t" x="${lx + 24}" y="${ly + 1}">${s}</text>`;
    lx += 24 + s.length * 14 + 26;
  });
  g += `<text class="htp-leg-t mut" x="${W - 6}" y="${ly + 1}" text-anchor="end">블록에 마우스를 올리거나 Tab으로 포커스하면 아래 표의 행이 강조됩니다</text>`;
  return `<svg class="htp-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="Sparse4D ${v3 ? 'v3' : 'v2'} 추론 그래프와 블록별 HTP 포팅 난이도">${g}</svg>`;
}

/* ── HTML ── */
const dotHTML = (lv, s) => `<span class="htp-cell"><i class="htp-dot lv-${lv}" aria-label="${LV[lv]}"></i><span>${s}</span></span>`;
function tableHTML(list) {
  const head = ['블록', '메모리(DDR·VTCM)', '양자화', '고정 shape', '비표준 연산', '종합', '포팅 전략'];
  const body = list.map((r) => `<tr data-htp="${r.id}" tabindex="0">
      <th scope="row"><b>${r.name}</b><small>${r.sub}</small></th>
      ${r.cells.map(([lv, s]) => `<td>${dotHTML(lv, s)}</td>`).join('')}
      <td><span class="htp-pill lv-${r.overall}">${r.overallText || LV[r.overall]}</span>${r.note ? `<small class="htp-pill-note">${r.note}</small>` : ''}</td>
      <td class="htp-strat">${r.strategy}</td>
    </tr>`).join('');
  return `<div class="htp-table-wrap reveal"><table class="htp-table">
    <thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody></table></div>`;
}
function cardsHTML(list) {
  return `<h3 class="htp-h3 reveal">포팅할 때 고쳐야 하거나 고려할 어려움</h3>
  <div class="htp-cards">${list.map((c) => `
    <article class="htp-card reveal" data-htp="${c.block}">
      <div class="htp-badges">${c.badges.map((b) => `<span class="htp-badge b-${BADGE[b][1]}">${BADGE[b][0]}</span>`).join('')}${c.v3 ? '<span class="htp-badge b-v3">v3</span>' : ''}</div>
      <h4>${c.title}</h4>
      <p class="htp-issue">${c.issue}</p>
      <p class="htp-k">대체·수정</p>
      <ul>${c.fix.map((f) => `<li>${f}</li>`).join('')}</ul>
      <p class="htp-verdict">${c.verdict}</p>
    </article>`).join('')}
  </div>`;
}

export const HTP_PAPERS = new Set(['stream-petr', 'sparse4d-v2', 'sparse4d-v3']);

export function htpSectionHTML(id, num) {
  if (id === 'stream-petr') return spSectionHTML(id, num);
  const v3 = id === 'sparse4d-v3';
  const lead = v3
    ? 'SA8650P HTP(v73)에 올릴 때 블록별로 메모리(DDR·VTCM), 양자화, 고정 shape, 비표준 연산을 따져 본 결과입니다. v3 추론 그래프는 v2와 거의 같고, 추가분은 작은 quality MLP와 512차원 decoupled attention뿐입니다. anchor 900개, keypoint 13개, 캐시 600개가 모두 고정이라 정적 그래프로 내보낼 수 있습니다.'
    : 'SA8650P HTP(v73)에 올릴 때 블록별로 메모리(DDR·VTCM), 양자화, 고정 shape, 비표준 연산을 따져 본 결과입니다. anchor 900개, keypoint 13개, 캐시 600개가 모두 고정이라 정적 그래프로 내보낼 수 있고, BEVFusion BEV pool 같은 동적 scatter-add도 없습니다.';
  return `
  <section class="paper-sec htp-sec" id="${id}-htp" data-sec="htp">
    <h2 class="sec-title reveal"><span>${num}</span> HTP 포팅 난이도</h2>
    <p class="reveal prose-lead">${lead} 어려운 곳은 <b>deformable aggregation</b>과 <b>미터 단위 기하 구간</b> 두 군데입니다.</p>
    <figure class="htp-fig reveal">
      <div class="htp-scroll">${diagram(v3)}</div>
      <figcaption>블록 색 = 아래 표의 종합 난이도. 종합은 네 축 중 가장 어려운 축을 기본으로 하되, 분석 노트의 블록별 판정과 같게 맞췄습니다(CPU로 보내면 풀리는 후처리의 동적 shape는 낮춤).</figcaption>
    </figure>
    ${tableHTML(rows(v3))}
    <p class="htp-foot reveal">학습 전용 블록(${v3 ? 'v3 temporal instance denoising, ' : ''}dense depth 분기)은 추론 그래프에서 제거합니다. <a href="${ANALYSIS_URL}" target="_blank" rel="noopener">전체 분석 페이지 ↗</a></p>
    ${cardsHTML(cards(v3))}
  </section>`;
}

/* StreamPETR */
function spSectionHTML(id, num) {
  return `
  <section class="paper-sec htp-sec" id="${id}-htp" data-sec="htp">
    <h2 class="sec-title reveal"><span>${num}</span> HTP 포팅 난이도</h2>
    <p class="reveal prose-lead">${SP_LEAD}</p>
    <figure class="htp-fig reveal">
      <div class="htp-scroll">${spDiagram(block, COL)}</div>
      <figcaption>${SP_CAPTION}</figcaption>
    </figure>
    ${tableHTML(spRows())}
    <p class="htp-foot reveal">${SP_FOOT}</p>
    ${cardsHTML(spCards())}
    <ul class="htp-notes reveal">${SP_NOTES.map((n) => `<li>${n}</li>`).join('')}</ul>
  </section>`;
}

/** Hover / focus links between diagram blocks, table rows and cards. */
export function initHtpLinks(root) {
  root.querySelectorAll('.htp-sec').forEach((sec) => {
    const all = () => sec.querySelectorAll('[data-htp]');
    const set = (id) => all().forEach((el) => el.classList.toggle('htp-hl', !!id && el.dataset.htp === id));
    sec.querySelectorAll('.htp-blk, .htp-table tbody tr').forEach((el) => {
      el.addEventListener('mouseenter', () => set(el.dataset.htp));
      el.addEventListener('mouseleave', () => set(null));
      el.addEventListener('focus', () => set(el.dataset.htp));
      el.addEventListener('blur', () => set(null));
    });
  });
}
