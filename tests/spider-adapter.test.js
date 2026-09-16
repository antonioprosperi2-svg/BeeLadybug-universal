import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { BeeLadybugCore, SpiderAdapter, SPIDER_ADAPTER_DEFAULTS } from '../src/index.js';

const NativePerformanceObserver = globalThis.PerformanceObserver;

function makeCore() {
    return new BeeLadybugCore({
        ui: false,
        mount: false,
        autoAttach: false,
        autoStart: false
    });
}

function restorePerformanceObserver() {
    if (NativePerformanceObserver) globalThis.PerformanceObserver = NativePerformanceObserver;
    else delete globalThis.PerformanceObserver;
}

function installFakePerformanceObserver(supported) {
    const observers = [];
    function FakePerformanceObserver(cb) {
        this.cb = cb;
        this.opts = null;
        this.disconnected = false;
        observers.push(this);
    }
    FakePerformanceObserver.supportedEntryTypes = supported;
    FakePerformanceObserver.prototype.observe = function observe(opts) {
        this.opts = opts;
    };
    FakePerformanceObserver.prototype.disconnect = function disconnect() {
        this.disconnected = true;
    };
    FakePerformanceObserver.prototype.emit = function emit(entries) {
        this.cb({ getEntries: () => entries });
    };
    globalThis.PerformanceObserver = FakePerformanceObserver;
    return observers;
}

afterEach(() => {
    restorePerformanceObserver();
});

test('SpiderAdapter attach con PerformanceObserver nativo o assente non lancia', () => {
    const bee = makeCore();
    const spider = new SpiderAdapter(bee);
    spider.attach();
    assert.equal(bee.getAdapters()[0].name, 'spider');
    spider.detach();
    assert.equal(bee.getAdapters().length, 0);
    bee.destroy();
});

test('SpiderAdapter senza longtask logga una tantum e osserva le resource', () => {
    const observers = installFakePerformanceObserver(['resource']);
    const bee = makeCore();
    const spider = new SpiderAdapter(bee, { resourceThreshold: 500 });
    assert.equal(SPIDER_ADAPTER_DEFAULTS.longTaskThreshold, 50);

    spider.attach();
    const logs = bee.getLogs().filter((packet) => (
        packet.source === 'spider' && String(packet.payload.message).includes('Long task detection')
    ));
    assert.equal(logs.length, 1);
    assert.equal(bee.getAdapters()[0].label, 'SPIDER');
    assert.equal(observers.length, 1);
    assert.deepEqual(observers[0].opts, { entryTypes: ['resource'] });

    observers[0].emit([
        { name: 'https://cdn.example/app.js', duration: 120 },
        { name: 'https://cdn.example/slow.js', duration: 640 }
    ]);
    const warn = bee.getLogs().find((packet) => packet.type === 'warn' && packet.source === 'spider');
    assert.ok(warn);
    assert.match(String(warn.payload.message), /Risorsa lenta: https:\/\/cdn\.example\/slow\.js \(640ms\)/);

    spider.detach();
    assert.equal(observers[0].disconnected, true);
    assert.equal(bee.getAdapters().length, 0);
    bee.destroy();
});

test('SpiderAdapter emette telemetry per longtask sopra soglia', () => {
    const observers = installFakePerformanceObserver(['longtask', 'resource']);
    const bee = makeCore();
    const seen = [];
    bee.subscribe((packet) => {
        if (packet.type === 'telemetry') seen.push(packet);
    });
    const spider = new SpiderAdapter(bee);
    spider.attach();

    const long = observers.find((obs) => obs.opts && obs.opts.entryTypes[0] === 'longtask');
    assert.ok(long, 'atteso un observer longtask dal mock');
    long.emit([
        { duration: 20, attribution: [{ containerType: 'window' }] },
        { duration: 90, attribution: [{ containerType: 'iframe' }] }
    ]);

    assert.equal(seen.length, 1);
    assert.equal(seen[0].source, 'spider');
    assert.equal(seen[0].payload.kind, 'longtask');
    assert.equal(seen[0].payload.duration, 90);
    assert.equal(seen[0].payload.attribution, 'iframe');
    assert.equal(bee.getHistory('longtask').last, 90);

    spider.detach();
    bee.destroy();
});
