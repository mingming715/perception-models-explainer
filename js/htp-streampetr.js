/** StreamPETR content for the "04 HTP 포팅 난이도" section.
 *  Facts and numbers come only from the vault note "StreamPETR HTP 포팅 난이도 분석" (vault 001e4c0,
 *  QNN docs 2026-11-09 게시본). 추정 marks are kept. No latency or time-complexity numbers. */

const est = '<span class="htp-est">추정</span>';

/* ── 7 grouped blocks (note §블록 묶음). cell = [level, reason] ── */
export function spRows() {
  return [
    {
      id: 'backbone', name: '백본 + FPN', sub: 'R50 256×704 · CPFPN, stride 16 단일 레벨',
      cells: [
        ['g', '6 × 16 × 44 × 256 = 108만 원소(INT8 1MB). Sparse4D 4레벨보다 21배 작음'],
        ['g', '표준 CNN이라 W8A8'],
        ['g', '입력 크기 고정'],
        ['g', '표준 Conv 경로. VoVNet eSE(GAP + sigmoid gate)도 기본 op'],
      ],
      overall: 'g',
      strategy: 'HTP INT8. stride-16 한 레벨만 출력하고 쓰지 않는 stride-32는 그래프에서 잘라냄',
    },
    {
      id: 'pe', name: '3D PE + query embedding', sub: 'frustum 64 depth → MLP 192→1024→256 · learnable query 644',
      cells: [
        ['y', 'frustum 4,224 × 64 depth, MLP 은닉층 433만 원소'],
        ['r', '미터 좌표 정규화 뒤 inverse_sigmoid. 범위 밖·0·1 근처에서 log 폭주'],
        ['g', '토큰 4,224 고정, 토큰 샘플링 없음'],
        ['r', 'torch.inverse(lidar2img): QNN Inverse는 전 백엔드 미지원, ONNX에도 역행렬 없음'],
      ],
      overall: 'g', overallText: '쉬움 (상수화)', note: '어려움 두 축은 상수화로 그래프에서 사라짐',
      strategy: '고정 캘리브레이션으로 오프라인 FP32 계산 → FP16 상수(2.2MB). inverse·MLP 제거, SE gate·LN만 HTP',
    },
    {
      id: 'mem', name: 'Memory queue + ego 변환', sub: '1,024 = 4프레임 × 256, top-K 256, concat, pop · 4×4',
      cells: [
        ['g', '상태 28만 원소'],
        ['y', 'float64 timestamp 캐스팅. ego 미터 좌표는 INT8이면 프레임마다 오차 누적'],
        ['g', '슬롯 고정, 첫 프레임도 0 패딩 + prev_exists'],
        ['y', `TopK·Gather·Concat·Slice는 지원, pseudo ref 대입은 ScatterND 가능 ${est}`],
      ],
      overall: 'c', overallText: '쉬움 (CPU)',
      strategy: 'CPU 링버퍼로 이관. top-K·concat·pop·4×4 변환은 CPU FP32',
    },
    {
      id: 'mln', name: 'MLN + 시간·위치 sin/cos 임베딩', sub: 'nerf PE 15→180, γ/β, affine 없는 LN · temp_pos',
      cells: [
        ['g', 'nerf PE 1,024 × 180 수준'],
        ['r', 'sin(2⁵·x)에 미터·초 입력. INT8이면 계단 하나가 수 rad 이상'],
        ['g', 'memory 1,024 고정'],
        ['g', 'Sin·Cos는 HTP 지원 (rank 4 제한)'],
      ],
      overall: 'y',
      strategy: 'nerf PE·posemb는 CPU/FP16, γ·β MLP와 LN은 HTP A16',
    },
    {
      id: 'self', name: 'Hybrid self-attn + FFN', sub: 'Q 900 = 644 + 256, K/V 1,668 = 900 + 768 memory',
      cells: [
        ['y', '점수 맵 900 × 1,668 × 8 = 1,201만 원소/층(16bit 24MB), VTCM 초과'],
        ['r', '1,668-way softmax 평균 0.0006 < INT8 계단 0.0039'],
        ['g', '크기 고정, 추론에는 attn_mask 없음'],
        ['g', 'MHA · FFN · LN 모두 기본 op'],
      ],
      overall: 'y',
      strategy: 'A16W8, softmax 16bit, 900×1,668 맵은 head 단위(헤드당 16bit 3MB) 분할',
    },
    {
      id: 'cross', name: '전역 cross-attn', sub: 'Q 900 × 이미지 토큰 4,224 (V2-99 6,000) · 8헤드',
      cells: [
        ['r', '점수 맵 3,041만 원소/층(16bit 61MB)이 VTCM 4~8MB 초과 → 층마다 DDR spill'],
        ['r', '4,224-way softmax 평균 0.00024 = INT8 계단의 1/16. key에 PE를 더해 범위도 넓음'],
        ['g', '토큰 수 고정, 샘플링 없음'],
        ['y', 'flash_attn CUDA 호출은 ONNX export 불가 → 표준 MHA로 교체'],
      ],
      overall: 'r',
      strategy: 'flash → 표준 MHA, query·head 청크로 점수 맵을 VTCM 안에, softmax 16bit',
    },
    {
      id: 'head', name: 'Detection head + 후처리', sub: 'cls·reg MLP · 9,000 → top-k 300, atan2, mask',
      cells: [
        ['g', '마지막 층 900 × 10 출력만'],
        ['r', '정규화 중심 INT8 계단 0.48 m, memory로 다음 프레임에 누적'],
        ['y', 'score·range mask로 결과 개수가 동적'],
        ['y', `원소 대입은 ScatterND 가능 ${est}, ONNX에 Atan2 없음`],
      ],
      overall: 'y',
      strategy: '마지막 층만 출력, 중심 회귀 16bit, top-k·decode는 CPU',
    },
  ];
}

/* ── 10 difficulty cards (note §난이도 카드) ── */
export function spCards() {
  return [
    {
      badges: ['fix'], block: 'cross',
      title: 'Cross-attn 점수 맵이 VTCM을 넘어 층마다 DDR spill',
      issue: '층마다 900 × 4,224 × 8 = 3,041만 원소(16bit 61MB)가 생깁니다. 6층을 반복하면 BEVFusion에서 겪은 cross-attn 텐서 DDR 왕복이 그대로 재현됩니다.',
      fix: ['K/V는 각각 108만 원소(16bit 2.2MB)라 VTCM에 상주',
        'query 청크(100개 → 16bit 6.8MB)와 head(청크 × 1헤드 → 16bit 0.84MB)로 그래프에서 명시적으로 분할. softmax가 청크 안에서 정확하게 끝나 online softmax가 필요 없음',
        `QNN 컴파일러가 스스로 분할하는지는 문서에 없음 ${est}. 프로파일에서 spill/fill과 DramToTcm 확인`],
      verdict: '수학적으로 정확한 분할이라 해결 가능. 대신 그래프 노드 수가 6층 × 청크 × 헤드만큼 늘어남',
    },
    {
      badges: ['trade'], block: 'cross',
      title: '4,224-way · 1,668-way softmax가 INT8 계단보다 작음',
      issue: '평균 확률이 0.00024(cross)와 0.0006(self)로 INT8 한 계단(1/255 = 0.0039)보다 작아, 확률이 대부분 0이 되고 일부 피크만 남습니다.',
      fix: ['softmax·attention 확률은 16bit (디코더 A16W8)', 'LN도 16bit로 둠'],
      verdict: '정밀도는 16bit로 확보. 16bit softmax의 성능 비용은 실측 필요',
    },
    {
      badges: ['fix'], block: 'cross',
      title: 'flash_attn CUDA 라이브러리 attention은 ONNX로 안 나감',
      issue: 'config의 PETRMultiheadFlashAttention은 <code>flash_attn_unpadded_kvpacked_func</code>를 호출합니다.',
      fix: [`수식이 같은 표준 MHA(MatMul → Softmax → MatMul)로 교체, packed 가중치 재배치 ${est}`,
        `QNN GroupQueryAttention은 HTP 지원이지만 LLM(KV cache·causal)용 정의이고 ONNX 변환기 대응이 없어, PETR cross-attn에 쓸 수 있는지는 미확인 ${est}`],
      verdict: 'export 전 모델 정리로 해결',
    },
    {
      badges: ['assume'], block: 'pe',
      title: 'torch.inverse와 3D PE는 상수화가 전제',
      issue: '<code>lidar2img.inverse()</code>는 QNN Inverse가 CPU·GPU·HTP 모두 미지원입니다. inverse_sigmoid PE는 범위 밖이나 0·1 근처에서 log가 폭주합니다.',
      fix: ['고정 캘리브레이션 · 고정 해상도 · 토큰 샘플링 없음(<code>aux_2d_only=True</code>)이면 PE 4,224 × 256과 cone이 입력과 무관한 상수',
        '오프라인 FP32로 계산해 FP16 상수(2.2MB)로 넣고, query_pos 644 × 256도 상수로 접음'],
      verdict: `캘리브레이션이나 해상도가 바뀌면 상수를 다시 생성. 등가성은 공식 추론 설정 기준 ${est}`,
    },
    {
      badges: ['cpu'], block: 'mln',
      title: 'MLN의 nerf PE sin(2⁵·x)는 INT8 입력에서 위상 붕괴',
      issue: 'velo·timestamp·egopose 15차원을 주파수 2⁰~2⁵의 sin/cos로 180차원으로 만듭니다. 미터·초 단위 입력이 INT8이면 계단 하나가 수 rad 이상이 됩니다.',
      fix: ['memory 메타로부터 CPU FP32에서 계산해 HTP 입력으로 전달', 'reduce·γ·β MLP와 LN은 HTP A16W8'],
      verdict: '입력이 원래 CPU의 queue 상태라 CPU 계산이 자연스러움',
    },
    {
      badges: ['cpu'], block: 'mem',
      title: 'Memory queue 연산은 CPU 링버퍼로',
      issue: `top-K 256 · concat · slice pop(FIFO), float64 timestamp, pseudo ref 원소 대입(ScatterND 가능 ${est})이 섞여 있습니다. 상태는 28만 원소입니다.`,
      fix: ['CPU 링버퍼로 옮기고 ego 4×4 변환도 CPU FP32',
        'HTP 출력은 마지막 층 900 × 256 · ref point · velo · score, 입력은 memory 1,024 × 256과 메타 (둘 다 1MB 미만)'],
      verdict: 'CPU에서 top-K를 하면 동률 순서 문제도 사라짐',
    },
    {
      badges: ['trade'], block: 'head',
      title: '정규화 중심의 양자화 오차가 memory로 누적',
      issue: '중심(0~1, 122.4 m 범위)을 INT8로 표현하면 계단이 0.48 m이고, 이 값이 memory ref point로 다음 프레임에 전파됩니다.',
      fix: ['회귀 출력과 reference 경로는 16bit/FP16', 'ego 변환은 CPU FP32', '긴 시퀀스에서 memory 전파 오차를 보고 필요하면 QAT'],
      verdict: '정밀도를 올려 줄이되, 누적은 긴 시퀀스로 확인해야 함',
    },
    {
      badges: ['fix'], block: 'mem',
      title: '첫 프레임에는 memory가 없음',
      issue: '첫 프레임과 장면 전환 직후에는 이전 상태가 없습니다.',
      fix: ['코드가 이미 0 패딩 + <code>prev_exists</code> + pseudo ref로 같은 shape를 유지 → <code>prev_exists</code>를 그래프 입력으로',
        '0으로 채운 슬롯을 attend하는 동작이 양자화 후에도 유지되는지 확인'],
      verdict: '그래프 분기 없이 해결',
    },
    {
      badges: ['cpu'], block: 'head',
      title: '후처리는 atan2와 결과 개수가 동적',
      issue: 'sigmoid 후 9,000 → top-k 300, score·range mask로 결과 개수가 바뀌고, ONNX에는 Atan2가 없습니다.',
      fix: ['HTP는 900개 raw 출력까지만 내고 decode는 CPU'],
      verdict: 'CPU 경계로 깔끔하게 분리됨',
    },
    {
      badges: ['work'], block: 'cross',
      title: 'V2-99 320×800은 이미지 토큰이 6,000개',
      issue: '토큰이 6 × 20 × 50 = 6,000개로 늘어 cross-attn 점수 맵이 층당 4,320만 원소(16bit 86MB)가 됩니다.',
      fix: ['R50 256×704 유지', '또는 토큰 축소: PE 상수화가 깨지고 Gather가 추가되는 정확도 trade-off'],
      verdict: '해상도 선택으로 우회',
    },
  ];
}

export const SP_LEAD = 'SA8650P HTP(v73)에 올릴 때 블록별로 메모리(DDR·VTCM), 양자화, 고정 shape, 비표준 연산을 따져 본 결과입니다. op 측면에서는 Sparse4D보다 쉽습니다. GridSample이나 deformable 같은 커스텀 op이 없고, flash attention만 표준 MHA로 바꾸면 Linear·MatMul·Softmax·LayerNorm·TopK·Gather로 전부 표현됩니다. 대신 어려움이 <b>전역 cross-attention의 메모리</b>와 <b>softmax·좌표 양자화</b>로 옮겨갑니다.';

export const SP_CAPTION = '블록 색 = 아래 표의 종합 난이도. 종합은 네 축 중 가장 어려운 축을 기본으로 하되, 상수화하거나 CPU로 보내 해소되는 축은 낮췄습니다. 3D PE + query embedding은 양자화와 비표준 연산이 어려움이지만 오프라인 상수화로 그 연산이 추론 그래프에서 사라지므로 종합은 쉬움입니다.';

export const SP_FOOT = '학습 전용 블록(denoising, FocalHead 2D 보조 head)은 export에서 제거하므로 표에서 뺐습니다. <code>torch.nan_to_num</code>도 export 시 제거합니다.';

export const SP_NOTES = [
  '<b>Sparse4D와 비교.</b> Sparse4D는 deformable aggregation 커스텀 op 쪽이 어렵고, StreamPETR는 op는 표준이지만 dense cross-attn 점수 맵(층당 3,041만 원소)의 메모리와 4,224-way softmax 양자화 쪽이 어렵습니다.',
  '<b>BEVFusion과 연결.</b> BEVFusion에서 겪은 cross-attn 텐서 DDR 왕복과 같은 구조입니다. K/V가 작아 query·head 분할만으로 정확하게 VTCM 안에 넣을 수 있으니, BEVFusion에서 이 분할 패턴을 먼저 검증하면 여기에 그대로 재사용할 수 있습니다. BEV pool 같은 scatter는 StreamPETR에 없습니다.',
];

/* ── SVG diagram ── */
export function spDiagram(block, COL) {
  const W = 1180, H = 460;
  const by = 150, bh = 96, mid = by + bh / 2;
  const arr = (x1, y1, x2, y2) => `<line class="htp-arrow" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#sp-head)"/>`;
  let g = `<defs><marker id="sp-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#64748b"/></marker>
    <marker id="sp-head-acc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#0e7490"/></marker></defs>`;
  // input
  g += `<g class="htp-in"><rect x="0" y="${by + 10}" width="96" height="${bh - 20}" rx="10"/>
    <text class="htp-bt" x="48" y="${mid - 3}" text-anchor="middle">카메라</text><text class="htp-bt" x="48" y="${mid + 15}" text-anchor="middle">이미지 ×6</text></g>`;
  g += arr(98, mid, 118, mid);
  g += block('backbone', 122, by, 112, bh, 'g', ['Backbone', '+ FPN'], 'stride 16');
  g += arr(236, mid, 256, mid);
  // decoder container
  const dx = 260, bw = 112, gap = 14, x0 = dx + 14;
  const inner = [
    ['pe', 'g', ['Query', 'embedding'], '+ memory concat'],
    ['mln', 'y', ['MLN'], '시간·ego 조건'],
    ['self', 'y', ['Hybrid', 'self-attn'], null],
    ['cross', 'r', ['전역', 'cross-attn'], '이미지 토큰 ×4,224'],
    ['self', 'y', ['FFN'], null],
  ];
  const dw = inner.length * bw + (inner.length - 1) * gap + 28;
  const dy = 96, dh = 180;
  g += `<rect class="htp-dec" x="${dx}" y="${dy}" width="${dw}" height="${dh}" rx="16"/>`;
  g += `<text class="htp-dec-t" x="${dx + 18}" y="${dy + 28}">Decoder ×6</text>`;
  g += `<text class="htp-dec-s" x="${dx + 112}" y="${dy + 28}">HTP · A16W8, softmax 16bit</text>`;
  const xs = [];
  inner.forEach(([id, lv, lines, tag], i) => {
    const x = x0 + i * (bw + gap); xs.push(x);
    g += block(id, x, by, bw, bh, lv, lines, tag);
    if (i < inner.length - 1) g += arr(x + bw + 1, mid, x + bw + gap - 1, mid);
  });
  const dRight = dx + dw;
  // head + post
  const hx = dRight + 26, hw = 112;
  g += arr(dRight + 2, mid, hx - 4, mid);
  g += block('head', hx, by, hw, bh, 'y', ['Detection', 'head'], '마지막 층만 출력');
  const px = hx + hw + 26, pw = W - px - 2;
  g += arr(hx + hw + 2, mid, px - 4, mid);
  g += block('head', px, by, pw, bh, 'c', ['후처리', '(CPU)']);
  // 3D PE (constant) above the backbone → into the cross-attn keys
  const peX = 122, peY = 14, peW = 170, peH = 52;
  g += block('pe', peX, peY, peW, peH, 'g', ['3D PE (상수)'], '4,224 × 256 · FP16');
  const cx = xs[3] + bw / 2;
  g += `<path class="htp-pe-arrow" d="M ${peX + peW + 2} ${peY + peH / 2} H ${cx - 14} Q ${cx} ${peY + peH / 2}, ${cx} ${peY + peH / 2 + 14} V ${by - 3}" marker-end="url(#sp-head-acc)"/>`;
  g += `<text class="htp-pe-t" x="${(peX + peW + cx) / 2}" y="${peY + peH / 2 - 9}" text-anchor="middle">key = 이미지 특징 + PE</text>`;
  // memory queue (CPU) loop: top-K from the head output → memory → decoder input
  const mx = 430, my = 344, mw = 360, mh = 64;
  g += block('mem', mx, my, mw, mh, 'c', ['Memory queue + ego 변환 (CPU)', '1,024 FIFO · top-K 256 · 4×4 FP32']);
  const headCx = hx + hw / 2, qCx = xs[0] + bw / 2;
  g += `<path class="htp-loop" d="M ${headCx} ${by + bh + 2} C ${headCx} ${my + mh / 2}, ${mx + mw + 70} ${my + mh / 2}, ${mx + mw + 3} ${my + mh / 2}" marker-end="url(#sp-head)"/>`;
  g += `<path class="htp-loop" d="M ${mx - 3} ${my + mh / 2} C ${qCx + 20} ${my + mh / 2}, ${qCx} ${my + 10}, ${qCx} ${by + bh + 4}" marker-end="url(#sp-head)"/>`;
  g += `<text class="htp-loop-t" x="${mx + mw / 2}" y="${my - 14}" text-anchor="middle">top-K 256을 다음 프레임 memory로 넘김</text>`;
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
  return `<svg class="htp-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="StreamPETR 추론 그래프와 블록별 HTP 포팅 난이도">${g}</svg>`;
}
