import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { BeeLadybugCore, WebDOMAdapter, domNoiseQuiet, exportReport } from '../src/index.js';

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

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
        this.targets = [];
        this.disconnects = 0;
        observers.push(this);
    }
    FakeMutationObserver.prototype.observe = function observe(target) {
        this.targets.push(target);
    };
    FakeMutationObserver.prototype.disconnect = function disconnect() {
        this.disconnects += 1;
    };
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

function collect(bee, type) {
    const seen = [];
    const off = bee.subscribe((packet) => {
        if (packet.type === type) seen.push(packet);
    });
    return { seen, off };
}

function stateValues(seen, key) {
    return seen.filter((packet) => packet.payload.key === key).map((packet) => packet.payload.value);
}

function installFakeDom(size = { w: 800, h: 600 }) {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const created = [];
    globalThis.window = {
        innerWidth: size.w,
        innerHeight: size.h,
        devicePixelRatio: 1,
        addEventListener() {},
        removeEventListener() {}
    };
    const body = {
        appendChild(node) { node.parentNode = body; },
        removeChild(node) { node.parentNode = null; }
    };
    globalThis.document = {
        body,
        createElement() {
            const writes = { width: 0, height: 0, display: 0, bitmapW: 0, bitmapH: 0 };
            const ctx = {
                clears: 0,
                setTransform() {},
                clearRect() { this.clears += 1; },
                save() {},
                restore() {}
            };
            const node = {
                parentNode: null,
                writes,
                ctx,
                setAttribute() {},
                getContext() { return ctx; }
            };
            const style = {};
            node.style = new Proxy(style, {
                set(target, key, value) {
                    if (key in writes) writes[key] += 1;
                    target[key] = value;
                    return true;
                }
            });
            let bitmapW = 300;
            let bitmapH = 150;
            Object.defineProperty(node, 'width', {
                get: () => bitmapW,
                set: (value) => { bitmapW = value; writes.bitmapW += 1; }
            });
            Object.defineProperty(node, 'height', {
                get: () => bitmapH,
                set: (value) => { bitmapH = value; writes.bitmapH += 1; }
            });
            created.push(node);
            return node;
        }
    };
    return {
        created,
        restore() {
            if (previousWindow === undefined) delete globalThis.window;
            else globalThis.window = previousWindow;
            if (previousDocument === undefined) delete globalThis.document;
            else globalThis.document = previousDocument;
        }
    };
}

test('setRoot attiva l\'observer partito senza root, lo ricicla e lo spegne con null', () => {
    installStyles();
    const observers = installFakeMutationObserver();
    const bee = makeCore();
    const adapter = new WebDOMAdapter(bee, { root: null, overlay: false, autoTick: false });
    adapter.attach();
    assert.equal(observers.length, 0);

    const inside = makeNode({ id: 'inside' });
    const outside = makeNode({ id: 'outside' });
    const first = makeNode({ id: 'first', contains: (node) => node === inside });
    adapter.setRoot(first);
    assert.equal(observers.length, 1);
    assert.deepEqual(observers[0].targets, [first]);

    adapter.hover = inside;
    const second = makeNode({ id: 'second', contains: (node) => node === inside });
    adapter.setRoot(second);
    assert.equal(observers.length, 1, 'stesso observer, nessun duplicato');
    assert.equal(observers[0].disconnects, 1);
    assert.deepEqual(observers[0].targets, [first, second]);
    assert.equal(adapter.hover, inside, 'hover dentro il nuovo root resta');

    adapter.hover = outside;
    adapter.setRoot(second);
    assert.equal(adapter.hover, null, 'hover fuori dal nuovo root si azzera');

    adapter.hover = inside;
    adapter.setRoot(null);
    assert.equal(observers[0].disconnects, 3);
    assert.equal(adapter.hover, null);
    observers[0].emit([{ type: 'attributes', target: first }]);

    adapter.setRoot(first);
    assert.equal(observers.length, 2, 'dopo null serve un observer nuovo');
    assert.deepEqual(observers[1].targets, [first]);

    adapter.detach();
    adapter.setRoot(second);
    assert.equal(observers.length, 2, 'da staccato nessun observer');
    bee.destroy();
});

test('con adapter disabilitato le mutazioni non emettono warn né metric', async () => {
    installStyles();
    const observers = installFakeMutationObserver();
    const bee = makeCore();
    const root = makeNode({ id: 'stage' });
    const adapter = new WebDOMAdapter(bee, { root, overlay: false, autoTick: false });
    adapter.attach();

    const warns = collect(bee, 'warn');
    const metrics = collect(bee, 'metric');
    const rec = { type: 'childList', addedNodes: [1], removedNodes: [], target: root };

    observers[0].emit([rec]);
    bee.setAdapterEnabled('dom', false);
    await delay(260);
    assert.equal(warns.seen.length, 0, 'il timer in coda viene annullato');
    assert.equal(metrics.seen.filter((p) => p.payload.name === 'mutations').length, 0);
    assert.equal(adapter.snapshot().items.find((item) => item.rule === 'mutations').value, '+0 -0 attr 0');

    observers[0].emit([rec]);
    await delay(260);
    assert.equal(warns.seen.length, 0);
    assert.equal(metrics.seen.filter((p) => p.payload.name === 'mutations').length, 0);

    bee.setAdapterEnabled('dom', true);
    observers[0].emit([rec]);
    await delay(260);
    assert.equal(warns.seen.length, 1);
    assert.equal(warns.seen[0].payload.message, 'mutate +1');

    warns.off();
    metrics.off();
    adapter.detach();
    bee.destroy();
});

test('detach azzera hover, fps e contatori: un nuovo attach riparte pulito', async () => {
    installStyles();
    const observers = installFakeMutationObserver();
    const bee = makeCore();
    const hero = makeNode({ id: 'hero' });
    const root = makeNode({ id: 'stage' });
    const adapter = new WebDOMAdapter(bee, { root, overlay: false, autoTick: false });
    adapter.attach();
    adapter.hover = hero;

    observers[0].emit([{ type: 'childList', addedNodes: [1, 2], removedNodes: [1], target: root }]);
    await delay(260);
    observers[0].emit([{ type: 'attributes', target: root }]);
    assert.equal(adapter.snapshot().items.find((item) => item.rule === 'mutations').value, '+0 -0 attr 1');

    adapter.pump();
    adapter.pump();
    assert.equal(bee.getHistory('fps').values.length > 0, true);

    adapter.detach();
    assert.equal(adapter.hover, null);

    const states = collect(bee, 'state');
    const fps = collect(bee, 'fps');
    adapter.attach();
    assert.equal(adapter.snapshot().items.find((item) => item.rule === 'mutations').value, '+0 -0 attr 0');
    assert.equal(adapter.snapshot().items.some((item) => item.rule === 'box'), false, 'nessun hover vecchio');

    adapter.pump();
    assert.equal(fps.seen.length, 0, 'il primo pump dopo attach non ha fps');
    assert.deepEqual(stateValues(states.seen, 'hover'), [], 'nessun reset hover fantasma');

    states.off();
    fps.off();
    adapter.detach();
    bee.destroy();
});

test('quando hover passa a null anche lo state display torna a —', () => {
    installStyles();
    const bee = makeCore();
    const hero = makeNode({ id: 'hero', styleMap: { display: 'flex' } });
    const adapter = new WebDOMAdapter(bee, { root: makeNode({ id: 'stage' }), overlay: false, autoTick: false });
    adapter.attach();
    const states = collect(bee, 'state');

    adapter.hover = hero;
    adapter.pump();
    assert.deepEqual(stateValues(states.seen, 'display'), ['flex']);
    assert.deepEqual(stateValues(states.seen, 'hover'), ['div#hero']);

    adapter.hover = null;
    adapter.pump();
    assert.deepEqual(stateValues(states.seen, 'display'), ['flex', '—']);
    assert.deepEqual(stateValues(states.seen, 'hover'), ['div#hero', '—']);
    assert.deepEqual(stateValues(states.seen, 'box'), ['100×40', '—']);

    adapter.pump();
    assert.deepEqual(stateValues(states.seen, 'display'), ['flex', '—'], 'il reset esce una volta sola');

    states.off();
    adapter.detach();
    bee.destroy();
});

test('syncOverlay assegna bitmap e stile solo quando cambiano', () => {
    installStyles();
    const fake = installFakeDom();
    const bee = makeCore();
    try {
        const adapter = new WebDOMAdapter(bee, { root: makeNode({ id: 'stage' }), autoTick: false });
        adapter.attach();
        const canvas = fake.created[0];
        assert.deepEqual(
            [canvas.writes.bitmapW, canvas.writes.bitmapH, canvas.writes.width, canvas.writes.height, canvas.writes.display],
            [1, 1, 1, 1, 1]
        );
        assert.equal(canvas.style.display, 'block');

        adapter.pump();
        adapter.pump();
        adapter.pump();
        assert.deepEqual(
            [canvas.writes.bitmapW, canvas.writes.bitmapH, canvas.writes.width, canvas.writes.height, canvas.writes.display],
            [1, 1, 1, 1, 1]
        );
        assert.equal(canvas.ctx.clears, 3, 'clearRect resta in ogni frame');

        globalThis.window.innerWidth = 1024;
        adapter.pump();
        assert.equal(canvas.writes.bitmapW, 2);
        assert.equal(canvas.writes.bitmapH, 1);
        assert.equal(canvas.style.width, '1024px');
        assert.equal(canvas.writes.height, 1);

        bee.setAdapterEnabled('dom', false);
        assert.equal(canvas.style.display, 'none');
        assert.equal(canvas.writes.display, 2);

        adapter.detach();
        adapter.attach();
        const remounted = fake.created[1];
        assert.equal(remounted.style.width, '1024px');
        assert.equal(remounted.style.display, 'block');
        adapter.detach();
    } finally {
        fake.restore();
        bee.destroy();
    }
});

test('domNoiseQuiet è esportata dall\'indice e segue la regola F6/F3', () => {
    assert.equal(typeof domNoiseQuiet, 'function');
    assert.equal(domNoiseQuiet(false, false, 1), false);
    assert.equal(domNoiseQuiet(true, false, 1), true);
    assert.equal(domNoiseQuiet(true, false, 0.25), false);
    assert.equal(domNoiseQuiet(true, true, 0.25), true);
});
