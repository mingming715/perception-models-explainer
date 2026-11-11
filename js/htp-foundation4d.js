/** Foundation4D content for the "04 HTP 포팅 난이도" section.
 *  Facts: arXiv 2610.30340 (NVIDIA, Sec. 3–5, 4.3, 7.5.2) + DINOv2 ViT-L/14 public config + QNN docs 2026-11-09.
 *  Window size follows the paper's evaluation setting (6 cameras × 8 timestamps).
 *  추정 / 검증 필요 marks are kept. No latency or time-complexity numbers. */

const est = '<span class="htp-est">추정</span>';
const chk = '<span class="htp-est">검증 필요</span>';

export function rows() {
  return [
    {
      id: 'enc', name: '이미지 인코더', sub: 'DINOv2 ViT-L/14 · 1036×1036 → 74×74 패치 · 폭 1,024',
      cells: [
        ['r', '이미지당 5,476 토큰. attn 맵 헤드당 3,000만 원소(16bit 60MB), ViT-L 16헤드면 층당 4.8억. 창 하나에 48장'],
        ['r', '5,476-way softmax 평균 0.00018 < INT8 계단 0.0039, LN·GELU'],
        ['g', '1036×1036 고정, 위치 임베딩은 상수'],
        ['g', 'MatMul · Softmax · LayerNorm · GELU 모두 HTP 지원'],
      ],
      overall: 'r',
      strategy: 'A16W8 + softmax 16bit, query·K/V 블록 분할. 이미지마다 독립이라 겹치는 창에서 이미지 단위로 재사용',
    },
    {
      id: 'agg', name: '시공간 aggregator', sub: '16층 · 이미지 내 attn + 카메라/시간 그룹 attn 교대 · 37×37 + 6 토큰',
      cells: [
        ['r', '시간 그룹(T=8) 11,000 토큰 → attn 맵 헤드당 1억 2,100만(16bit 242MB), K/V 각 16bit 22.5MB로 VTCM 초과'],
        ['r', '11,000-way softmax 평균 0.000091 = INT8 계단의 1/43'],
        ['y', '창 크기 T·C를 고정하면 정적. 스트리밍이면 창마다 전체 재계산'],
        ['y', 'FlashAttention-3와 2D RoPE 커스텀 CUDA 커널 → 표준 MHA로 재작성'],
      ],
      overall: 'r',
      strategy: '표준 MHA, RoPE는 상수 cos/sin 표로 Mul/Add, K/V까지 블록 분할(online softmax 분해), softmax 16bit',
    },
    {
      id: 'cam', name: 'Camera heads (rig · ego)', sub: 'rig·ego 토큰 → transformer head → translation + quaternion',
      cells: [
        ['g', 'rig·ego 토큰만 읽는 작은 transformer'],
        ['y', '미터 translation과 quaternion 회귀. 학습에서도 geometry decoder는 FP32 유지(논문 4.3)'],
        ['g', '카메라 6 · timestamp 고정'],
        ['g', 'transformer + MLP'],
      ],
      overall: 'g',
      strategy: 'HTP A16W8 + 출력 16bit. quaternion → 회전, w2c → c2w, pose 합성은 CPU FP32',
    },
    {
      id: 'dpt', name: 'DPT 기하 decoder', sub: 'depth · 보조 semantic(21클래스) · 518×518 출력',
      cells: [
        ['y', '이미지당 518×518, 창 48장이면 채널당 1,288만 원소'],
        ['y', 'metric depth·confidence 회귀. 학습에서도 FP32 유지(논문 4.3)라 FP16 이상 권장'],
        ['g', '출력 격자 고정'],
        ['g', 'Conv · TransposeConv2d · Resize, HTP 지원'],
      ],
      overall: 'y',
      strategy: 'depth·semantic decoder만 HTP(출력 FP16). aux pointmap은 추론에서 안 씀. unprojection은 CPU 또는 상수 ray 표',
    },
    {
      id: 'det', name: 'FPN + Detection decoder', sub: 'DETR3D식 · query 900 · 6층 · 폭 256 · multi-scale deformable',
      cells: [
        ['y', `FPN이 74×74 고해상도 특징과 37×37 문맥 특징을 합침. 레벨·채널 수는 논문에 없음 ${chk}`],
        ['r', 'query가 미터 3D offset을 내고 렌즈 모델로 투영, 카메라·스케일·점 가중치 softmax'],
        ['g', 'query 900 · 6층 · 폭 256 고정'],
        ['r', 'deformable cross-attn → GridSample 분해 필요(Sparse4D와 같은 문제)'],
      ],
      overall: 'r',
      strategy: `레벨별 GridSample + query 청크, 투영·offset은 FP16. 차량에선 마지막 timestamp만 decode ${est}`,
    },
    {
      id: 'bev', name: 'BEV projector', sub: 'BEV 셀마다 pillar 4점 · self-attn + deformable cross-attn',
      cells: [
        ['y', `BEV 격자 해상도·층 수는 논문에 없음 ${chk}`],
        ['y', '정규화된 3D 기준점 좌표로 query·위치 임베딩 생성'],
        ['g', 'BEV 격자·pillar 4점 고정'],
        ['r', 'deformable cross-attn → GridSample. 정적 extrinsic이라 기준점 투영은 상수'],
      ],
      overall: 'r',
      strategy: '기준점 투영 좌표는 오프라인 상수로 접고, offset·가중치만 그래프에서. GridSample 분해',
    },
    {
      id: 'occ', name: 'Occupancy heads', sub: 'TransposeConv 업샘플 · channel-to-height · 600×300×40 (0.2 m)',
      cells: [
        ['r', '720만 voxel × 내부 라벨 10클래스 = logits 7,200만(INT8 72MB)/timestamp'],
        ['y', 'INT8 logits는 클래스 간 동률이 생길 수 있음'],
        ['g', '격자 고정, channel-to-height는 Reshape'],
        ['g', 'TransposeConv2d · Reshape · ArgMax 모두 HTP 지원'],
      ],
      overall: 'y', note: '그래프 안에서 ArgMax까지 하면 메모리 축이 풀림',
      strategy: 'threshold + ArgMax를 그래프 안에서 → uint8 라벨 720만(7.2MB)만 출력',
    },
    {
      id: 'gs', name: 'Gaussian 재구성 + 영상 단위 처리', sub: '미분 가능 splatting · 창 stitching / PGO · offline tracker',
      cells: [
        ['r', 'decoder 출력 픽셀마다 Gaussian 1개, 창 48장이면 1,288만 개'],
        ['r', '학습에서도 Gaussian decoder는 FP32 유지(논문 4.3)'],
        ['r', '트랙·창 개수가 동적, PGO는 영상 전체'],
        ['r', '래스터화(splatting), L-BFGS PGO, RTS 역방향 smoother'],
      ],
      overall: 'c', overallText: '제외 (오프라인)',
      strategy: `차량 그래프에서 제외, 재구성·NuRec·자동 라벨링은 서버에서. 온라인 tracking은 순방향 Kalman으로 ${est}`,
    },
  ];
}

export function cards() {
  return [
    {
      badges: ['assume'], block: 'enc',
      title: '모델 전체를 그대로 차량 HTP에 올리는 구성은 아님',
      issue: `ViT-L/14(DINOv2 공개값 약 3억 파라미터)와 aggregator 16층(ViT-L급 블록 32개면 약 4억 ${est})에 decoder 여러 개가 붙고, 창마다 6캠 × T장의 1036² 이미지를 처리합니다. 논문 runtime 측정도 H100 기준입니다.`,
      fix: [`가중치만 INT8로 7억 바이트 이상이 DDR에 상주 ${est}`,
        `차량에는 distill한 student(Sparse4D v3·StreamPETR급)를 올리고, Foundation4D는 서버에서 teacher·자동 라벨링·NuRec prior로 쓰는 분리 ${est}`],
      verdict: '포팅 난이도보다 먼저 어디에 둘지(차량 / 서버)를 정해야 하는 모델',
    },
    {
      badges: ['work'], block: 'enc',
      title: 'ViT-L 인코더 attention: 이미지당 5,476 토큰',
      issue: 'attn 맵이 헤드당 3,000만 원소(16bit 60MB)이고 ViT-L 표준 16헤드면 층당 4.8억입니다. K/V도 이미지당 각 561만 원소(16bit 11.2MB)라 VTCM(4~8MB)에 안 들어갑니다.',
      fix: ['query 청크 + K/V 블록 분할. K/V가 VTCM을 넘으므로 StreamPETR와 달리 블록마다 max·합을 다시 맞추는 online softmax 분해(ReduceMax · Exp · Mul · Add)가 필요',
        '입력을 518²로 낮추면 37×37 패치로 토큰이 1/4이지만 재학습·정확도 확인 필요'],
      verdict: '분할은 가능하지만 노드 수가 크게 늘고, 해상도 축소는 정확도 trade-off',
    },
    {
      badges: ['work'], block: 'agg',
      title: '카메라·시간 그룹 attention은 토큰 8,250 / 11,000',
      issue: '층마다 카메라 그룹(6 × 1,375 = 8,250 토큰)과 시간 그룹(T=8이면 8 × 1,375 = 11,000 토큰)이 번갈아 나옵니다. 시간 그룹 attn 맵은 헤드당 1억 2,100만 원소(16bit 242MB), K/V는 각 16bit 22.5MB입니다.',
      fix: ['인코더와 같은 K/V 블록 분할 + online softmax 분해',
        'T를 줄이면 토큰이 비례해 줄지만, 논문 결론대로 창이 길수록 detection이 좋아지는 trade-off',
        '스트리밍이면 창이 겹쳐도 aggregator는 창 전체를 다시 계산 (인코더 출력은 이미지 단위로 재사용 가능)'],
      verdict: 'StreamPETR·BEVFusion의 cross-attn 분할 패턴을 쓰되 K/V까지 쪼개야 하는 상위 난도',
    },
    {
      badges: ['trade'], block: 'agg',
      title: '수천~수만-way softmax와 ViT 활성값',
      issue: '평균 확률이 5,476-way 0.00018, 8,250-way 0.00012, 11,000-way 0.000091로 INT8 한 계단(0.0039)보다 약 20~40배 작습니다. 논문도 학습에서 수치 민감 연산은 FP32로 유지했습니다.',
      fix: ['attention 확률·LN은 16bit, 인코더·aggregator는 A16W8',
        `ViT 활성값 이상치(outlier)는 PTQ에서 자주 문제가 됨 ${est}. AIMET 혼합 정밀도로 층별 민감도 확인`],
      verdict: '16bit로 정밀도는 확보. 16bit softmax의 성능 비용은 실측 필요',
    },
    {
      badges: ['fix'], block: 'agg',
      title: 'FlashAttention-3와 2D RoPE 커스텀 CUDA 커널',
      issue: 'aggregator attention은 H100용 FA3로, 2D RoPE는 packed QKV에 직접 적용하는 커스텀 CUDA 커널로 구현돼 있습니다.',
      fix: ['표준 MHA(MatMul → Softmax → MatMul)로 교체',
        '패치 위치가 고정이라 cos/sin 표를 상수로 두고 Mul/Add로 RoPE 재작성',
        `QNN RotaryEmbedding은 HTP FP16·INT16·INT8 YES지만 ONNX RotaryEmbedding은 1D 위치 기준이라 2D 적용은 ${chk}`],
      verdict: 'export 전 모델 정리로 해결',
    },
    {
      badges: ['work'], block: 'det',
      title: 'Detection·BEV의 deformable cross-attention',
      issue: 'DETR3D식 decoder(query 900, 6층)와 BEV projector가 3D 샘플 점을 카메라에 투영해 다중 스케일 특징을 샘플링합니다. Sparse4D deformable aggregation과 같은 GridSample 문제(DDR 랜덤 읽기, 입력·grid 동일 비트폭)가 두 군데서 나옵니다.',
      fix: ['레벨별 GridSample + Mul + ReduceSum으로 분해하고 query 청크로 중간 텐서 축소',
        'BEV는 기준점과 정적 extrinsic이 고정이라 투영 좌표를 오프라인 상수로 접음',
        `차량에서는 마지막 timestamp만 decode ${est}`],
      verdict: 'Sparse4D 분해 방안(A → B/C → D)을 그대로 재사용',
    },
    {
      badges: ['work'], block: 'det',
      title: 'f-theta 렌즈 모델 투영',
      issue: `내부 데이터는 다항식 f-theta 카메라 6대입니다. 3D 점을 투영하려면 광축과의 각도를 구해 다항식에 넣어야 해서 각도 계산(atan 계열)이 필요합니다 ${est}.`,
      fix: ['BEV처럼 기준점이 고정이면 투영 결과를 상수 표로',
        `detection offset 투영은 FP16 구간에서 다항식을 Mul/Add로. 각도 계산 op의 HTP 지원은 ${chk}`],
      verdict: '고정된 부분은 상수화, 나머지는 FP16 구간',
    },
    {
      badges: ['fix'], block: 'occ',
      title: 'Occupancy 출력이 timestamp당 logits 7,200만',
      issue: '600 × 300 × 40 = 720만 voxel에 내부 라벨 10클래스면 semantic logits가 7,200만 원소(INT8 72MB)입니다.',
      fix: ['sigmoid threshold와 ArgMax(HTP FP16·INT16·INT8 지원)를 그래프 안에서 → uint8 라벨 720만(7.2MB)만 출력',
        `차량 용도면 마지막 timestamp만 occupancy head 실행 ${est}`],
      verdict: '출력 형식을 바꾸면 해결',
    },
    {
      badges: ['cpu'], block: 'dpt',
      title: '기하 decode: quaternion·pose 합성·unprojection',
      issue: 'rig·ego head는 world-to-camera translation·quaternion을 내고, 이를 camera-to-world로 바꿔 합성한 뒤 렌즈 왜곡을 고려해 depth를 unproject합니다.',
      fix: ['pose 변환·합성은 CPU FP32 (행렬이 작음)',
        '캘리브레이션이 고정이면 픽셀별 unit ray(518×518 × 6캠)를 상수 표로 두고 depth × ray만 계산'],
      verdict: 'CPU와 상수 표로 깔끔하게 분리됨',
    },
    {
      badges: ['cpu'], block: 'gs',
      title: 'Gaussian 재구성 · 창 stitching · PGO · offline tracker',
      issue: '미분 가능 splatting, L-BFGS 기반 PGO, 두 번 돌리는 tracker와 RTS 역방향 smoother는 영상 전체를 보는 오프라인 처리입니다.',
      fix: ['차량 그래프에서 제외하고 서버(재구성·시뮬레이션·자동 라벨링)에서 실행',
        `차량 tracking은 순방향 Kalman만 쓰는 온라인 tracker로 대체 ${est}`],
      verdict: '온라인 인지에는 필요 없는 구성',
    },
  ];
}

export const LEAD = 'SA8650P HTP(v73)에 올릴 때 블록별로 메모리(DDR·VTCM), 양자화, 고정 shape, 비표준 연산을 따져 본 결과입니다. Foundation4D는 VGGT 계열 기하 foundation model에 detection·occupancy·Gaussian head를 붙인 통합 모델이라, 대부분의 블록이 차량용 실시간 그래프를 전제로 설계되지 않았습니다. 가장 어려운 곳은 <b>ViT-L 인코더와 시공간 aggregator의 attention 규모</b>, 그리고 detection·BEV의 <b>deformable 샘플링</b>입니다. Gaussian 재구성과 영상 단위 처리는 오프라인 전용입니다.';

export const CAPTION = '블록 색 = 아래 표의 종합 난이도. 종합은 네 축 중 가장 어려운 축을 기본으로 하되, 그래프 안 ArgMax로 해소되는 occupancy 출력 메모리는 낮췄습니다. 회색 점선 블록은 CPU 또는 오프라인입니다. 규모는 논문 평가 설정(6캠 × 8 timestamp)으로 계산했고, aggregator 헤드 수는 논문에 없어 헤드당 값으로 적었습니다.';

export const FOOT = '학습 전용(query denoising, YOLOX식 2D 보조 head, BEV segmentation 보조 head)은 export에서 제거합니다. aux pointmap decoder도 최종 pointmap을 depth와 pose로 만들기 때문에 추론에서는 쓰지 않습니다. 출처: arXiv 2610.30340 3~5장·4.3절.';

export const NOTES = [
  '<b>Sparse4D·StreamPETR와 비교.</b> detection decoder는 Sparse4D와 같은 deformable 샘플링 문제를, 백본은 StreamPETR의 attention 점수 맵 문제를 훨씬 큰 규모로 함께 갖습니다. StreamPETR는 K/V(16bit 2.2MB)가 VTCM에 들어가 query·head 분할만으로 끝나지만, Foundation4D는 K/V(16bit 11.2~22.5MB)까지 쪼개야 합니다.',
  `<b>배치 제안.</b> 차량 HTP에는 Sparse4D v3나 StreamPETR급 모델을 두고, Foundation4D는 서버에서 depth·occupancy 자동 라벨링, NuRec 재구성 prior, distillation teacher로 쓰는 쪽이 현실적입니다 ${est}.`,
];

export function diagram(block, COL) {
  const W = 1180, H = 500;
  const rh = 60, rowY = [24, 108, 192, 276, 360];
  const mid = (i) => rowY[i] + rh / 2;
  const arr = (x1, y1, x2, y2) => `<line class="htp-arrow" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#f4-head)"/>`;
  let g = `<defs><marker id="f4-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#64748b"/></marker>
    <marker id="f4-head-acc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#0e7490"/></marker></defs>`;
  const cy = mid(2);
  // trunk
  g += `<g class="htp-in"><rect x="0" y="${cy - 34}" width="92" height="68" rx="10"/>
    <text class="htp-bt" x="46" y="${cy - 4}" text-anchor="middle">카메라 6 × T</text><text class="htp-bt" x="46" y="${cy + 15}" text-anchor="middle">1036²</text></g>`;
  g += arr(94, cy, 112, cy);
  const ex = 116, ew = 124, eh = 92;
  g += block('enc', ex, cy - eh / 2, ew, eh, 'r', ['Image encoder', 'ViT-L/14'], '74×74 패치');
  const ax = 266, ay = 146, aw = 268, ah = 152;
  g += arr(ex + ew + 2, cy, ax - 4, cy);
  g += `<rect class="htp-dec" x="${ax}" y="${ay}" width="${aw}" height="${ah}" rx="16"/>`;
  g += `<text class="htp-dec-t" x="${ax + 16}" y="${ay + 24}">Aggregator ×16</text>`;
  g += `<text class="htp-dec-s" x="${ax + aw - 14}" y="${ay + 24}" text-anchor="end">37×37 + 6 토큰</text>`;
  g += block('agg', ax + 14, ay + 40, 112, 98, 'r', ['이미지 내', 'attention'], '1,375 토큰');
  g += arr(ax + 128, ay + 89, ax + 138, ay + 89);
  g += block('agg', ax + 142, ay + 40, 112, 98, 'r', ['카메라·시간', 'group attn'], '층마다 교대');
  // bus to branches
  const busX = 552, bx = 576;
  g += arr(ax + aw + 2, cy, busX, cy);
  g += `<line class="htp-arrow" x1="${busX}" y1="${mid(0)}" x2="${busX}" y2="${mid(4)}"/>`;
  [0, 1, 2, 4].forEach((i) => { g += arr(busX, mid(i), bx - 4, mid(i)); });
  const cpuX = 880, cpuW = W - cpuX - 2;
  // row A: camera heads
  g += block('cam', bx, rowY[0], 250, rh, 'g', ['Camera heads (rig · ego)'], 'translation + quaternion');
  g += arr(bx + 252, mid(0), cpuX - 4, mid(0));
  g += block('cam', cpuX, rowY[0], cpuW, rh, 'c', ['pose 합성 · w2c→c2w (CPU)']);
  // row B: DPT
  g += block('dpt', bx, rowY[1], 250, rh, 'y', ['DPT 기하 decoder'], 'depth · semantic · 518×518');
  g += arr(bx + 252, mid(1), cpuX - 4, mid(1));
  g += block('dpt', cpuX, rowY[1], cpuW, rh, 'c', ['unprojection · 렌즈 모델 (CPU)']);
  // row C: FPN → detection → post
  const fw = 100, dX = 700, dW = 156;
  g += block('det', bx, rowY[2], fw, rh, 'r', ['FPN'], '74² + 37²');
  g += arr(bx + fw + 2, mid(2), dX - 4, mid(2));
  g += block('det', dX, rowY[2], dW, rh, 'r', ['Detection decoder ×6'], 'deformable · 900');
  g += arr(dX + dW + 2, mid(2), cpuX - 4, mid(2));
  g += block('det', cpuX, rowY[2], cpuW, rh, 'c', ['후처리 · tracking (CPU)']);
  // row D: BEV → occupancy (fed by FPN)
  g += `<path class="htp-loop-solid" d="M ${bx + 70} ${rowY[2] + rh + 2} V ${mid(3) - 12} Q ${bx + 70} ${mid(3)}, ${bx + 82} ${mid(3)} H ${dX - 4}" marker-end="url(#f4-head)"/>`;
  g += block('bev', dX, rowY[3], dW, rh, 'r', ['BEV projector'], 'pillar 4점 · deformable');
  g += arr(dX + dW + 2, mid(3), cpuX - 4, mid(3));
  g += block('occ', cpuX, rowY[3], cpuW, rh, 'y', ['Occupancy heads'], '600×300×40 · ArgMax');
  // row E: gaussian / video (offline)
  g += block('gs', bx, rowY[4], W - bx - 2, rh, 'c', ['Gaussian 재구성 · 창 stitching / PGO · offline tracker'], '오프라인 전용 · 차량 그래프에서 제외');
  // encoder high-res skip → FPN
  const sy = 346;
  g += `<path class="htp-pe-arrow" d="M ${ex + ew / 2} ${cy + eh / 2 + 2} V ${sy - 12} Q ${ex + ew / 2} ${sy}, ${ex + ew / 2 + 12} ${sy} H ${bx + 18} Q ${bx + 30} ${sy}, ${bx + 30} ${sy - 12} V ${rowY[2] + rh + 4}" marker-end="url(#f4-head-acc)"/>`;
  g += `<text class="htp-pe-t" x="${(ex + ew / 2 + ax + aw) / 2}" y="${sy - 8}" text-anchor="middle">고해상도 74×74 특징</text>`;
  const ly = H - 14;
  const leg = [['g', '쉬움'], ['y', '보통'], ['r', '어려움'], ['c', 'CPU · 오프라인']];
  let lx = 0;
  g += `<text class="htp-leg-h" x="${lx}" y="${ly}">종합 난이도</text>`;
  lx += 92;
  leg.forEach(([lv, s]) => {
    g += `<rect class="htp-leg lv-${lv}" x="${lx}" y="${ly - 12}" width="16" height="16" rx="4" style="--c:${COL[lv]}"/><text class="htp-leg-t" x="${lx + 24}" y="${ly + 1}">${s}</text>`;
    lx += 24 + s.length * 12 + 30;
  });
  g += `<text class="htp-leg-t mut" x="${W - 6}" y="${ly + 1}" text-anchor="end">블록에 마우스를 올리거나 Tab으로 포커스하면 아래 표의 행이 강조됩니다</text>`;
  return `<svg class="htp-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="Foundation4D 추론 그래프와 블록별 HTP 포팅 난이도">${g}</svg>`;
}
