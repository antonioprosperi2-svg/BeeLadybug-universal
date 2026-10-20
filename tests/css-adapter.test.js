import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BeeLadybugCore, CSSAdapter } from '../src/index.js';
import { formatIssue, groupIssues, keepOverflowCauses } from '../src/adapters/CSSAdapter.js';

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
