import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { AntAdapter, ANT_ADAPTER_DEFAULTS, BeeLadybugCore, exportReport } from '../src/index.js';

const NativeMutationObserver = globalThis.MutationObserver;

function makeCore() {
    return new BeeLadybugCore({
        ui: false,
        mount: false,
        autoAttach: false,
        autoStart: false
    });
}

function restoreMutationObserver() {
    if (NativeMutationObserver) globalThis.MutationObserver = NativeMutationObserver;
    else delete globalThis.MutationObserver;
}

function installFakeMutationObserver() {
    const observers = [];
    function FakeMutationObserver(cb) {
        this.cb = cb;
        this.target = null;
        this.options = null;
        this.disconnected = false;
        observers.push(this);
    }
    FakeMutationObserver.prototype.observe = function observe(target, options) {
        this.target = target;
        this.options = options;
    };
    FakeMutationObserver.prototype.disconnect = function disconnect() {
        this.disconnected = true;
    };
    FakeMutationObserver.prototype.emit = function emit(records) {
        this.cb(records);
    };
    globalThis.MutationObserver = FakeMutationObserver;
    return observers;
}

function fakeNode(partial = {}) {
    return {
        nodeType: 1,
        tagName: 'DIV',
        id: '',
        classList: [],
        parentElement: null,
        isConnected: true,
        hasAttribute() {
            return false;
        },
        ...partial
    };
}

const NativeGetComputedStyle = globalThis.getComputedStyle;

function boxed(partial = {}) {
    return fakeNode({
        getBoundingClientRect() {
            return { left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10 };
        },
        ...partial
    });
}

function burst(target, count, type = 'attributes') {
    return Array.from({ length: count }, () => ({ target, type }));
}

function antWarns(bee) {
    return bee.getLogs().filter((packet) => packet.type === 'warn' && packet.source === 'ant');
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
    restoreMutationObserver();
    if (NativeGetComputedStyle) globalThis.getComputedStyle = NativeGetComputedStyle;
    else delete globalThis.getComputedStyle;
});

test('AntAdapter attach senza MutationObserver non lancia', () => {
    delete globalThis.MutationObserver;
    const bee = makeCore();
    const ant = new AntAdapter(bee, { root: fakeNode({ id: 'stage' }) });
    ant.attach();
    assert.equal(bee.getAdapters()[0].name, 'ant');
    ant.detach();
    assert.equal(bee.getAdapters().length, 0);
    bee.destroy();
});

test('AntAdapter soglia e selettore, poi si spegne su detach', () => {
    const observers = installFakeMutationObserver();
    const bee = makeCore();
    const root = fakeNode({ id: 'stage' });
    const hot = fakeNode({ id: 'hot' });
    const ant = new AntAdapter(bee, { root, threshold: 3, windowMs: 1000 });
    assert.equal(ANT_ADAPTER_DEFAULTS.threshold, 30);

    ant.attach();
    assert.equal(bee.getAdapters()[0].name, 'ant');
    assert.equal(bee.getAdapters()[0].label, 'ANT');
    assert.equal(observers.length, 1);

    const burst = Array.from({ length: 4 }, () => ({ target: hot, type: 'attributes' }));
    observers[0].emit(burst);

    const warn = bee.getLogs().find((packet) => packet.type === 'warn' && packet.source === 'ant');
    assert.ok(warn);
    assert.equal(warn.payload.node, '#hot');
    assert.match(String(warn.payload.message), /High Mutation Rate on #hot/);

    observers[0].emit(burst);
    const warns = bee.getLogs().filter((packet) => packet.type === 'warn' && packet.source === 'ant');
    assert.equal(warns.length, 1, 'un solo warn per finestra');

    ant.detach();
    assert.equal(observers[0].disconnected, true);
    assert.equal(bee.getAdapters().length, 0);

    bee.destroy();
});

test('AntAdapter usa la prima classe se manca l\'id', () => {
    const observers = installFakeMutationObserver();
    const bee = makeCore();
    const root = fakeNode();
    const node = fakeNode({ classList: ['card', 'wide'] });
    const ant = new AntAdapter(bee, { root, threshold: 1 });
    ant.attach();
    observers[0].emit([{ target: node, type: 'childList' }, { target: node, type: 'childList' }]);
    const warn = bee.getLogs().find((packet) => packet.type === 'warn' && packet.source === 'ant');
    assert.equal(warn.payload.node, '.card');
    ant.detach();
    bee.destroy();
});

test('snapshot elenca i nodi sopra soglia e salta la barra WordPress', () => {
    const observers = installFakeMutationObserver();
    const bee = makeCore();
    const root = fakeNode({ id: 'stage' });
    const hot = fakeNode({ id: 'hot' });
    const quiet = fakeNode({ id: 'quiet' });
    const admin = fakeNode({ id: 'wpadminbar' });
    const ant = new AntAdapter(bee, { root, threshold: 3, windowMs: 1000 });
    ant.attach();

    observers[0].emit([
        { target: hot, type: 'attributes' },
        { target: hot, type: 'attributes' },
        { target: hot, type: 'attributes' },
        { target: hot, type: 'childList' },
        { target: quiet, type: 'attributes' },
        { target: quiet, type: 'attributes' },
        { target: admin, type: 'attributes' },
        { target: admin, type: 'attributes' },
        { target: admin, type: 'attributes' }
    ]);

    const shot = ant.snapshot();
    assert.equal(shot.name, 'ant');
    assert.equal(shot.items.length, 1);
    assert.equal(shot.items[0].selector, '#hot');
    assert.equal(shot.items[0].rule, 'mutations');
    assert.equal(shot.items[0].severity, 'warn');
    assert.equal(shot.items[0].value, '4/1000ms');

    const report = exportReport(bee, { format: 'json' });
    assert.equal(report.adapters.some((section) => section.name === 'ant'), true);

    bee.setAdapterEnabled('ant', false);
    assert.deepEqual(ant.snapshot().items, []);

    ant.detach();
    assert.equal(ant.snapshot(), null);
    bee.destroy();
});

test('un burst sulla barra admin, sui figli e sui nodi nascosti non produce warn', () => {
    globalThis.getComputedStyle = (node) => ({
        display: node.hiddenBox ? 'none' : 'block',
        visibility: 'visible'
    });
    const observers = installFakeMutationObserver();
    const bee = makeCore();
    const admin = boxed({ id: 'wpadminbar' });
    const icon = boxed({ classList: ['ab-icon'], parentElement: admin });
    const child = boxed({ id: 'menu-item', parentElement: admin });
    const hidden = boxed({ id: 'secret', hiddenBox: true });
    const flat = fakeNode({
        id: 'flat',
        getBoundingClientRect() {
            return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
        }
    });
    const live = boxed({ id: 'live' });
    const ant = new AntAdapter(bee, { root: boxed({ id: 'stage' }), threshold: 3 });
    ant.attach();

    observers[0].emit([
        ...burst(admin, 5),
        ...burst(icon, 5),
        ...burst(child, 5),
        ...burst(hidden, 5),
        ...burst(flat, 5),
        ...burst(live, 5)
    ]);

    assert.deepEqual(antWarns(bee).map((packet) => packet.payload.node), ['#live']);
    assert.deepEqual(ant.snapshot().items.map((item) => item.selector), ['#live']);
    ant.detach();
    bee.destroy();
});

test('characterData conta sull\'elemento: due nodi di testo, una finestra, un warn', () => {
    const observers = installFakeMutationObserver();
    const bee = makeCore();
    const parent = boxed({ id: 'ticker' });
    const first = { nodeType: 3, parentElement: parent };
    const second = { nodeType: 3, parentElement: parent };
    const orphan = { nodeType: 3, parentElement: null };
    const ant = new AntAdapter(bee, { root: boxed({ id: 'stage' }), threshold: 3 });
    ant.attach();

    observers[0].emit([
        { target: first, type: 'characterData' },
        { target: second, type: 'characterData' },
        { target: orphan, type: 'characterData' },
        { target: first, type: 'characterData' },
        { target: second, type: 'characterData' }
    ]);

    const warns = antWarns(bee);
    assert.equal(warns.length, 1);
    assert.equal(warns[0].payload.node, '#ticker');
    assert.deepEqual(ant.snapshot().items.map((item) => [item.selector, item.value]), [['#ticker', '4/1000ms']]);
    ant.detach();
    bee.destroy();
});

test('il selettore fa escape di id e classe come WebDOMAdapter', () => {
    const observers = installFakeMutationObserver();
    const bee = makeCore();
    const odd = boxed({ id: 'x:y' });
    const dotted = boxed({ classList: ['a.b', 'second'] });
    const plain = boxed({ tagName: 'SECTION' });
    const ant = new AntAdapter(bee, { root: boxed({ id: 'stage' }), threshold: 1 });
    ant.attach();
    observers[0].emit([...burst(odd, 1), ...burst(dotted, 1), ...burst(plain, 1)]);
    assert.deepEqual(antWarns(bee).map((packet) => packet.payload.node), ['#x\\:y', '.a\\.b', 'section']);
    ant.detach();
    bee.destroy();
});

test('dopo windowMs la riga esce da #hot e non occupa il tetto di 40', async () => {
    const observers = installFakeMutationObserver();
    const bee = makeCore();
    const ant = new AntAdapter(bee, { root: boxed({ id: 'stage' }), threshold: 2, windowMs: 50 });
    ant.attach();

    const old = Array.from({ length: 40 }, (_, i) => boxed({ id: `old${i}` }));
    for (const node of old) observers[0].emit(burst(node, 5));
    assert.equal(ant.snapshot().items.length, 40);

    await delay(90);
    assert.deepEqual(ant.snapshot().items, [], 'finestre scadute fuori dallo snapshot');

    const fresh = Array.from({ length: 5 }, (_, i) => boxed({ id: `fresh${i}` }));
    for (const node of fresh) observers[0].emit(burst(node, 2));
    assert.deepEqual(
        ant.snapshot().items.map((item) => item.selector).sort(),
        ['#fresh0', '#fresh1', '#fresh2', '#fresh3', '#fresh4'],
        'le righe scadute non spingono fuori quelle nuove'
    );
    ant.detach();
    bee.destroy();
});

test('oltre 40 righe esce quella con meno mutazioni, non la più vecchia', () => {
    const observers = installFakeMutationObserver();
    const bee = makeCore();
    const ant = new AntAdapter(bee, { root: boxed({ id: 'stage' }), threshold: 2, windowMs: 60000 });
    ant.attach();

    observers[0].emit(burst(boxed({ id: 'n0' }), 5));
    for (let i = 1; i < 40; i++) observers[0].emit(burst(boxed({ id: `n${i}` }), 3));
    observers[0].emit(burst(boxed({ id: 'big' }), 4));

    const selectors = ant.snapshot().items.map((item) => item.selector);
    assert.equal(selectors.length, 40);
    assert.equal(selectors.includes('#n0'), true, 'la più vecchia ma con più mutazioni resta');
    assert.equal(selectors.includes('#n1'), false, 'la più vecchia tra quelle col conteggio minimo esce');
    assert.equal(selectors.includes('#big'), true);
    ant.detach();
    bee.destroy();
});

test('attach senza root avvisa una volta e setRoot avvia e ferma l\'observer', () => {
    const observers = installFakeMutationObserver();
    const bee = makeCore();
    const ant = new AntAdapter(bee, { root: null, threshold: 2 });
    ant.attach();

    assert.equal(observers.length, 0);
    const warns = antWarns(bee);
    assert.equal(warns.length, 1);
    assert.equal(warns[0].payload.message, 'no root: mutation rate is not watched. Pass { root } or call setRoot().');
    assert.equal(bee.getLogs().some((packet) => String(packet.payload.message).includes('Watching')), false);

    const stage = boxed({ id: 'stage' });
    const hot = boxed({ id: 'hot' });
    assert.equal(ant.setRoot(stage), ant);
    assert.equal(ant.root, stage);
    assert.equal(observers.length, 1);
    assert.equal(observers[0].target, stage);
    observers[0].emit(burst(hot, 3));
    assert.equal(ant.snapshot().items.length, 1);

    ant.setRoot(null);
    assert.equal(observers[0].disconnected, true);
    assert.deepEqual(ant.snapshot().items, [], 'contatori e righe calde ripartono');
    assert.equal(antWarns(bee).length, 2, 'setRoot(null) è una scelta: nessun warn in più');

    const other = boxed({ id: 'other' });
    ant.setRoot(other);
    assert.equal(observers.length, 2);
    assert.equal(observers[1].target, other);
    observers[1].emit(burst(hot, 2));
    assert.equal(ant.snapshot().items[0].value, '2/1000ms');

    bee.setAdapterEnabled('ant', false);
    ant.setRoot(stage);
    assert.equal(observers.length, 2, 'con il pulsante ANT spento setRoot non riavvia nulla');
    bee.setAdapterEnabled('ant', true);
    assert.equal(observers.length, 3);
    assert.equal(observers[2].target, stage);

    ant.detach();
    ant.setRoot(other);
    assert.equal(observers.length, 3, 'da staccato nessun observer');
    bee.destroy();
});

test('senza MutationObserver o con observe() che lancia: un warn chiaro, nessun "Watching"', () => {
    delete globalThis.MutationObserver;
    const bee = makeCore();
    const ant = new AntAdapter(bee, { root: boxed({ id: 'stage' }) });
    ant.attach();
    assert.deepEqual(antWarns(bee).map((packet) => packet.payload.message), [
        'MutationObserver is missing: mutation rate is not watched.'
    ]);
    ant.detach();
    bee.destroy();

    const observers = installFakeMutationObserver();
    globalThis.MutationObserver.prototype.observe = function observe() {
        throw new Error('bad target');
    };
    const second = makeCore();
    const broken = new AntAdapter(second, { root: boxed({ id: 'stage' }) });
    broken.attach();
    assert.equal(observers[0].disconnected, true);
    assert.equal(antWarns(second).length, 1);
    assert.match(antWarns(second)[0].payload.message, /observe\(\) failed: mutation rate is not watched/);
    assert.equal(second.getLogs().some((packet) => String(packet.payload.message).includes('Watching')), false);
    broken.detach();
    second.destroy();
});
