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

/** Active section = last section whose top is above the focus line */
export function initProgress() {
  const papers = [...document.querySelectorAll('.paper')];
  const FOCUS = () => window.innerHeight * 0.28;

  function sync() {
    const focusY = window.scrollY + FOCUS();
    let activePaper = null;
    for (const p of papers) {
      const top = p.offsetTop;
      const bottom = top + p.offsetHeight;
      if (focusY >= top && focusY < bottom) activePaper = p;
    }
    papers.forEach(p => {
      const rail = p.querySelector('.paper-progress');
      if (rail) rail.classList.toggle('show', p === activePaper);
    });
    if (!activePaper) return;

    const links = [...activePaper.querySelectorAll('.paper-progress a')];
    const secs = links
      .map(a => ({ id: a.dataset.sec, el: activePaper.querySelector(`#${activePaper.id}-${a.dataset.sec}`) }))
      .filter(s => s.el);

    let current = secs[0]?.id || null;
    for (const s of secs) {
      // section considered active once its top passes above the focus line
      if (s.el.offsetTop <= focusY + 8) current = s.id;
    }
    links.forEach(l => l.classList.toggle('on', l.dataset.sec === current));
  }

  window.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync);
  // sections render async; sync a few times after load
  sync();
  requestAnimationFrame(sync);
  setTimeout(sync, 300);
  setTimeout(sync, 1000);
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

    const onScroll = () => {
      let best = null, bestScore = -Infinity;
      const mid = window.innerHeight * 0.45;
      steps.forEach(s => {
        const r = s.getBoundingClientRect();
        const c = (r.top + r.bottom) / 2;
        const score = -Math.abs(c - mid);
        if (r.bottom > 60 && r.top < window.innerHeight - 60 && score > bestScore) {
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
