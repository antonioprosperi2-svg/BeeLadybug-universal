import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { AntAdapter, ANT_ADAPTER_DEFAULTS, BeeLadybugCore } from '../src/index.js';

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

afterEach(() => {
    restoreMutationObserver();
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
