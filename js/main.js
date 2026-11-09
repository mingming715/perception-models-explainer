import { renderPapers } from './render-papers.js';
import { initScrolly } from './scrolly.js';
import './nav.js';
import './hero.js';
import './labs.js';

renderPapers(document.getElementById('papers-root'));
window.__bootLabs?.();
initScrolly();
