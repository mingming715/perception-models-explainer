/** Single source of truth for nav + section metadata. Add a paper = one entry. */
export const CATEGORIES = [
  {
    id: 'sparse',
    label: 'Sparse Query',
    papers: [
      { id: 'stream-petr', title: 'StreamPETR', subtitle: 'Object-centric temporal queries', arxiv: '2303.11926', meta: 'MEGVII · ICCV 2023' },
      { id: 'sparse4d-v1', title: 'Sparse4D v1', subtitle: 'Deformable 4D aggregation', arxiv: '2211.10581', meta: 'Horizon Robotics · 2022' },
      { id: 'sparse4d-v2', title: 'Sparse4D v2', subtitle: 'Recurrent temporal fusion', arxiv: '2305.14018', meta: 'Horizon Robotics · 2023' },
      { id: 'sparse4d-v3', title: 'Sparse4D v3', subtitle: 'Denoising · QE · Decoupled Attn', arxiv: '2311.11722', meta: 'Horizon Robotics · 2023' },
      { id: 'sparse4d-tpami', title: 'Sparse4D (TPAMI)', subtitle: 'Unified · multi-modal journal version', meta: 'Horizon Robotics · TPAMI 2026' },
    ],
  },
  {
    id: 'scene',
    label: 'Scene Token',
    papers: [
      { id: 'foundation4d', title: 'Foundation4D', subtitle: 'Unified perception & reconstruction', arxiv: '2610.30340', meta: 'NVIDIA · 2026' },
    ],
  },
];

export const EXTRA_LINKS = [
  { id: 'compare', title: '비교', subtitle: '시간 상태를 이어받는 방식' },
];
