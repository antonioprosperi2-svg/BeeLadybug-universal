import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { BeeLadybugCore, WebDOMAdapter, exportReport } from '../src/index.js';

const NativeMutationObserver = globalThis.MutationObserver;
const NativeGetComputedStyle = globalThis.getComputedStyle;

function makeCore() {
    return new BeeLadybugCore({
        ui: false,
        mount: false,
        autoAttach: false,
        autoStart: false
    });
}

function installStyles() {
    globalThis.getComputedStyle = (node) => ({
        display: 'block',
        visibility: 'visible',
        marginTop: '0px',
        marginRight: '0px',
        marginBottom: '0px',
        marginLeft: '0px',
        borderTopWidth: '0px',
        borderRightWidth: '0px',
        borderBottomWidth: '0px',
        borderLeftWidth: '0px',
        paddingTop: '0px',
        paddingRight: '0px',
        paddingBottom: '0px',
        paddingLeft: '0px',
        ...(node && node.styleMap)
    });
}

function installFakeMutationObserver() {
    const observers = [];
    function FakeMutationObserver(cb) {
        this.cb = cb;
        observers.push(this);
    }
    FakeMutationObserver.prototype.observe = function observe() {};
    FakeMutationObserver.prototype.disconnect = function disconnect() {};
    FakeMutationObserver.prototype.emit = function emit(records) {
        this.cb(records);
    };
    globalThis.MutationObserver = FakeMutationObserver;
    return observers;
}

function makeNode(partial = {}) {
    return {
        nodeType: 1,
        tagName: 'DIV',
        id: '',
        className: '',
        classList: [],
        parentElement: null,
        styleMap: null,
        scrollWidth: 100,
        clientWidth: 100,
        scrollHeight: 40,
        clientHeight: 40,
        hasAttribute() {
            return false;
        },
        getBoundingClientRect() {
            return { left: 10, top: 20, width: 100, height: 40, right: 110, bottom: 60 };
        },
        ...partial
    };
}

afterEach(() => {
    if (NativeMutationObserver) globalThis.MutationObserver = NativeMutationObserver;
    else delete globalThis.MutationObserver;
    if (NativeGetComputedStyle) globalThis.getComputedStyle = NativeGetComputedStyle;
    else delete globalThis.getComputedStyle;
});

test('snapshot registra box, problemi e mutazioni e salta il rumore', () => {
    installStyles();
    const observers = installFakeMutationObserver();
    const bee = makeCore();
    const card = makeNode({ id: 'card', classList: ['card'] });
    const hero = makeNode({ id: 'hero' });
    const bleed = makeNode({ id: 'bleed', styleMap: { marginLeft: '-12px' } });
    const clip = makeNode({ id: 'clip', scrollWidth: 180, clientWidth: 100 });
    const flat = makeNode({ id: 'flat', styleMap: { paddingLeft: '200px' } });
    const hidden = makeNode({
        id: 'secret',
        styleMap: { display: 'none' }
    });
    const admin = makeNode({ id: 'wpadminbar' });
    const chrome = makeNode({
        id: 'chrome',
        hasAttribute(name) {
            return name === 'data-bee-ladybug-dom';
        }
    });
    const kids = [card, hero, bleed, clip, flat, hidden, admin, chrome];
    const root = makeNode({
        id: 'stage',
        querySelectorAll(sel) {
            if (sel === '*') return kids;
            if (sel === '.card') return [card];
            return [];
        }
    });
    for (let i = 0; i < kids.length; i++) kids[i].parentElement = root;

    const adapter = new WebDOMAdapter(bee, {
        root,
        overlay: false,
        autoTick: false,
        watch: ['.card']
    });
    adapter.attach();
    adapter.hover = hero;

    const listed = bee.getAdapters().find((entry) => entry.name === 'dom');
    assert.equal(listed.label, 'DOM');
    assert.equal(listed.hotkey, '');
    assert.equal(listed.enabled, true);

    const before = adapter.snapshot();
    const boxes = before.items.filter((item) => item.rule === 'box');
    assert.deepEqual(boxes.map((item) => item.selector), ['div#hero', 'div#card']);
    assert.equal(boxes[0].severity, 'ok');
    assert.equal(
        boxes[0].value,
        'border 100x40 margin 0,0,0,0 padding 0,0,0,0 content 100x40 block'
    );
    assert.equal(before.items.find((item) => item.selector === 'div#bleed').value, '0,0,0,-12');
    assert.equal(before.items.find((item) => item.selector === 'div#bleed').rule, 'negative margin');
    assert.equal(
        before.items.find((item) => item.rule === 'clipped').value,
        'scroll 180x40 client 100x40'
    );
    assert.equal(
        before.items.find((item) => item.rule === 'collapsed content').value,
        'content 0x40'
    );
    assert.equal(before.items.some((item) => item.selector === 'div#secret'), false);
    assert.equal(before.items.some((item) => item.selector === 'div#wpadminbar'), false);
    assert.equal(before.items.some((item) => item.selector === 'div#chrome'), false);

    const quiet = before.items.find((item) => item.rule === 'mutations');
    assert.equal(quiet.selector, 'div#stage');
    assert.equal(quiet.severity, 'ok');
    assert.equal(quiet.value, '+0 -0 attr 0');

    observers[0].emit([
        { type: 'childList', addedNodes: [1, 2], removedNodes: [1], target: card },
        { type: 'attributes', target: card }
    ]);
    const live = adapter.snapshot().items.find((item) => item.rule === 'mutations');
    assert.equal(live.severity, 'warn');
    assert.equal(live.value, '+2 -1 attr 1');

    const report = exportReport(bee, { format: 'json' });
    assert.equal(report.adapters.some((section) => section.name === 'dom'), true);

    adapter.detach();
    assert.equal(adapter.snapshot(), null);
    assert.equal(bee.collectSnapshots().length, 0);
    bee.destroy();
});

test('il pulsante DOM ferma la telemetria e lo snapshot resta disponibile', () => {
    installStyles();
    const bee = makeCore();
    const card = makeNode({ id: 'card', classList: ['card'] });
    const root = makeNode({
        id: 'stage',
        querySelectorAll(sel) {
            return sel === '.card' ? [card] : [];
        }
    });
    const adapter = new WebDOMAdapter(bee, {
        root,
        overlay: false,
        autoTick: false,
        watch: ['.card']
    });
    adapter.attach();
    adapter.pump();
    const samples = bee.getHistory('nodes').values.length;

    bee.setAdapterEnabled('dom', false);
    adapter.pump();
    assert.equal(bee.getHistory('nodes').values.length, samples);
    assert.equal(adapter.snapshot().items[0].selector, 'div#card');

    bee.setAdapterEnabled('dom', true);
    adapter.pump();
    assert.ok(bee.getHistory('nodes').values.length > samples);

    adapter.detach();
    bee.destroy();
});

test('lo snapshot tiene al massimo 40 righe di problemi', () => {
    installStyles();
    const bee = makeCore();
    const nodes = [];
    for (let i = 0; i < 45; i++) {
        nodes.push(makeNode({ id: `n${i}`, scrollWidth: 200, clientWidth: 10 }));
    }
    const root = makeNode({
        id: 'stage',
        querySelectorAll(sel) {
            return sel === '*' ? nodes : [];
        }
    });
    const adapter = new WebDOMAdapter(bee, { root, overlay: false, autoTick: false });
    adapter.attach();
    const problems = adapter.snapshot().items.filter((item) => item.rule === 'clipped');
    assert.equal(problems.length, 40);
    adapter.detach();
    bee.destroy();
});
