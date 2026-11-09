const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initReveals() {
  const els = document.querySelectorAll('.reveal');
  if (reduce) { els.forEach(el => el.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  els.forEach(el => io.observe(el));
}

export function initProgress() {
  const papers = [...document.querySelectorAll('.paper')];
  // Hide all rails initially; show only active paper's rail
  const syncRails = () => {
    const y = window.scrollY + window.innerHeight * 0.35;
    let active = null;
    for (const p of papers) {
      const top = p.offsetTop;
      const bottom = top + p.offsetHeight;
      if (y >= top && y < bottom) active = p;
    }
    papers.forEach(p => {
      const rail = p.querySelector('.paper-progress');
      if (!rail) return;
      rail.classList.toggle('show', p === active);
    });
  };
  window.addEventListener('scroll', syncRails, { passive: true });
  syncRails();

  papers.forEach(paper => {
    const links = [...paper.querySelectorAll('.paper-progress a')];
    const secs = links.map(a => paper.querySelector(`#${paper.id}-${a.dataset.sec}`)).filter(Boolean);
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const id = e.target.dataset.sec;
        links.forEach(l => l.classList.toggle('on', l.dataset.sec === id));
      });
    }, { threshold: 0.2, rootMargin: '-20% 0px -45% 0px' });
    secs.forEach(s => io.observe(s));
  });
}

export function initMethodScrolly() {
  document.querySelectorAll('.method-scrolly').forEach(wrap => {
    const lab = wrap.dataset.lab;
    const steps = [...wrap.querySelectorAll('.mstep')];
    const caption = wrap.querySelector('[data-role="sticky-caption"]');
    let current = -1;

    function setStep(i) {
      if (i === current) return;
      current = i;
      steps.forEach((s, idx) => s.classList.toggle('on', idx === i));
      if (caption) caption.textContent = steps[i].querySelector('h3')?.textContent || '';
      window.dispatchEvent(new CustomEvent('lab:step', { detail: { lab, step: i } }));
    }

    if (reduce) { setStep(0); return; }

    const io = new IntersectionObserver((entries) => {
      let best = null, bestRatio = 0;
      // Also consider all steps' current ratios
      steps.forEach(s => {
        const r = s.getBoundingClientRect();
        const vh = window.innerHeight;
        const visible = Math.min(r.bottom, vh * 0.7) - Math.max(r.top, vh * 0.25);
        const ratio = visible / Math.max(r.height, 1);
        if (ratio > bestRatio) { bestRatio = ratio; best = s; }
      });
      if (best && bestRatio > 0.05) setStep(Number(best.dataset.step));
    }, { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '0px' });

    steps.forEach(s => io.observe(s));
    // fallback scroll handler for smoother updates
    const onScroll = () => {
      let best = null, bestScore = -1;
      const mid = window.innerHeight * 0.45;
      steps.forEach(s => {
        const r = s.getBoundingClientRect();
        const c = (r.top + r.bottom) / 2;
        const score = -Math.abs(c - mid);
        if (r.bottom > 80 && r.top < window.innerHeight - 80 && score > bestScore) {
          bestScore = score; best = s;
        }
      });
      if (best) setStep(Number(best.dataset.step));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    setStep(0);
  });
}

export function initScrolly() {
  initReveals();
  initProgress();
  initMethodScrolly();
}
