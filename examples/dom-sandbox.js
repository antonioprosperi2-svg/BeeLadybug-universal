/**
 * DOM sandbox — Core + WebDOMAdapter over a tiny fake page.
 * The page never talks to the overlay. The adapter watches hover, box model, mutations.
 */
import { BeeLadybugCore, WebDOMAdapter } from '../src/index.js';

const bee = new BeeLadybugCore();
window.bee = bee;

const stage = document.getElementById('stage');
const adapter = new WebDOMAdapter(bee, {
    root: stage,
    watch: ['.card', '#cta']
});
adapter.attach();
window.adapter = adapter;

const list = document.getElementById('cards');
const addBtn = document.getElementById('add-card');
const bumpBtn = document.getElementById('bump-cta');
const cta = document.getElementById('cta');

let n = 3;
addBtn?.addEventListener('click', () => {
    n += 1;
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `<h2>Card ${n}</h2><p>Nodo inserito a runtime. L'adapter deve loggare mutate +1.</p>`;
    list.appendChild(card);
});

bumpBtn?.addEventListener('click', () => {
    const wide = cta.classList.toggle('wide');
    cta.textContent = wide ? 'CTA allargata' : 'Call to action';
});
