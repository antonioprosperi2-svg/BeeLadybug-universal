import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BeeLadybugCore, CSSAdapter } from '../src/index.js';
import { formatIssue, groupIssues, isDistortedImage, keepOverflowCauses, pushStickyIssue, rememberIssue } from '../src/adapters/CSSAdapter.js';
import { domNoiseQuiet } from '../src/adapters/WebDOMAdapter.js';

function makeCore() {
    return new BeeLadybugCore({
        ui: false,
        mount: false,
        autoAttach: false,
        autoStart: false
    });
}

test('CSSAdapter si registra spento, con hotkey F6, senza caccia attiva', () => {
    const bee = makeCore();
    const css = new CSSAdapter(bee);
    css.attach();

    assert.equal(css.active, false);
    assert.deepEqual(bee.getAdapters(), [
        { name: 'css', label: 'F6 CSS', hotkey: 'F6', enabled: false }
    ]);

    css.detach();
    assert.equal(bee.getAdapters().length, 0);
    bee.destroy();
});

test('keepOverflowCauses tiene il discendente che sfora della stessa quantità', () => {
    const child = {};
    const parent = { contains(node) { return node === child; } };
    const kept = keepOverflowCauses([
        { el: parent, left: 0, right: 100, width: 900, view: 800, score: 100 },
        { el: child, left: 0, right: 101, width: 900, view: 800, score: 101 }
    ]);
    assert.deepEqual(kept.map((item) => item.el), [child]);
});

test('keepOverflowCauses tiene il box spostato se la larghezza ci sta e nessun figlio sfora', () => {
    const el = { contains() { return false; } };
    const kept = keepOverflowCauses([
        { el, left: 40, right: 0, width: 200, view: 800, score: 40 }
    ]);
    assert.equal(kept.length, 1);
});

test('keepOverflowCauses salta il box che ci sta se a uscire è il figlio', () => {
    const child = {};
    const parent = { contains(node) { return node === child; } };
    const kept = keepOverflowCauses([
        { el: parent, left: 0, right: 20, width: 400, view: 800, score: 20 },
        { el: child, left: 0, right: 180, width: 980, view: 800, score: 180 }
    ]);
    assert.deepEqual(kept.map((item) => item.el), [child]);
});

test('groupIssues conta i duplicati e ordina per gravità', () => {
    const groups = groupIssues([
        { selector: 'img', kind: 'distorted image', rank: 3, score: 10, level: 'error' },
        { selector: 'h1', kind: '!important h1 { color: red }', rank: 4, score: 5, level: 'warn' },
        { selector: 'article', kind: 'overflows viewport', rank: 0, score: 10, level: 'error' },
        { selector: 'article', kind: 'overflows viewport', rank: 0, score: 12, level: 'error' },
        { selector: 'button', kind: 'click blocked by div', rank: 1, score: 40, level: 'error' },
        { selector: 'span', kind: 'invisible text (transparent color)', rank: 2, score: 30, level: 'error' }
    ]);
    assert.deepEqual(groups.map(formatIssue), [
        'article overflows viewport ×2',
        'button click blocked by div',
        'span invisible text (transparent color)',
        'img distorted image',
        'h1 !important h1 { color: red }'
    ]);
});

test('isDistortedImage confronta il file con il box disegnato, non con gli attributi', () => {
    const naturalW = 800;
    const naturalH = 600;
    const renderedW = 640;
    const renderedH = 300;
    assert.equal(isDistortedImage(naturalW, naturalH, renderedW, renderedH, 'fill'), true);
    assert.equal(isDistortedImage(naturalW, naturalH, renderedW, renderedH, ''), true);
    assert.equal(isDistortedImage(naturalW, naturalH, naturalW, naturalH, 'fill'), false);
    assert.equal(isDistortedImage(naturalW, naturalH, renderedW, renderedH, 'cover'), false);
    assert.equal(isDistortedImage(naturalW, naturalH, 420, 300, 'fill'), false);
    assert.equal(isDistortedImage(naturalW, naturalH, 421, 300, 'fill'), true);
});

test('rememberIssue scrive un problema per elemento solo ogni 5 secondi', () => {
    const seen = new Map();
    assert.equal(rememberIssue(seen, 'img.widget\0distorted image', 1000, 5000), true);
    assert.equal(rememberIssue(seen, 'img.widget\0distorted image', 5999, 5000), false);
    assert.equal(rememberIssue(seen, 'img.widget\0distorted image', 6000, 5000), true);
    assert.equal(rememberIssue(seen, 'button\0click blocked by div', 1000, 5000), true);
});

test('pushStickyIssue tiene 10 avvisi, il più recente in cima', () => {
    let list = [];
    for (let i = 1; i <= 12; i++) list = pushStickyIssue(list, { text: `issue ${i}` }, 10);
    assert.equal(list.length, 10);
    assert.equal(list[0].text, 'issue 12');
    assert.equal(list[9].text, 'issue 3');
    list = pushStickyIssue(list, { text: 'issue 5' }, 10);
    assert.equal(list[0].text, 'issue 5');
    assert.equal(list.filter((item) => item.text === 'issue 5').length, 1);
});

test('domNoiseQuiet tace hover e mutate attr con F6 acceso, salvo F3 SLOW', () => {
    assert.equal(domNoiseQuiet(true, false, 1), true);
    assert.equal(domNoiseQuiet(true, true, 0.25), true);
    assert.equal(domNoiseQuiet(true, false, 0.25), false);
    assert.equal(domNoiseQuiet(false, false, 1), false);
});
