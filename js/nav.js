import { CATEGORIES, EXTRA_LINKS } from './papers.js';

const tabsEl = document.querySelector('.tabs');
const panelEl = document.getElementById('mega');
const nav = document.getElementById('topnav');

/** Build tab buttons + mega panel from config */
function buildNav() {
  tabsEl.innerHTML = '';
  CATEGORIES.forEach((cat, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab' + (idx === 0 ? ' on' : '');
    btn.dataset.cat = cat.id;
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-haspopup', 'true');
    btn.innerHTML = `${cat.label}<span class="caret" aria-hidden="true"></span>`;
    tabsEl.appendChild(btn);
  });

  // compact 비교 link beside tabs area lives in mega footer always
  renderMega(CATEGORIES[0].id, false);
}

function renderMega(catId, open) {
  const cat = CATEGORIES.find(c => c.id === catId) || CATEGORIES[0];
  panelEl.dataset.cat = cat.id;
  panelEl.hidden = !open;
  panelEl.innerHTML = `
    <div class="mega-inner">
      <div class="mega-head">
        <p class="mega-label">${cat.label}</p>
        <p class="mega-count">${cat.papers.length}편</p>
      </div>
      <ul class="mega-list">
        ${cat.papers.map(p => `
          <li>
            <a class="mega-item" href="#${p.id}" data-paper="${p.id}">
              <span class="mega-title">${p.title}</span>
              <span class="mega-sub">${p.subtitle}${p.meta ? ` · ${p.meta}` : ''}</span>
            </a>
          </li>`).join('')}
      </ul>
      <div class="mega-foot">
        ${EXTRA_LINKS.map(l => `<a class="mega-extra" href="#${l.id}">${l.title}<span>${l.subtitle}</span></a>`).join('')}
      </div>
    </div>`;
  panelEl.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => closeMega());
  });
}

function closeMega() {
  panelEl.hidden = true;
  tabsEl.querySelectorAll('.tab').forEach(t => {
    t.classList.remove('open');
    t.setAttribute('aria-expanded', 'false');
  });
}

function openMega(catId) {
  tabsEl.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.cat === catId;
    t.classList.toggle('on', on);
    t.classList.toggle('open', on);
    t.setAttribute('aria-expanded', on ? 'true' : 'false');
  });
  renderMega(catId, true);
}

tabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  const cat = btn.dataset.cat;
  if (btn.classList.contains('open') && panelEl.dataset.cat === cat && !panelEl.hidden) {
    closeMega();
    return;
  }
  openMega(cat);
});

document.addEventListener('click', (e) => {
  if (!nav.contains(e.target)) closeMega();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMega();
});

buildNav();

/* Scroll-spy: highlight active category tab (not mega) */
const paperIds = CATEGORIES.flatMap(c => c.papers.map(p => p.id)).concat(EXTRA_LINKS.map(l => l.id));
const sections = paperIds.map(id => document.getElementById(id)).filter(Boolean);

function syncTab() {
  const y = window.scrollY + 140;
  let current = null;
  for (const s of sections) if (s.offsetTop <= y) current = s.id;
  if (!current) return;
  const cat = CATEGORIES.find(c => c.papers.some(p => p.id === current));
  if (cat && panelEl.hidden) {
    tabsEl.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.cat === cat.id));
  }
}
window.addEventListener('scroll', syncTab, { passive: true });
syncTab();
