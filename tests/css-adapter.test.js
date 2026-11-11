import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BeeLadybugCore, CSSAdapter, WebDOMAdapter, exportReport } from '../src/index.js';
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

const RECT = { left: 12, top: 12, width: 40, height: 20, right: 52, bottom: 32 };

function installCssDom({ nodes = [], stack = [], hit = () => null, styleSheets = [] } = {}) {
    const keys = ['document', 'getComputedStyle', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'MutationObserver'];
    const previous = new Map(keys.map((key) => [key, globalThis[key]]));
    const handlers = {};
    const queue = new Map();
    const observers = [];
    const created = [];
    let nextId = 1;

    globalThis.getComputedStyle = (el, pseudo) => computedStyle(el, pseudo);
    globalThis.window = {
        innerWidth: 800,
        innerHeight: 600,
        addEventListener(type, fn) {
            (handlers[type] ||= []).push(fn);
        },
        removeEventListener(type, fn) {
            handlers[type] = (handlers[type] || []).filter((item) => item !== fn);
        }
    };
    globalThis.requestAnimationFrame = (cb) => {
        const id = nextId++;
        queue.set(id, cb);
        return id;
    };
    globalThis.cancelAnimationFrame = (id) => {
        queue.delete(id);
    };
    globalThis.MutationObserver = class {
        constructor(cb) {
            this.cb = cb;
            observers.push(this);
        }
        observe() {}
        disconnect() {}
    };
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
            },
            appendChild() {}
        },
        createElement() {
            const node = { style: {}, setAttribute() {}, remove() {} };
            created.push(node);
            return node;
        },
        elementFromPoint: hit,
        elementsFromPoint: () => stack,
        styleSheets
    };

    return {
        created,
        observers,
        pending: () => queue.size,
        flush() {
            for (const [id, cb] of [...queue]) {
                queue.delete(id);
                cb();
            }
        },
        fire(type, event) {
            for (const fn of (handlers[type] || []).slice()) fn(event);
        },
        key(code, extra = {}) {
            return {
                code,
                repeat: false,
                target: null,
                ctrlKey: false,
                metaKey: false,
                altKey: false,
                prevented: false,
                preventDefault() { this.prevented = true; },
                ...extra
            };
        },
        restore() {
            for (const [key, value] of previous) {
                if (value === undefined) delete globalThis[key];
                else globalThis[key] = value;
            }
        }
    };
}

function watchStates(bee) {
    const seen = [];
    const off = bee.subscribe((packet) => {
        if (packet.type === 'state') seen.push(packet.payload);
    });
    return { seen, off };
}

function valuesOf(seen, key) {
    return seen.filter((payload) => payload.key === key).map((payload) => payload.value);
}

function importantRule(selector, property, value) {
    return {
        type: 1,
        selectorText: selector,
        style: {
            length: 1,
            item() { return property; },
            getPropertyPriority() { return 'important'; },
            getPropertyValue() { return value; }
        }
    };
}

function worded(id, text, color) {
    const el = box('DIV', id, RECT, { color });
    el.textContent = text;
    return el;
}

test('Ctrl, Meta, Alt e overlay nascosto non attivano scan e pin', () => {
    const card = box('DIV', 'card', { left: 10, top: 10, width: 100, height: 40, right: 110, bottom: 50 });
    const dom = installCssDom({ nodes: [card], stack: [card], hit: () => card });
    const bee = makeCore();
    const css = new CSSAdapter(bee);
    css.attach();
    const states = watchStates(bee);
    try {
        bee.setAdapterEnabled('css', true);
        assert.equal(css.active, true);
        dom.fire('mousemove', { clientX: 20, clientY: 20 });
        dom.flush();
        assert.deepEqual(valuesOf(states.seen, 'css.target'), ['div#card']);
        assert.equal(dom.created[0].style.display, 'block');

        for (const [code, extra] of [['KeyS', { ctrlKey: true }], ['KeyS', { metaKey: true }], ['KeyP', { altKey: true }], ['KeyP', { ctrlKey: true }]]) {
            const event = dom.key(code, extra);
            dom.fire('keydown', event);
            assert.equal(event.prevented, false, `${code} ${JSON.stringify(extra)} resta al browser`);
        }
        assert.deepEqual(valuesOf(states.seen, 'css.scan'), []);
        assert.deepEqual(valuesOf(states.seen, 'css.pin'), []);

        const scan = dom.key('KeyS');
        dom.fire('keydown', scan);
        assert.equal(scan.prevented, true);
        assert.deepEqual(valuesOf(states.seen, 'css.scan'), ['0']);
        dom.fire('mousemove', { clientX: 22, clientY: 22 });
        dom.flush();
        dom.fire('keydown', dom.key('KeyP'));
        assert.deepEqual(valuesOf(states.seen, 'css.pin'), ['div#card']);

        bee.hide();
        assert.equal(dom.created[0].style.display, 'none', 'il box segue il nascondi del core');
        assert.equal(dom.created[1].style.display, 'none');
        const hiddenScan = dom.key('KeyS');
        dom.fire('keydown', hiddenScan);
        assert.equal(hiddenScan.prevented, false);
        assert.deepEqual(valuesOf(states.seen, 'css.scan'), ['0']);
        dom.fire('mousemove', { clientX: 30, clientY: 30 });
        assert.equal(dom.pending(), 0, 'nessuna ispezione con overlay nascosto');

        bee.show();
        assert.equal(dom.created[0].style.display, 'block');

        css.detach();
        bee.hide();
        bee.show();
    } finally {
        states.off();
        dom.restore();
        bee.destroy();
    }
});

test('nessuna ispezione a (0,0) prima del primo mousemove e touchesSheet guarda solo i nodi toccati', () => {
    const card = box('DIV', 'card', { left: 10, top: 10, width: 100, height: 40, right: 110, bottom: 50 });
    const dom = installCssDom({ nodes: [card], stack: [card], hit: () => card });
    const bee = makeCore();
    const css = new CSSAdapter(bee);
    css.attach();
    try {
        bee.setAdapterEnabled('css', true);
        const sheetRecord = [{ type: 'attributes', target: { nodeName: 'LINK' } }];
        dom.observers[0].cb(sheetRecord);
        assert.equal(dom.pending(), 0, 'mutazione dei fogli prima del mouse');

        dom.fire('mousemove', { clientX: 20, clientY: 20 });
        dom.flush();
        const container = {
            nodeName: 'BODY',
            nodeType: 1,
            querySelector() { throw new Error('il sottoalbero del target non va ispezionato'); }
        };
        dom.observers[0].cb([{ type: 'childList', target: container, addedNodes: [], removedNodes: [] }]);
        assert.equal(dom.pending(), 0, 'una mutazione dentro il body non invalida i fogli');

        dom.observers[0].cb([{
            type: 'childList',
            target: container,
            addedNodes: [{ nodeType: 1, nodeName: 'STYLE' }],
            removedNodes: []
        }]);
        assert.equal(dom.pending(), 1, 'un <style> aggiunto invalida i fogli');
        dom.flush();
        dom.observers[0].cb([{ type: 'childList', target: { nodeName: 'STYLE', nodeType: 1 }, addedNodes: [], removedNodes: [] }]);
        assert.equal(dom.pending(), 1, 'nuovo testo dentro un <style>');
        dom.flush();

        bee.setAdapterEnabled('css', false);
        bee.setAdapterEnabled('css', true);
        dom.observers[1].cb(sheetRecord);
        assert.equal(dom.pending(), 0, 'il flag del puntatore si azzera con la caccia spenta');
    } finally {
        dom.restore();
        bee.destroy();
    }
});

test('scan salta #wpadminbar, nodi nascosti e blocchi della barra admin', () => {
    const pull = box('DIV', 'pull', RECT, { marginLeft: '-8px' });
    const admin = box('DIV', 'wpadminbar', { left: 0, top: 0, width: 800, height: 30, right: 800, bottom: 30 });
    const toolbar = box('A', 'toolbar', { left: 300, top: 100, width: 40, height: 20, right: 340, bottom: 120 }, { marginLeft: '-8px' });
    toolbar.parentElement = admin;
    const secret = box('DIV', 'secret', RECT, { display: 'none', marginLeft: '-8px' });
    const ghost = box('DIV', 'ghost', { left: 0, top: 0, width: 0, height: 20, right: 0, bottom: 20 }, { marginLeft: '-8px' });
    const btn = box('BUTTON', 'btn', { left: 300, top: 100, width: 40, height: 20, right: 340, bottom: 120 });
    const dom = installCssDom({
        nodes: [pull, admin, toolbar, secret, ghost, btn],
        hit: (x, y) => (x >= 300 && x <= 340 && y >= 100 && y <= 120 ? toolbar : null)
    });
    const bee = makeCore();
    const css = new CSSAdapter(bee);
    let detail = [];
    bee.publishDetail = (items) => {
        detail = items;
        return bee;
    };
    css.attach();
    try {
        bee.setAdapterEnabled('css', true);
        css.scan();
        const texts = detail.map((item) => item.text);
        assert.ok(texts.some((text) => text.startsWith('div#pull negative margin')), texts.join(' | '));
        for (const name of ['toolbar', 'secret', 'ghost', 'wpadminbar']) {
            assert.equal(texts.some((text) => text.includes(name)), false, name);
        }
        assert.equal(texts.some((text) => text.includes('click blocked')), false);
    } finally {
        dom.restore();
        bee.destroy();
    }
});

test('un colore in sintassi moderna non è testo invisibile, un colore trasparente sì', () => {
    const nodes = [
        worded('oklch', 'Hi', 'oklch(0.7 0.15 180)'),
        worded('lab', 'Hi', 'lab(50% 40 59.5)'),
        worded('srgb', 'Hi', 'color(srgb 1 0 0)'),
        worded('mix', 'Hi', 'color-mix(in srgb, red 40%, blue)'),
        worded('clear', 'Hi', 'transparent'),
        worded('zero', 'Hi', 'rgba(0, 0, 0, 0)'),
        worded('slash', 'Hi', 'rgb(0 0 0 / 0)'),
        worded('plain', 'Hi', 'rgb(10, 20, 30)')
    ];
    const dom = installCssDom({ nodes });
    const bee = makeCore();
    const css = new CSSAdapter(bee);
    css.attach();
    try {
        const rows = css.snapshot().items.filter((item) => item.rule === 'invisible text');
        assert.deepEqual(rows.map((item) => item.selector).sort(), ['div#clear', 'div#slash', 'div#zero']);
        for (const row of rows) assert.equal(row.value, 'invisible text (transparent color)');
    } finally {
        dom.restore();
        bee.destroy();
    }
});

test('fogli disabilitati o con media inattiva non entrano tra le !important', () => {
    const hot = box('DIV', 'hot', RECT);
    hot.matches = (selector) => selector === '.hot';
    hot.classList = ['hot'];
    hot.id = '';
    const dom = installCssDom({
        nodes: [hot],
        styleSheets: [
            { disabled: true, cssRules: [importantRule('.hot', 'color', 'red')] },
            {
                disabled: true,
                href: 'https://cdn.example/off.css',
                get cssRules() { throw new Error('cross-origin'); }
            },
            { media: { mediaText: 'print' }, cssRules: [importantRule('.hot', 'background', 'blue')] },
            { media: { mediaText: 'screen' }, cssRules: [importantRule('.hot', 'border', 'none')] },
            { media: { mediaText: '' }, cssRules: [importantRule('.hot', 'margin-top', '0')] }
        ]
    });
    globalThis.matchMedia = (query) => ({ matches: query === 'screen' });
    const bee = makeCore();
    const css = new CSSAdapter(bee);
    css.attach();
    try {
        const values = css.snapshot().items.filter((item) => item.rule === '!important').map((item) => item.value).sort();
        assert.deepEqual(values, ['!important .hot { border: none }', '!important .hot { margin-top: 0 }']);
        assert.equal(css.snapshot().items.some((item) => item.rule === 'unreadable sheet'), false);
    } finally {
        dom.restore();
        bee.destroy();
    }
});

test('snapshot tiene gli errori anche con molte cause will-change', () => {
    const hero = box('DIV', 'hero', RECT, { transform: 'translateZ(0)' });
    const trapped = box('SPAN', 'trapped', RECT, { zIndex: '3' });
    trapped.parentElement = hero;
    const nodes = [hero, trapped];
    for (let i = 0; i < 100; i++) {
        const layer = box('DIV', `hint${i}`, RECT, { willChange: 'opacity' });
        const floater = box('SPAN', `floater${i}`, RECT, { zIndex: '4' });
        floater.parentElement = layer;
        nodes.push(layer, floater);
    }
    const dom = installCssDom({ nodes });
    const bee = makeCore();
    const css = new CSSAdapter(bee);
    css.attach();
    try {
        const items = css.snapshot().items;
        assert.equal(items.length, 80, 'taglio finale a MAX_SNAPSHOT');
        assert.equal(items[0].rule, 'stacking context');
        assert.equal(items[0].severity, 'error');
        assert.equal(items.filter((item) => item.rule === 'will-change').length, 79);
    } finally {
        dom.restore();
        bee.destroy();
    }
});

test('disable azzera css.target, css.hits e css.pin', () => {
    const card = box('DIV', 'card', { left: 10, top: 10, width: 100, height: 40, right: 110, bottom: 50 });
    const dom = installCssDom({ nodes: [card], stack: [card], hit: () => card });
    const bee = makeCore();
    const css = new CSSAdapter(bee);
    css.attach();
    const states = watchStates(bee);
    try {
        bee.setAdapterEnabled('css', true);
        dom.fire('mousemove', { clientX: 20, clientY: 20 });
        dom.flush();
        dom.fire('keydown', dom.key('KeyP'));
        assert.deepEqual(valuesOf(states.seen, 'css.pin'), ['div#card']);

        const mark = states.seen.length;
        bee.setAdapterEnabled('css', false);
        const after = states.seen.slice(mark);
        assert.deepEqual(valuesOf(after, 'css.hunt'), ['off']);
        assert.deepEqual(valuesOf(after, 'css.target'), ['—']);
        assert.deepEqual(valuesOf(after, 'css.hits'), ['0']);
        assert.deepEqual(valuesOf(after, 'css.pin'), ['off']);
    } finally {
        states.off();
        dom.restore();
        bee.destroy();
    }
});

test('hover su nulla riporta css.hits a 0 e cssPath fa escape di id e classi', () => {
    const odd = box('DIV', 'x:y', RECT, { marginLeft: '-8px' });
    const klass = box('SPAN', '', RECT, { marginLeft: '-8px' });
    klass.classList = ['a.b', 'c d', 'third'];
    const stack = [odd];
    const dom = installCssDom({ nodes: [odd, klass], stack });
    const bee = makeCore();
    const css = new CSSAdapter(bee);
    css.attach();
    const states = watchStates(bee);
    try {
        const selectors = css.snapshot().items.filter((item) => item.rule === 'negative margin').map((item) => item.selector).sort();
        assert.deepEqual(selectors, ['div#x\\:y', 'span.a\\.b.c\\ d']);

        bee.setAdapterEnabled('css', true);
        dom.fire('mousemove', { clientX: 5, clientY: 5 });
        dom.flush();
        assert.deepEqual(valuesOf(states.seen, 'css.target'), ['div#x\\:y']);
        assert.deepEqual(valuesOf(states.seen, 'css.hits'), ['1']);

        stack.length = 0;
        dom.fire('mousemove', { clientX: 6, clientY: 6 });
        dom.flush();
        assert.deepEqual(valuesOf(states.seen, 'css.target'), ['div#x\\:y', '—']);
        assert.deepEqual(valuesOf(states.seen, 'css.hits'), ['1', '0']);
    } finally {
        states.off();
        dom.restore();
        bee.destroy();
    }
});

test('WebDOMAdapter non sceglie i box della caccia CSS come hover', () => {
    const chrome = box('DIV', 'chrome', RECT);
    chrome.hasAttribute = (name) => name === 'data-bee-ladybug-css';
    const card = box('DIV', 'card', RECT);
    const dom = installCssDom({ nodes: [], stack: [chrome, card] });
    const bee = makeCore();
    const dom2 = new WebDOMAdapter(bee, { root: null, overlay: false, autoTick: false });
    dom2.attach();
    try {
        dom.fire('mousemove', { clientX: 20, clientY: 20 });
        dom2.pump();
        assert.equal(dom2.hover, card);
    } finally {
        dom2.detach();
        dom.restore();
        bee.destroy();
    }
});
