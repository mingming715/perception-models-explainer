/** Full per-paper content. Add a paper = one object + nav entry in papers.js */
export const PAPERS = {
  'stream-petr': {
    cat: 'sparse',
    title: 'StreamPETR',
    arxiv: '2303.11926',
    venue: 'CVPR 2023',
    lede: '객체 중심(object-centric) 시간 모델링. FIFO 메모리 큐에 Top-K foreground query만 남기고, ego 변환 + MLN으로 정렬한 뒤 Propagation Transformer에서 현재 이미지와 hybrid attention합니다.',
    tags: ['FIFO memory queue (Top-K)', 'Ego Transform', 'MLN (E, v, Δt)', 'Hybrid Attention'],
    figure: {
      src: 'assets/figures/streampetr-fig3.png',
      alt: 'StreamPETR Figure 3 Overall architecture',
      caption: '그림 3 (논문). StreamPETR 전체 구조 — History Memory Queue → Ego Transform → Propagation Transformer → Top-K push. 출처: Wang et al., arXiv:2303.11926.',
    },
    lab: 'streampetr',
    legend: [['#db2777', '현재 쿼리'], ['#22d3ee', '메모리 큐 (Top-K)'], ['#8b5cf6', '정렬된 과거 쿼리'], ['#f59e0b', 'v·Δt 보정 (MLN)'], ['#34d399', '이미지 cross-attn']],
    overview: [
      'PETR 계열의 object query를 <b>스트리밍 비디오</b>로 확장한 모델입니다. BEV feature나 과거 이미지를 통째로 들고 다니지 않고, 검출에 쓰인 sparse query만 시간축으로 전파합니다.',
      '핵심은 <b>object-centric temporal modeling</b>: 메모리 큐 → ego/모션 정렬 → Propagation Transformer → Top-K 갱신 루프입니다.',
    ],
    methodSteps: [
      { title: '현재 프레임 쿼리', body: '주변 차량에 붙은 3D query box와 기준점이 현재 프레임에서 나타납니다. 아직 메모리와 섞이지 않습니다.' },
      { title: 'FIFO Memory Queue', body: '과거 Top-K foreground query가 시간축을 따라 층층이 쌓입니다. 오래된 레이어일수록 흐려집니다.' },
      { title: 'Ego Transform + MLN', body: '자차가 전진하며 과거 박스가 현재 좌표로 미끄러져 옵니다. 주황 화살표는 v·Δt 보정(MLN)을 나타냅니다.' },
      { title: 'Hybrid Attention', body: '현재 쿼리(Q)와 메모리 큐(K/V) 사이 점선이 흐릅니다. 굵고 밝은 선일수록 attention weight가 큽니다.' },
      { title: '이미지 Cross-Attn', body: '쿼리에서 현재 카메라 frustum·이미지 평면으로 광선이 닿습니다. 과거 이미지는 다시 보지 않습니다.' },
      { title: 'Top-K → 큐 갱신', body: '점수가 높은 박스가 큐 맨 앞으로 올라가고, 가장 오래된 레이어는 빠져나갑니다.' },
    ],
    methodNotes: [
      'Memory queue는 장기 시간 맥락을 상수 크기로 유지합니다.',
      'Hybrid Attention 이후 현재 이미지 cross-attn으로 관측을 반영합니다.',
    ],
    experiments: {
      intro: 'nuScenes 검출 결과와 시간 모듈 ablation. 수치는 논문 표를 그대로 옮겼습니다.',
      tables: [
        {
          title: 'nuScenes val (Table 1)',
          cite: 'Table 1, arXiv:2303.11926 — FPS on RTX 3090 fp32',
          columns: ['설정', 'Backbone', 'mAP↑', 'NDS↑', 'FPS↑'],
          rows: [
            ['StreamPETR', 'ResNet50 · 256×704 · 8f', '0.432', '0.540', '27.1'],
            ['StreamPETR*‡', 'ResNet50 · 256×704 · 8f', '0.450', '0.550', '31.7'],
            ['StreamPETR*', 'ResNet101 · 512×1408 · 8f', '0.504', '0.592', '6.4'],
          ],
          note: '* perspective-view pre-training. ‡ 300 randomly initialized queries (논문 Table 1 각주).',
        },
        {
          title: 'nuScenes test (Table 2)',
          cite: 'Table 2, arXiv:2303.11926',
          columns: ['설정', 'Backbone', 'mAP↑', 'NDS↑'],
          rows: [
            ['StreamPETR', 'V2-99 · 640×1600', '0.550', '0.636'],
            ['StreamPETR', 'ViT-L · 800×1600', '0.620', '0.676'],
          ],
        },
        {
          title: 'MLN ablation (Table 6)',
          cite: 'Table 6 — Motion-aware Layer Normalization',
          columns: ['구성', 'mAP↑', 'NDS↑', 'mATE↓', 'mAVE↓'],
          rows: [
            ['MC only', '0.386', '0.489', '0.690', '0.373'],
            ['+ LN · Ego Pose · Time · Velocity (full MLN)', '0.402', '0.505', '0.660', '0.316'],
          ],
          note: '논문: ego/객체 움직임을 암묵 인코딩하면 mAP +2.0%p, NDS +1.8%p.',
        },
      ],
    },
    summary: [
      'Sparse query만 전파하므로 이미지 feature 큐 대비 시간 상태가 가볍습니다.',
      '온디바이스(SA8650p)에서는 Propagation Transformer · MLN · 메모리 큐 갱신이 추가 연산 포인트입니다.',
    ],
    porting: '원 논문은 동기 멀티 카메라 프레임을 가정합니다. 카메라별 batch-1 비동기 갱신은 우리 쪽 제안이며 논문 method와 구분해야 합니다.',
  },

  'sparse4d-v1': {
    cat: 'sparse',
    title: 'Sparse4D v1',
    arxiv: '2211.10581',
    venue: '',
    lede: 'Instance를 시간축으로 재귀 전달하지 않습니다. 과거 T프레임의 이미지 feature 큐를 유지하고, 4D keypoint를 과거 프레임에 투영해 deformable sampling합니다.',
    tags: ['Deformable 4D Aggregation', 'Image feature queue', 'Keypoint 투영', 'Instance 재귀 없음'],
    figure: {
      src: 'assets/figures/sparse4d-v1-fig2.png',
      alt: 'Sparse4D v1 Figure 2',
      caption: '그림 2 (논문). Sparse4D 전체 구조 — multi-view/scale/timestamp features와 Deformable 4D Aggregation. 출처: Lin et al., arXiv:2211.10581.',
    },
    lab: 's4dv1',
    legend: [['#fbbf24', '3D 앵커'], ['#db2777', '4D keypoints · 투영'], ['#94a3b8', '과거 프레임 (T)']],
    overview: [
      'Sparse anchor(instance) 기반 멀티뷰 3D 검출에 <b>시간축 이미지 feature</b>를 붙인 첫 Sparse4D입니다.',
      '시간 정보는 instance 상태가 아니라 <b>image feature queue</b>에 있습니다.',
    ],
    methodSteps: [
      { title: '이미지 feature 큐', body: '현재를 포함한 T개 시점의 멀티뷰 feature가 큐에 쌓입니다.' },
      { title: '3D 앵커', body: '각 후보 instance는 3D anchor box와 instance feature로 표현됩니다.' },
      { title: '4D Keypoints', body: '앵커로부터 고정·학습 keypoints를 생성합니다.' },
      { title: '과거 프레임에 투영', body: 'keypoints를 각 timestamp·카메라 평면에 투영합니다.' },
      { title: 'Deformable sampling', body: '투영 위치 주변에서 multi-scale feature를 deformable sampling하고 hierarchy fusion합니다.' },
      { title: '앵커 정제', body: '모은 feature로 앵커를 refinement합니다. 다음 프레임에서도 instance를 넘기지 않고 feature 큐만 갱신합니다.' },
    ],
    methodNotes: [
      'StreamPETR과 달리 과거 이미지를 다시 샘플링합니다.',
      'Depth reweight · self-attention으로 instance를 정제합니다.',
    ],
    experiments: {
      intro: '역사 프레임 수(T)에 따른 val 성능과 test 결과.',
      tables: [
        {
          title: 'nuScenes val — temporal frames (Table 4)',
          cite: 'Table 4, arXiv:2211.10581 — columns: mAP, mATE, mASE, mAOE, mAVE, mAAE, NDS',
          columns: ['설정', 'T', 'mAP↑', 'NDS↑'],
          rows: [
            ['Sparse4D', 'T=1 (no temporal)', '0.382', '0.451'],
            ['Sparse4D', 'T=4', '0.436', '0.541'],
            ['Sparse4D', 'T=9(−6)', '0.445', '0.547'],
            ['Sparse4D†', 'T=9(−6) · ResNet101', '0.444', '0.550'],
          ],
          note: '† 48 epoch. T=X(−Y)는 논문 Table 4 표기. T=1→T=4에서 mAP +5.4%p, NDS +9.0%p (본문).',
        },
        {
          title: 'nuScenes test (Table 5)',
          cite: 'Table 5 — VoVNet-99',
          columns: ['설정', 'Backbone', 'mAP↑', 'NDS↑'],
          rows: [
            ['Sparse4D† T=9(−6)', 'VoVNet-99', '0.511', '0.595'],
          ],
        },
      ],
    },
    summary: [
      '시간 융합의 주체가 이미지 feature 큐입니다.',
      'T가 늘수록 샘플링 부담이 커져, 이후 v2에서 recurrent로 전환됩니다.',
    ],
    porting: '온디바이스에서는 과거 feature 버퍼 메모리·대역폭이 병목이 될 수 있습니다. 원 논문은 동기 멀티 카메라 입력을 가정합니다.',
  },

  'sparse4d-v2': {
    cat: 'sparse',
    title: 'Sparse4D v2',
    arxiv: '2305.14018',
    venue: '',
    lede: '시간 융합을 recurrent로 바꿉니다. 이전 instance feature Fₜ₋₁을 앵커와 함께 ego motion + v·Δt로 투영해 이어받고, 현재 이미지만 샘플링합니다.',
    tags: ['Recurrent temporal fusion', 'Fₜ ← Fₜ₋₁', 'Single / Multi-frame layer', 'EDA · cam · depth'],
    figure: {
      src: 'assets/figures/sparse4d-v2-fig2.png',
      alt: 'Sparse4D v2 Figure 2',
      caption: '그림 2 (논문). Sparse4Dv2 Overall Framework — temporal instance Select & Update, 현재 multi-view feature만 decoder 입력. 출처: Lin et al., arXiv:2305.14018.',
    },
    lab: 's4dv2',
    legend: [['#22d3ee', 'instance (색 = ID)'], ['#f59e0b', 'ego + v·Δt 이동'], ['#34d399', '현재 이미지 샘플'], ['#db2777', '신규 객체']],
    overview: [
      'v1의 이미지 feature 큐를 제거하고, <b>instance 상태를 재귀 전달</b>하는 구조로 바꿉니다.',
      'StreamPETR과 같은 sparse recurrent 계열로 정렬됩니다.',
    ],
    methodSteps: [
      { title: '이전 instance', body: 't−1의 anchor와 instance feature Fₜ₋₁이 상태처럼 남습니다.' },
      { title: 'Ego + v·Δt 투영', body: '앵커를 ego motion과 속도 v·Δt로 현재 시각 좌표계에 투영합니다.' },
      { title: '현재 이미지만 샘플', body: '투영된 앵커에서 현재 프레임 이미지 feature만 deformable sampling합니다.' },
      { title: 'Recurrent 갱신', body: 'Fₜ = decode(Fₜ₋₁, 현재 샘플). instance feature가 재귀적으로 이어집니다.' },
      { title: 'Single-frame 경로', body: '새 객체는 single-frame layer에서 초기화되고, 전파된 객체는 multi-frame layer가 담당합니다.' },
      { title: '부가 모듈', body: 'EDA, camera parameter encoding, dense depth supervision으로 학습·효율을 보강합니다.' },
    ],
    methodNotes: [
      '과거 이미지 feature 큐가 사라집니다.',
      'EDA로 deformable aggregation을 가볍게 합니다.',
    ],
    experiments: {
      intro: 'val/test 검출과 temporal fusion ablation (Table 3).',
      tables: [
        {
          title: 'nuScenes val (Table 4)',
          cite: 'Table 4, arXiv:2305.14018',
          columns: ['설정', 'Backbone', 'mAP↑', 'NDS↑', 'FPS'],
          rows: [
            ['Sparse4Dv2', 'ResNet50 · 256×704', '0.439', '0.539', '20.3'],
            ['Sparse4Dv2', 'ResNet101 · 512×1408', '0.485', '0.580', '8.4'],
            ['Sparse4Dv2†', 'ResNet101 · 512×1408', '0.505', '0.594', '8.4'],
            ['Sparse4Dv2†∗', 'ResNet101 · 512×1408', '0.521', '0.608', '7.1'],
          ],
          note: '† pre-trained weights. ∗ 논문 Table 4 표기.',
        },
        {
          title: 'nuScenes test (Table 5)',
          cite: 'Table 5 — VoVNet-99',
          columns: ['설정', 'mAP↑', 'NDS↑'],
          rows: [
            ['Sparse4D (v1)', '0.511', '0.595'],
            ['Sparse4Dv2', '0.557', '0.638'],
          ],
        },
        {
          title: 'Temporal fusion ablation (Table 3)',
          cite: 'Table 3 — MF / SFL / CPE / DDS. Exp.1(no MF) vs Exp.5(full)',
          columns: ['Exp', 'MF', '구성', 'mAP↑', 'NDS↑'],
          rows: [
            ['1', '✗', 'SFL·CPE·DDS (no multi-frame)', '0.341', '0.414'],
            ['5', '✓', 'MF·SFL·CPE·DDS (full)', '0.439', '0.539'],
          ],
          note: '본문: temporal fusion이 +9.8 mAP, +12.5 NDS.',
        },
      ],
    },
    summary: [
      '시간 상태의 주체가 instance로 바뀌어 v1 대비 추론이 단순·빨라집니다.',
      '배포 그래프의 기준선이 되는 버전입니다 (v3 추론도 동일 계열).',
    ],
    porting: 'HTP 포팅 시 recurrent instance 버퍼·현재 프레임만의 deformable sampling·EDA 커널이 핵심입니다. 동기 프레임 가정은 논문과 동일합니다.',
  },

  'sparse4d-v3': {
    cat: 'sparse',
    title: 'Sparse4D v3',
    arxiv: '2311.11722',
    venue: '',
    lede: '추론 파이프라인은 v2와 동일합니다. Temporal Instance Denoising(학습), Quality Estimation, Decoupled Attention으로 정확도를 올립니다.',
    tags: ['Inference = v2', 'Temporal Instance Denoising', 'Quality Estimation', 'Decoupled Attention'],
    figure: {
      src: 'assets/figures/sparse4d-v3-fig1.png',
      alt: 'Sparse4D v3 Figure 1',
      caption: '그림 1 (논문). Sparse4D framework overview. v3 추론 구조는 v2를 따릅니다. 출처: Lin et al., arXiv:2311.11722.',
    },
    lab: 's4dv3',
    legend: [['#94a3b8', '추론 앵커 (v2)'], ['#34d399', 'GT'], ['#f59e0b', 'noisy GT (train-only)'], ['#22d3ee', 'feature · centerness'], ['#8b5cf6', 'anchor emb · yawness']],
    overview: [
      '구조적 추론 경로를 바꾸지 않고 <b>학습·attention·품질 헤드</b>를 보강한 버전입니다.',
      '추적(E2E tracking)으로도 확장됩니다.',
    ],
    methodSteps: [
      { title: 'v2와 같은 추론', body: '배포·추론 그래프는 Sparse4D v2 recurrent pipeline 그대로입니다.' },
      { title: 'Temporal Instance Denoising', body: '학습 때 GT instance에 noise를 주고 복원하도록 학습합니다 (train-only).' },
      { title: '노이즈 → GT 복원', body: 'noisy instance를 GT에 가깝게 되돌리며 temporal association을 강화합니다.' },
      { title: 'Quality Estimation', body: 'centerness·yawness 헤드가 로컬화 품질을 예측합니다.' },
      { title: 'Decoupled Attention', body: 'instance feature와 anchor embedding을 add하지 않고 concat한 뒤 attention합니다.' },
      { title: '정리', body: '온디바이스 추론 ≈ v2 + QE 헤드·concat 차원. Denoising은 학습 전용입니다.' },
    ],
    methodNotes: [
      'Decoupled Attention은 위치 신호가 특징에 묻히는 현상을 완화합니다.',
      'QE는 NMS/정렬·트래킹에 활용됩니다.',
    ],
    experiments: {
      intro: 'v2 대비 val/test 향상과 구성 ablation (Table 5).',
      tables: [
        {
          title: 'nuScenes val (Table 1)',
          cite: 'Table 1, arXiv:2311.11722',
          columns: ['설정', 'Backbone', 'mAP↑', 'NDS↑', 'FPS'],
          rows: [
            ['Sparse4Dv2', 'ResNet50 · 256×704', '0.439', '0.539', '20.3'],
            ['Sparse4Dv3', 'ResNet50 · 256×704', '0.469', '0.561', '19.8'],
            ['Sparse4Dv2†', 'ResNet101 · 512×1408', '0.505', '0.594', '8.4'],
            ['Sparse4Dv3†', 'ResNet101 · 512×1408', '0.537', '0.623', '8.2'],
          ],
        },
        {
          title: 'nuScenes test (Table 2)',
          cite: 'Table 2 — VoVNet-99',
          columns: ['설정', 'mAP↑', 'NDS↑'],
          rows: [
            ['Sparse4D', '0.511', '0.595'],
            ['Sparse4Dv2', '0.557', '0.638'],
            ['Sparse4Dv3', '0.570', '0.656'],
          ],
        },
        {
          title: 'Component ablation (Table 5)',
          cite: 'Table 5 — cumulative add-ons on ResNet50 setting',
          columns: ['Setting', 'mAP↑', 'NDS↑', 'AMOTA↑'],
          rows: [
            ['Sparse4Dv2', '0.439', '0.539', '0.414'],
            ['+ single-frame denoising', '0.447', '0.548', '0.445'],
            ['+ decoupled attention', '0.458', '0.551', '0.472'],
            ['+ temporal denoising', '0.462', '0.557', '0.457'],
            ['+ centerness', '0.463', '0.554', '0.466'],
            ['+ yawness (= Sparse4Dv3)', '0.469', '0.561', '0.490'],
          ],
          note: '마지막 행 대비 v2: mAP +0.030, NDS +0.022, AMOTA +0.076 (표의 Δ).',
        },
      ],
    },
    summary: [
      '추론 그래프는 v2와 같아 포팅 비용 대비 정확도 이득이 큽니다.',
      '추가분은 QE 헤드와 attention 입력 concat 차원입니다.',
    ],
    porting: '학습 전용 denoising 그래프는 배포에서 제외합니다. 원 논문도 동기 멀티 카메라 입력을 가정합니다.',
  },

  'foundation4d': {
    cat: 'scene',
    title: 'Foundation4D',
    arxiv: '2610.30340',
    venue: 'NVIDIA · 2026',
    lede: '멀티 카메라 주행 영상에서 geometry · 3D detection · semantic occupancy · Gaussian reconstruction을 한 번에 수행하는 통합 feed-forward 모델. Sparse query가 아니라 scene token으로 장면을 표현합니다.',
    tags: ['Factorized spatiotemporal attn', 'Geo · Det · Occ · Gaussian', 'Video + pose graph', 'PAI-Foundation4D'],
    figure: {
      src: 'assets/figures/foundation4d-fig2.png',
      alt: 'Foundation4D Figure 2 Architecture',
      caption: '그림 2 (논문). Foundation4D 아키텍처 — 멀티 카메라×시간 → factorized attention → Geometry / Gaussian / Detection / Occupancy. 출처: arXiv:2610.30340.',
    },
    lab: 'f4d',
    legend: [['#8b5cf6', 'scene token · time attn'], ['#22d3ee', 'view attn · 검출 박스'], ['#34d399', 'Detection head']],
    overview: [
      '객체 query를 이어받는 Sparse Query 계열과 달리, <b>장면 토큰</b>으로 기하·점유·재구성·검출을 공유 backbone에서 풉니다.',
      '윈도우 추론 결과를 pose graph로 정렬하는 video pipeline을 포함합니다.',
    ],
    methodSteps: [
      { title: '멀티 카메라 입력', body: 'C대 카메라 × T 시점 영상이 들어옵니다. 각 이미지는 촬영 시각을 가집니다.' },
      { title: 'Factorized attention', body: '이미지 내부 attention 후 view 또는 time attention을 번갈아 적용합니다.' },
      { title: 'Scene tokens', body: '장면 전체를 표현하는 scene token 문맥이 형성됩니다.' },
      { title: '멀티 헤드 디코더', body: 'Geometry · Detection · Occupancy · Gaussian 헤드가 공유 토큰에서 갈라집니다.' },
      { title: '3D 검출·점유', body: '검출 박스와 occupancy가 장면 토큰 위에서 동시에 읽힙니다.' },
      { title: 'Video 추론', body: '윈도우 출력을 pose graph로 정렬하고 객체 트랙을 이어 긴 클립을 처리합니다.' },
    ],
    methodNotes: [
      'DINOv2/ViT-L 계열 encoder + factorized spatiotemporal aggregator.',
      'Sparse Query 계열과 표현 축이 다릅니다.',
    ],
    experiments: {
      intro: 'fine-tune 기준 공개 벤치마크 수치 (논문 Table 2, 7).',
      tables: [
        {
          title: 'Depth — Waymo / nuScenes val (Table 2)',
          cite: 'Table 2, arXiv:2610.30340 — AbsRel↓, δ1.25↑',
          columns: ['Model', 'Waymo AbsRel↓', 'Waymo δ1.25↑', 'nuScenes AbsRel↓', 'nuScenes δ1.25↑'],
          rows: [
            ['GeoUP', '0.13', '87.30', '0.19', '80.05'],
            ['Foundation4D', '0.09', '91.97', '0.15', '86.44'],
          ],
        },
        {
          title: 'Camera-only detection — nuScenes val (Table 7)',
          cite: 'Table 7 — mAP/NDS in percent points as printed',
          columns: ['Model', 'Backbone', 'mAP↑', 'NDS↑'],
          rows: [
            ['GeoUP-Joint', 'ViT-L · VGGT', '59.2', '65.3'],
            ['Foundation4D', 'ViT-L · Foundation4D', '60.9', '66.5'],
          ],
          note: '본문: GeoUP-Joint 대비 +1.7 mAP, +1.2 NDS.',
        },
      ],
    },
    summary: [
      'Scene Token 축의 통합 인지·재구성 모델입니다.',
      'Sparse Query 계열과 직접 연산 그래프를 공유하지 않습니다.',
    ],
    porting: '대형 ViT + 다중 헤드라 SA8650p 단일 SoC 포팅은 Sparse4D/StreamPETR보다 무겁습니다. 상세 인터랙티브 해설은 기존 사이트를 참고하세요.',
    moreLink: { href: 'https://mingming715.github.io/foundation4d-explainer/', label: '더 자세한 인터랙티브 해설 ↗' },
  },
};

export const PAPER_ORDER = ['stream-petr', 'sparse4d-v1', 'sparse4d-v2', 'sparse4d-v3', 'foundation4d'];
