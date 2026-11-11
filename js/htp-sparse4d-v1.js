/** Sparse4D v1 content for the "04 HTP 포팅 난이도" section.
 *  Facts: vault note "Sparse4D HTP 포팅 난이도 분석" (v1 rows) + "Sparse4D v1 HTP 포팅 난이도 분석",
 *  official master-branch code/config (sparse4d_r101_H4.py, blocks.py, sparse4d_head.py), QNN docs 2026-11-09.
 *  추정 / 검증 필요 marks are kept. No latency or time-complexity numbers. */

const est = '<span class="htp-est">추정</span>';
const chk = '<span class="htp-est">검증 필요</span>';

export function rows() {
  return [
    {
      id: 'backbone', name: '이미지 백본 + FPN', sub: 'R101 + DCNv2(stage 3·4) · 640×1600 · FPN stride 8~64',
      cells: [
        ['r', 'FPN 출력만 프레임당 3,264만 원소(INT8 33MB). 입력 화소가 256×704의 5.7배'],
        ['y', `DCN offset이 좌표 회귀라 8bit에 민감할 수 있음 ${est}`],
        ['g', '6캠 × 640 × 1600 고정'],
        ['r', 'QNN 지원 op 표·HTP op 정의에 DeformConv 계열 없음'],
      ],
      overall: 'r',
      strategy: 'DCN 없는 백본으로 교체 후 재학습(정확도 확인). DCN을 유지하려면 HTP 커스텀 op',
    },
    {
      id: 'anchor', name: 'Anchor 인코딩', sub: 'k-means anchor 900 + 900×256 feature · SparseBox3DEncoder',
      cells: [
        ['g', '900×11 anchor + 900×256 feature 상수'],
        ['y', 'x·y·z가 ±수십 m라 8bit 계단이 약 0.47 m'],
        ['g', 'anchor 900개 고정 (v1은 프레임 간 instance 전파 없음)'],
        ['g', '상수 인덱스 선택은 Slice로 바꿈'],
      ],
      overall: 'g',
      strategy: 'bank는 상수로 접고, 첫 Linear 입력만 16bit. 과거 프레임 anchor도 같은 encoder를 다시 통과',
    },
    {
      id: 'keypoint', name: 'Keypoint 생성 · 카메라 투영', sub: '7 고정 + 6 학습 · 과거 3프레임은 v·Δt + T_cur2temp 재투영',
      cells: [
        ['g', '기하 텐서라 메모리 부담이 작음'],
        ['r', '미터 좌표 × exp(size)·회전, 투영행렬 값 수백~수천, 깊이 나눗셈. 과거 프레임엔 v·Δt·ego 변환이 더 붙음'],
        ['g', 'keypoint 13개 고정'],
        ['y', `회전행렬·temp anchor 원소 대입이 ScatterND로 나갈 수 있음 ${est}`],
      ],
      overall: 'y',
      strategy: 'T_cur2temp(4×4)와 Δt는 CPU에서 계산해 입력으로. 회전은 Mul/Add/Concat, 기하는 FP16',
    },
    {
      id: 'deform', name: 'Deformable aggregation', sub: 'F.grid_sample · 가중치 MLP + softmax(312-way × 8그룹)',
      cells: [
        ['r', '레벨당 출력 1,797만 원소, 4레벨 × 4프레임이면 층마다 2억 8,752만(INT8 288MB)'],
        ['r', 'GridSample은 입력·grid가 같은 비트폭. stride-8(폭 200)에서 8bit grid 0.78 px, softmax 312-way'],
        ['g', '900 × 13 × 6 × 4 정적'],
        ['y', `v1은 CUDA 확장 없이 F.grid_sample을 써서 ONNX GridSample로 나감. 6~7차원 reshape·permute는 rank 정리 필요 ${chk}`],
      ],
      overall: 'r',
      strategy: '층당 GridSample 16회(4레벨 × 4프레임), 6층 96회. 앵커 청크 분할로 중간 텐서 축소',
    },
    {
      id: 'queue', name: '특징 큐 H=4 + 시간 융합', sub: '과거 3프레임 FPN 보관 · LinearFusion(0.9^|10Δt|, Linear 512→256)',
      cells: [
        ['r', '4프레임 특징 1억 3,056만 원소(INT8 131MB)가 DDR에 상주, 샘플링도 프레임 수만큼'],
        ['r', '과거 프레임 keypoint에 v·Δt 이동과 ego 변환이 추가로 붙음'],
        ['y', '처음 3프레임은 큐 길이가 0~3이라 파이썬 루프 횟수가 바뀜'],
        ['y', '큐 insert·pop은 파이썬 리스트. 융합은 Pow·Mul·Concat·Linear'],
      ],
      overall: 'r',
      strategy: '과거 FPN은 CPU가 링버퍼로 관리해 매 프레임 그래프 입력으로. 첫 프레임 처리 방식은 별도로 정함',
    },
    {
      id: 'depth', name: 'Depth reweight', sub: '깊이 bin 12개(1~56 m, 5 m 간격) · topk(2) · softmax',
      cells: [
        ['g', '900 × 13 × 12 수준의 작은 텐서'],
        ['y', 'anchor xy 거리(미터)로 bin 가중치를 만들고 12-way softmax와 곱함'],
        ['g', 'bin 12개 고정'],
        ['y', 'norm·clip·topk(2)·where·pow 조합'],
      ],
      overall: 'y',
      strategy: `bin 간격 = 보간 폭이라 topk(2)+where는 ReLU(1 − |d − bin|/5)와 같은 값 ${chk}. 거리 계산은 FP16`,
    },
    {
      id: 'attn', name: 'Self-attn + FFN', sub: 'MHA 8헤드 · FFN 512 · LN (temporal cross-attn 없음)',
      cells: [
        ['y', 'attn 맵 900 × 900 × 8 = 648만 원소(INT8 6.5MB)로 VTCM 예약 4MB 초과'],
        ['y', '900키 softmax·LN, 일반 트랜스포머 PTQ 수준'],
        ['g', 'query 900 고정'],
        ['g', 'MHA · FFN · LN 모두 HTP 기본 op'],
      ],
      overall: 'y',
      strategy: 'A16W8 + softmax 16bit, 필요하면 head 단위 분할',
    },
    {
      id: 'refine', name: 'Refinement head', sub: 'reg + cls 10 · 속도 = translation / Δt',
      cells: [
        ['g', '900개 query의 작은 회귀·분류 출력'],
        ['r', 'residual을 미터 anchor에 더해 다음 층 anchor가 됨. Δt가 0이면 기본값 0.5 s'],
        ['g', '900 고정'],
        ['y', `output[..., XYZWLH] 등 원소 대입이 ScatterND로 나갈 수 있음 ${est}`],
      ],
      overall: 'y',
      strategy: 'Slice + Add + Concat으로 재작성, 덧셈은 FP16, 1/Δt는 CPU에서 곱셈 입력으로',
    },
    {
      id: 'post', name: '후처리', sub: 'sigmoid · top-k 300 · decode',
      cells: [
        ['g', '마지막 층 900개 출력만 받음'],
        ['y', 'INT8 점수는 동률로 순위가 바뀔 수 있음'],
        ['r', 'score threshold를 쓰면 결과 개수가 동적'],
        ['y', 'ONNX에 Atan2 op 없음'],
      ],
      overall: 'c', overallText: '쉬움 (CPU)',
      strategy: 'HTP는 raw 900개(FP16)까지만 내고 나머지는 CPU',
    },
  ];
}

export function cards() {
  return [
    {
      badges: ['trade'], block: 'backbone',
      title: 'DCNv2 백본은 HTP에 해당 op이 없음',
      issue: 'stage 3·4의 DCNv2가 QNN 지원 op 표와 HTP op 정의에 없습니다. 입력도 640×1600으로 커서 FPN만 프레임당 3,264만 원소입니다.',
      fix: ['DCN 없는 백본(같은 R101 또는 v2·v3의 R50 256×704)으로 바꾸고 재학습',
        `DCN을 유지하려면 HTP 커스텀 op package(QHPI / legacy). offset 좌표의 8bit 민감도도 함께 봐야 함 ${est}`],
      verdict: '대체는 가능하지만 재학습과 정확도 재검증이 따라오는 문제',
    },
    {
      badges: ['work'], block: 'queue',
      title: '특징 큐 131MB가 DDR에 상주하고 프레임마다 4번 샘플링',
      issue: '현재 + 과거 3프레임 FPN이 1억 3,056만 원소(INT8 131MB)입니다. 매 층 4레벨 × 4프레임 = 16번 GridSample을 돌려 층당 중간 텐서가 2억 8,752만 원소입니다.',
      fix: ['과거 FPN은 CPU가 링버퍼로 관리하고 그래프 입력(DDR)으로 전달. 현재 프레임 FPN만 새로 계산',
        `앵커 청크 분할로 중간 텐서를 줄임. 보이는 캠 2개 기준 DDR 읽기 상한은 v2·v3의 약 96MB/층 × 4프레임 ${est}`,
        '프레임 수를 줄이는 H=1 config도 있지만 논문 Table 4 기준 T=4 → T=1이면 mAP 0.436 → 0.382, NDS 0.541 → 0.451'],
      verdict: '줄일 수는 있어도 없앨 수는 없음. v2의 recurrent instance(600개, 16bit 약 0.3MB)가 이 문제를 구조적으로 없앤 버전',
    },
    {
      badges: ['work'], block: 'queue',
      title: '처음 3프레임은 시간 융합 그래프가 달라짐',
      issue: '큐 길이가 0~3으로 바뀌면 파이썬 루프 횟수가 달라집니다. LinearFusion은 Linear(concat)이라 0 특징을 넣어도 "건너뛰기"와 같아지지 않습니다.',
      fix: ['큐 길이별 그래프 4개(0~3)를 한 context binary에 넣고 CPU가 선택',
        `또는 처음 몇 프레임은 현재 프레임 특징을 복제해 채움 (정확도 영향 ${chk})`],
      verdict: '그래프를 나누면 동작은 같게 유지됨',
    },
    {
      badges: ['trade'], block: 'deform',
      title: 'GridSample은 입력과 grid의 비트폭이 같아야 함',
      issue: `HTP op 표에는 UFIXED8끼리, UFIXED16끼리만 있습니다(혼합 조합은 미지원으로 가정 ${est}). v1의 가장 넓은 stride-8 레벨(폭 200)에서 8bit grid 계단은 0.78 px입니다.`,
      fix: ['둘 다 16bit: 정밀도는 확보되지만 131MB 특징 큐도 16bit가 되어 DDR 트래픽 2배',
        `절충: stride-8 레벨만 16bit로 두고 나머지는 8bit (${chk})`],
      verdict: '정밀도와 DDR 대역 사이에서 고르는 문제. v1은 큐 때문에 v2·v3보다 부담이 4배',
    },
    {
      badges: ['fix'], block: 'deform',
      title: '312-way softmax를 프레임마다 다시 계산',
      issue: '6캠 × 4레벨 × 13점 = 312개에 퍼지면 평균 0.0032로 INT8 한 계단(0.0039)보다 작습니다. v1은 use_temporal_anchor_embed=True라 과거 프레임마다 가중치 MLP와 softmax를 다시 돌립니다.',
      fix: ['softmax 출력과 가중합 weights를 16bit로', 'HTP Softmax는 마지막 축만 지원하므로 transpose로 축을 맞춤'],
      verdict: '16bit로 두면 해결. 층당 224만 원소 × 4프레임',
    },
    {
      badges: ['fix'], block: 'keypoint',
      title: '미터 기하와 과거 프레임 재투영',
      issue: 'keypoint, 투영, 깊이 나눗셈, refine residual에 더해 과거 프레임은 v·Δt 이동과 T_cur2temp(4×4) 변환이 붙습니다.',
      fix: ['T_cur2temp와 Δt는 CPU에서 FP32로 계산해 그래프 입력으로 (원래도 파이썬에서 계산)',
        '기하 구간은 FP16 또는 16bit 섬으로 디코더 그래프 안에 유지'],
      verdict: 'INT8만 안 쓰면 해결. 혼합 정밀도 PTQ로 기하 구간만 FP16/16bit',
    },
    {
      badges: ['fix'], block: 'depth',
      title: 'Depth reweight의 topk(2)·where·pow',
      issue: '깊이 bin 12개(1~56 m, 5 m 간격)에서 선형 보간 가중치를 만들고 상위 2개만 남긴 뒤 12-way softmax와 곱합니다.',
      fix: [`bin 간격과 보간 폭이 같아 상위 2개 = 양수 가중치 2개. ReLU(1 − |d − bin|/5)로 topk 없이 같은 값 ${chk}`,
        'scale = w₁² + w₂²은 Mul/Add로, 거리·clip은 FP16'],
      verdict: 'export 전 수식 정리로 해결',
    },
    {
      badges: ['fix'], block: 'refine',
      title: 'in-place 원소 대입은 ScatterND',
      issue: `회전행렬(new_zeros 후 대입), temp anchor, refine 출력의 원소 대입은 ONNX ScatterND로 나갈 수 있습니다 ${est}.`,
      fix: ['원소 대입을 Slice / Concat 식으로 재작성 (수학적으로 동일)'],
      verdict: 'export 전 코드 정리로 해결',
    },
    {
      badges: ['cpu'], block: 'post',
      title: '후처리는 CPU',
      issue: 'sigmoid 후 900 × 10에서 top-k 300을 고르고 decode합니다. score threshold를 쓰면 개수가 동적이고, ONNX에는 Atan2가 없습니다.',
      fix: ['HTP는 raw 900개 출력(FP16)까지만 내고 top-k·decode는 CPU'],
      verdict: 'CPU 경계 데이터는 900개 출력뿐',
    },
    {
      badges: ['assume'], block: 'attn',
      title: '활성값 per-channel 양자화와 VTCM 크기는 문서에서 미확인',
      issue: 'Conv2d·MatMul 양자화 표에는 per-axis가 가중치·bias에만 있습니다. SA8650P 최대 VTCM 크기도 공개되지 않았습니다.',
      fix: ['LinearFusion의 concat(현재 + decay 곱한 과거 특징)은 per-tensor 스케일을 공유한다고 보고 설계', '<code>vtcm_mb</code>를 명시하고 프로파일로 확인'],
      verdict: '안전한 쪽(per-tensor)을 기본 가정으로',
    },
  ];
}

export const LEAD = 'SA8650P HTP(v73)에 올릴 때 블록별로 메모리(DDR·VTCM), 양자화, 고정 shape, 비표준 연산을 따져 본 결과입니다. v1은 Sparse4D 세 버전 중 가장 어렵습니다. 디코더 구조는 v2·v3와 비슷하지만, <b>DCNv2 백본</b>(HTP에 op 없음)과 과거 3프레임 FPN을 들고 다니는 <b>특징 큐 H=4</b>(INT8 131MB, 층마다 GridSample 16회)가 더해집니다.';

export const CAPTION = '블록 색 = 아래 표의 종합 난이도. 종합은 네 축 중 가장 어려운 축을 기본으로 하되, CPU로 보내 해소되는 후처리의 동적 shape는 낮췄습니다. 점선 경로는 현재 프레임 FPN이 큐에 들어가 다음 프레임부터 과거 특징으로 다시 샘플링되는 흐름입니다.';

export const FOOT = 'v1 추론 그래프에는 학습 전용 분기가 거의 없습니다. GridMask 증강은 <code>self.training</code>일 때만 동작하고, dropout도 추론에서 꺼집니다. 출처: 공식 master 브랜치 config(<code>sparse4d_r101_H4.py</code>)와 코드.';

export const NOTES = [
  '<b>v2·v3와 비교.</b> v2부터 백본이 R50 256×704로 바뀌고, 이미지 특징 큐(131MB) 대신 instance 600개(16bit 약 0.3MB)를 전파하며, 현재 프레임만 샘플링합니다. 그래서 v1의 두 어려운 블록(DCN 백본, 특징 큐)이 v2에서 사라지고, 남는 어려움은 deformable aggregation과 미터 기하 두 군데입니다.',
  '<b>권장.</b> 포팅 대상은 v3이고, v1은 구조 비교와 정확도 기준선 용도로 보는 것이 현실적입니다. v1을 꼭 올린다면 DCN 없는 백본으로 재학습하고, 큐는 CPU 링버퍼 + 그래프 입력으로 처리합니다.',
];

export function diagram(block, COL) {
  const W = 1180, H = 440;
  const by = 110, bh = 96, mid = by + bh / 2;
  const arr = (x1, y1, x2, y2) => `<line class="htp-arrow" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#v1-head)"/>`;
  let g = `<defs><marker id="v1-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#64748b"/></marker></defs>`;
  g += `<g class="htp-in"><rect x="0" y="${by + 10}" width="96" height="${bh - 20}" rx="10"/>
    <text class="htp-bt" x="48" y="${mid - 3}" text-anchor="middle">카메라</text><text class="htp-bt" x="48" y="${mid + 15}" text-anchor="middle">이미지 ×6</text></g>`;
  g += arr(98, mid, 118, mid);
  const bbx = 122, bbw = 124;
  g += block('backbone', bbx, by, bbw, bh, 'r', ['R101-DCNv2', '+ FPN'], 'stride 8~64');
  const dx = 270, dy = 50, dh = 190, bw = 108, gap = 12, x0 = dx + 14;
  g += arr(bbx + bbw + 2, mid, dx - 4, mid);
  const inner = [
    ['anchor', 'g', ['Anchor', '인코딩'], null],
    ['keypoint', 'y', ['Keypoint ·', '카메라 투영'], '+ 과거 프레임'],
    ['deform', 'r', ['Deformable', 'aggregation'], '× 4프레임'],
    ['depth', 'y', ['Depth', 'reweight'], null],
    ['attn', 'y', ['Self-attn', '+ FFN'], null],
    ['refine', 'y', ['Refinement', 'head'], null],
  ];
  const dw = inner.length * bw + (inner.length - 1) * gap + 28;
  g += `<rect class="htp-dec" x="${dx}" y="${dy}" width="${dw}" height="${dh}" rx="16"/>`;
  g += `<text class="htp-dec-t" x="${dx + 18}" y="${dy + 30}">Decoder ×6</text>`;
  g += `<text class="htp-dec-s" x="${dx + dw - 18}" y="${dy + 30}" text-anchor="end">A16W8, 기하 구간 FP16</text>`;
  const xs = [];
  inner.forEach(([id, lv, lines, tag], i) => {
    const x = x0 + i * (bw + gap); xs.push(x);
    g += block(id, x, by, bw, bh, lv, lines, tag);
    if (i < inner.length - 1) g += arr(x + bw + 1, mid, x + bw + gap - 1, mid);
  });
  const px = dx + dw + 26;
  g += arr(dx + dw + 2, mid, px - 4, mid);
  g += block('post', px, by, W - px - 2, bh, 'c', ['후처리', '(CPU)']);
  // feature queue
  const qx = 330, qy = 300, qw = 340, qh = 64;
  g += block('queue', qx, qy, qw, qh, 'r', ['특징 큐 H=4 (과거 3프레임 FPN)', 'DDR 상주 · INT8 131MB']);
  const bcx = bbx + bbw / 2, dcx = xs[2] + bw / 2;
  g += `<path class="htp-loop" d="M ${bcx} ${by + bh + 2} C ${bcx} ${qy + qh / 2}, ${qx - 70} ${qy + qh / 2}, ${qx - 3} ${qy + qh / 2}" marker-end="url(#v1-head)"/>`;
  g += `<path class="htp-loop" d="M ${dcx} ${qy - 2} V ${by + bh + 4}" marker-end="url(#v1-head)"/>`;
  g += `<text class="htp-loop-t" x="${qx + qw + 18}" y="${qy + qh / 2 - 6}">현재 FPN을 넣고 가장 오래된 프레임을 pop</text>`;
  g += `<text class="htp-loop-t" x="${qx + qw + 18}" y="${qy + qh / 2 + 14}">층마다 4레벨 × 4프레임 GridSample</text>`;
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
  return `<svg class="htp-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="Sparse4D v1 추론 그래프와 블록별 HTP 포팅 난이도">${g}</svg>`;
}
