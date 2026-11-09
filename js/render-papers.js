import { PAPERS, PAPER_ORDER } from './papers-data.js';

const SEC_LABELS = [
  { id: 'overview', label: '개요' },
  { id: 'method', label: 'Method' },
  { id: 'experiment', label: 'Experiment' },
  { id: 'summary', label: '정리' },
];

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function tableHTML(t) {
  return `<div class="exp-table-wrap reveal">
    <h3>${esc(t.title)}</h3>
    <p class="cite">${esc(t.cite)}</p>
    <table class="exp-table">
      <thead><tr>${t.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>
        ${t.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
    ${t.note ? `<p class="exp-note">${esc(t.note)}</p>` : ''}
  </div>`;
}

function paperHTML(id, p) {
  const steps = p.methodSteps.map((s, i) => `
    <div class="mstep" data-step="${i}" id="${id}-step-${i}">
      <span class="mstep-num">${String(i + 1).padStart(2, '0')}</span>
      <h3>${esc(s.title)}</h3>
      <p>${s.body}</p>
    </div>`).join('');

  return `
<article class="paper" id="${id}" data-paper="${id}" data-lab="${p.lab}">
  <aside class="paper-progress" aria-label="섹션 진행">
    ${SEC_LABELS.map(s => `<a href="#${id}-${s.id}" data-sec="${s.id}"><i></i><span>${s.label}</span></a>`).join('')}
  </aside>

  <header class="paper-hero reveal">
    <p class="arxiv">${p.venue ? esc(p.venue) + ' · ' : ''}arXiv ${esc(p.arxiv)}</p>
    <h2>${esc(p.title)}</h2>
    <p class="lede">${p.lede}</p>
    <ul class="keypts">${p.tags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
  </header>

  <section class="paper-sec" id="${id}-overview" data-sec="overview">
    <h2 class="sec-title reveal"><span>01</span> 개요</h2>
    <div class="prose">
      ${p.overview.map(x => `<p class="reveal">${x}</p>`).join('')}
    </div>
  </section>

  <section class="paper-sec" id="${id}-method" data-sec="method">
    <h2 class="sec-title reveal"><span>02</span> Method</h2>
    <div class="method-scrolly" data-lab="${p.lab}">
      <div class="method-sticky">
        <div class="lab-view sticky-view">
          <canvas id="lab-${p.lab}"></canvas>
          <div class="lab-hud">
            <p class="lab-count"><b data-role="step-num">01</b> / ${String(p.methodSteps.length).padStart(2, '0')}</p>
            <p class="lab-title" data-role="sticky-caption">${esc(p.methodSteps[0].title)}</p>
            <span class="lab-bar"><i data-role="step-bar" style="width:${100 / p.methodSteps.length}%"></i></span>
          </div>
          <span class="lab-hint">드래그로 회전</span>
          <ul class="lab-legend">${(p.legend || []).map(([c, t]) => `<li><i style="background:${c}"></i>${esc(t)}</li>`).join('')}</ul>
        </div>
      </div>
      <div class="method-steps">
        ${steps}
        <div class="method-aside reveal">
          <ul>${p.methodNotes.map(n => `<li>${n}</li>`).join('')}</ul>
        </div>
      </div>
    </div>
    <figure class="paper-fig reveal">
      <img src="${esc(p.figure.src)}" alt="${esc(p.figure.alt)}" loading="lazy">
      <figcaption>${p.figure.caption}</figcaption>
    </figure>
  </section>

  <section class="paper-sec" id="${id}-experiment" data-sec="experiment">
    <h2 class="sec-title reveal"><span>03</span> Experiment</h2>
    <p class="reveal prose-lead">${esc(p.experiments.intro)}</p>
    ${p.experiments.tables.map(tableHTML).join('')}
  </section>

  <section class="paper-sec" id="${id}-summary" data-sec="summary">
    <h2 class="sec-title reveal"><span>04</span> 정리 · 포팅 관점</h2>
    <div class="summary-grid">
      <div class="card reveal">
        <h3>정리</h3>
        <ul>${p.summary.map(s => `<li>${s}</li>`).join('')}</ul>
      </div>
      <div class="card reveal">
        <h3>포팅 관점</h3>
        <p>${p.porting}</p>
        ${p.moreLink ? `<p class="more"><a href="${esc(p.moreLink.href)}" target="_blank" rel="noopener">${esc(p.moreLink.label)}</a></p>` : ''}
        <p class="warn">⚠ 원 논문 입력은 동기화된 멀티 카메라 프레임을 가정합니다. 카메라별 비동기 batch-1 갱신은 별도 제안으로 구분하세요.</p>
      </div>
    </div>
  </section>
</article>`;
}

export function renderPapers(root) {
  root.innerHTML = PAPER_ORDER.map(id => paperHTML(id, PAPERS[id])).join('\n');
}
