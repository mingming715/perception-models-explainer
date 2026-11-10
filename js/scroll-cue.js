/** Horizontal-scroll cue for wide tables/diagrams on narrow screens.
 *  Wraps each scroller in .xscroll-cue; when its content is wider than the box it gets
 *  .can-scroll (shows "← 옆으로 스크롤 →" and a right-edge fade), .at-end hides the fade.
 *  Nothing is shown when the content fits, so the desktop layout is unchanged. */
const SEL = '.exp-scroll, .htp-table-wrap, .htp-scroll';

export function initScrollCues(root) {
  const cues = [];
  root.querySelectorAll(SEL).forEach((sc) => {
    if (sc.parentElement?.classList.contains('xscroll-cue')) return;
    const wrap = document.createElement('div');
    wrap.className = 'xscroll-cue' + (sc.classList.contains('exp-scroll') ? ' cue-white' : '');
    sc.parentNode.insertBefore(wrap, sc);
    wrap.appendChild(sc);
    const upd = () => {
      const can = sc.scrollWidth > sc.clientWidth + 2;
      wrap.classList.toggle('can-scroll', can);
      wrap.classList.toggle('at-end', can && sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 2);
    };
    sc.addEventListener('scroll', upd, { passive: true });
    cues.push(upd);
    upd();
  });
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => cues.forEach((f) => f()), 120); });
  // fonts/reveal may change widths after first paint
  setTimeout(() => cues.forEach((f) => f()), 600);
}
