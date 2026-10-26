import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BeeLadybugCore, CSSAdapter, exportReport } from '../src/index.js';
import { addCause, describeCause, formatCause, formatIssue, groupIssues, isDistortedImage, keepOverflowCauses, pushStickyIssue, rememberIssue, stackingReasons } from '../src/adapters/CSSAdapter.js';
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

test('addCause raggruppa un blocco click in una sola riga', () => {
    let list = [];
    for (let i = 0; i < 10; i++) {
        list = addCause(list, {
            kind: 'click blocked by body::after',
            path: `a.link${i}`,
            el: { id: i }
        }, 10);
    }
    assert.equal(list.length, 1);
    assert.equal(formatCause(list[0]), 'body::after blocks clicks on 10 elements');
    assert.equal(list[0].targets.length, 10);
    assert.equal(describeCause('unreadable sheet: https://cdn.example/a.css', 'button'), null);
});

test('stackingReasons riconosce transform, opacity, filter, z-index e will-change', () => {
    assert.deepEqual(stackingReasons({
        transform: 'matrix(1, 0, 0, 1, 0, 0)',
        opacity: '1',
        filter: 'none',
        position: 'static',
        zIndex: 'auto',
        willChange: 'auto'
    }), { bugs: ['transform'], hint: '' });
    assert.deepEqual(stackingReasons({
        transform: 'none',
        opacity: '0.4',
        filter: 'blur(2px)',
        position: 'relative',
        zIndex: '2',
        willChange: 'transform, opacity'
    }), { bugs: ['opacity', 'filter', 'z-index'], hint: 'transform, opacity' });
    assert.deepEqual(stackingReasons({
        transform: 'none',
        opacity: '1',
        filter: 'none',
        position: 'static',
        zIndex: '3',
        willChange: 'scroll-position'
    }), { bugs: [], hint: '' });
});

test('formatCause raggruppa i figli chiusi in uno stacking context', () => {
    let list = [];
    for (const name of ['span.b1', 'span.b2', 'span.b3']) {
        list = addCause(list, {
            kind: 'stacking context (transform) by div.hero',
            path: name,
            el: { id: name }
        }, 10);
    }
    assert.equal(list.length, 1);
    assert.equal(list[0].level, 'error');
    assert.equal(
        formatCause(list[0]),
        'div.hero creates stacking context (transform) - z-index of 3 children is trapped'
    );
    const hint = addCause([], {
        kind: 'will-change opacity by div.layer-hint',
        path: 'span.floater',
        el: { id: 'floater' }
    }, 10);
    assert.equal(hint[0].level, 'info');
    assert.equal(
        formatCause(hint[0]),
        'div.layer-hint will-change: opacity — z-index of 1 child stays in this layer'
    );
});

test('snapshot gira con la hunt spenta e salta nascosti e admin', () => {
    const previousDocument = globalThis.document;
    const previousStyle = globalThis.getComputedStyle;
    const previousWindow = globalThis.window;
    const bee = makeCore();
    const css = new CSSAdapter(bee);
    let published = 0;
    bee.publishDetail = () => {
        published += 1;
        return bee;
    };
    bee.publishIssues = () => {
        published += 1;
        return bee;
    };
    css.attach();
    assert.equal(css.active, false);
    assert.deepEqual(css.snapshot(), { name: 'css', items: [] });

    const bleed = box('ARTICLE', 'bleed', { left: 0, top: 0, width: 900, height: 20, right: 900, bottom: 20 });
    const wrap = box('DIV', 'wrap', { left: 0, top: 0, width: 900, height: 40, right: 900, bottom: 40 });
    wrap.contains = (node) => node === bleed;
    const secret = box('DIV', 'secret', { left: 0, top: 0, width: 900, height: 20, right: 900, bottom: 20 }, { display: 'none' });
    const admin = box('DIV', 'wpadminbar', { left: 0, top: 0, width: 900, height: 20, right: 900, bottom: 20 });
    const toolbar = box('A', 'toolbar', { left: 0, top: 0, width: 40, height: 20, right: 50, bottom: 30 });
    toolbar.parentElement = admin;
    const plugin = box('DIV', 'plugin', { left: 12, top: 12, width: 40, height: 20, right: 52, bottom: 32 });
    plugin.className = 'ab-item';
    const ghost = box('DIV', 'ghost', { left: 0, top: 0, width: 0, height: 20, right: 0, bottom: 20 }, { marginLeft: '-8px' });
    const pull = box('DIV', 'pull', { left: 12, top: 12, width: 40, height: 20, right: 52, bottom: 32 }, { marginLeft: '-8px' });
    const hot = box('DIV', 'hot', { left: 12, top: 70, width: 40, height: 20, right: 52, bottom: 90 });
    hot.id = '';
    hot.classList = ['hot'];
    hot.matches = (selector) => selector === '.hot';
    const hero = box('DIV', 'hero', { left: 12, top: 80, width: 80, height: 40, right: 92, bottom: 120 }, { transform: 'translateZ(0)' });
    const trapped = box('SPAN', 'trapped', { left: 16, top: 84, width: 20, height: 16, right: 36, bottom: 100 }, { zIndex: '3' });
    trapped.parentElement = hero;
    const hint = box('DIV', 'hint', { left: 12, top: 140, width: 80, height: 40, right: 92, bottom: 180 }, { willChange: 'opacity' });
    const floater = box('SPAN', 'floater', { left: 16, top: 144, width: 20, height: 16, right: 36, bottom: 160 }, { zIndex: '4' });
    floater.parentElement = hint;
    const mask = box('DIV', 'mask', { left: 200, top: 10, width: 80, height: 40, right: 280, bottom: 50 });
    const one = box('BUTTON', 'one', { left: 210, top: 16, width: 20, height: 16, right: 230, bottom: 32 });
    const two = box('BUTTON', 'two', { left: 240, top: 16, width: 20, height: 16, right: 260, bottom: 32 });
    const nodes = [bleed, wrap, secret, admin, toolbar, plugin, ghost, pull, hot, hero, trapped, hint, floater, mask, one, two];

    globalThis.getComputedStyle = (el, pseudo) => computedStyle(el, pseudo);
    globalThis.window = { innerWidth: 800, innerHeight: 600 };
    globalThis.document = {
        documentElement: {
            clientWidth: 800,
            tagName: 'HTML',
            nodeType: 1,
            getBoundingClientRect() {
                return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
            }
        },
        body: {
            tagName: 'BODY',
            nodeType: 1,
            querySelectorAll() {
                return nodes;
            }
        },
        elementFromPoint(x, y) {
            if (x >= 200 && x <= 280 && y >= 10 && y <= 50) return mask;
            return null;
        },
        styleSheets: [
            {
                href: 'https://cdn.example/app.css',
                get cssRules() {
                    throw new Error('cross-origin');
                }
            },
            {
                cssRules: [{
                    type: 1,
                    selectorText: '.hot',
                    style: {
                        length: 1,
                        item() { return 'color'; },
                        getPropertyPriority() { return 'important'; },
                        getPropertyValue() { return 'red'; }
                    }
                }]
            }
        ]
    };

    try {
        const logs = bee.getLogs().length;
        const shot = css.snapshot();
        assert.equal(css.active, false);
        assert.equal(published, 0);
        assert.equal(bee.getLogs().length, logs);
        assert.equal(shot.name, 'css');

        const overflow = shot.items.find((item) => item.rule === 'overflow');
        assert.equal(overflow.selector, 'article#bleed');
        assert.equal(overflow.severity, 'error');
        assert.equal(overflow.value, 'article#bleed overflows viewport');
        assert.equal(shot.items.some((item) => item.selector === 'div#wrap'), false);

        const blocked = shot.items.find((item) => item.rule === 'click blocked');
        assert.equal(blocked.selector, 'div#mask');
        assert.equal(blocked.value, 'div#mask blocks clicks on 2 elements');

        const stack = shot.items.find((item) => item.rule === 'stacking context');
        assert.equal(stack.severity, 'error');
        assert.equal(
            stack.value,
            'div#hero creates stacking context (transform) - z-index of 1 child is trapped'
        );
        const layer = shot.items.find((item) => item.rule === 'will-change');
        assert.equal(layer.severity, 'ok');
        assert.equal(
            layer.value,
            'div#hint will-change: opacity — z-index of 1 child stays in this layer'
        );

        const important = shot.items.find((item) => item.rule === '!important');
        assert.equal(important.severity, 'warn');
        assert.equal(important.selector, 'div.hot');
        assert.equal(important.value, '!important .hot { color: red }');
        const margin = shot.items.find((item) => item.rule === 'negative margin');
        assert.equal(margin.selector, 'div#pull');
        assert.equal(margin.value, 'negative margin margin-left: -8px');

        const sheet = shot.items.find((item) => item.rule === 'unreadable sheet');
        assert.equal(sheet.severity, 'ok');
        assert.equal(sheet.selector, 'https://cdn.example/app.css');

        for (const selector of ['div#secret', 'div#wpadminbar', 'a#toolbar', 'div#plugin', 'div#ghost']) {
            assert.equal(shot.items.some((item) => item.selector === selector), false, selector);
        }

        const report = exportReport(bee, { format: 'json' });
        assert.equal(report.adapters.some((section) => section.name === 'css'), true);

        css.detach();
        assert.equal(css.snapshot(), null);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousStyle === undefined) delete globalThis.getComputedStyle;
        else globalThis.getComputedStyle = previousStyle;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
        bee.destroy();
    }
});

function box(tag, id, rect, styleMap) {
    return {
        nodeType: 1,
        tagName: tag,
        id,
        className: '',
        classList: [],
        parentElement: null,
        childElementCount: 0,
        textContent: '',
        styleMap: styleMap || null,
        hasAttribute() { return false; },
        matches() { return false; },
        contains() { return false; },
        getBoundingClientRect() { return rect; }
    };
}

function computedStyle(el, pseudo) {
    if (pseudo) {
        return {
            content: 'none',
            position: 'static',
            pointerEvents: 'auto',
            width: '0',
            height: '0',
            left: '0',
            top: '0',
            getPropertyValue() { return ''; }
        };
    }
    const values = {
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        color: 'rgb(0, 0, 0)',
        backgroundColor: 'rgba(0, 0, 0, 0)',
        transform: 'none',
        filter: 'none',
        position: 'static',
        zIndex: 'auto',
        willChange: 'auto',
        objectFit: 'fill',
        marginTop: '0px',
        marginRight: '0px',
        marginBottom: '0px',
        marginLeft: '0px',
        ...(el && el.styleMap)
    };
    return {
        ...values,
        getPropertyValue(prop) {
            const camel = prop.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
            if (values[prop] != null) return String(values[prop]);
            if (values[camel] != null) return String(values[camel]);
            return '';
        }
    };
}
