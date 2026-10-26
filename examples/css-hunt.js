/**
 * CSS hunt demo. Five planted bugs, no adapter logic in the page.
 */
import { BeeLadybugCore, CSSAdapter, exportReport } from '../src/index.js';

const bee = new BeeLadybugCore();
const css = new CSSAdapter(bee);
css.attach();
window.bee = bee;
window.cssHunt = css;

document.getElementById('scan')?.addEventListener('click', () => {
    if (!css.active) bee.toggleAdapter('css');
    css.scan();
});

document.getElementById('export-report')?.addEventListener('click', () => {
    exportReport(bee, { format: 'html' });
});
