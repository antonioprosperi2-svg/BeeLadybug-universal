import assert from 'node:assert/strict';
import { afterEach, before, test } from 'node:test';
import { BeeLadybugCore, CanvasAdapter, CANVAS_ADAPTER_DEFAULTS, exportReport } from '../src/index.js';

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function installFakeRaf() {
    let now = 0;
    globalThis.requestAnimationFrame = (cb) => {
        return setTimeout(() => {
            now += 16.67;
            cb(now);
        }, 16);
    };
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}

function makeCore() {
    return new BeeLadybugCore({
        ui: false,
        mount: false,
        autoAttach: false,
        autoStart: false
    });
}

function makeAdapter(core, extra = {}) {
    return new CanvasAdapter(core, {
        overlay: false,
        entities: [{ name: 'player', x: 4, y: 8, width: 16, height: 12 }],
        ...extra
    });
}

before(() => {
    installFakeRaf();
});

afterEach(() => {
    // ogni test distrugge la propria istanza
});

test('autoPump è disattivo di default', () => {
    assert.equal(CANVAS_ADAPTER_DEFAULTS.autoPump, false);
    const bee = makeCore();
    const adapter = makeAdapter(bee);
    assert.equal(adapter.autoPump, false);
    bee.destroy();
});

test('autoPump spinge fps e metriche senza pump() dell\'host', async () => {
    const bee = makeCore();
    const adapter = makeAdapter(bee, { autoPump: true });
    adapter.attach();

    await delay(90);

    const fps = bee.getHistory('fps');
    const entities = bee.getHistory('entities');
    assert.ok(fps.values.length > 0, 'attesi campioni fps da autoPump');
    assert.ok(entities.values.length > 0, 'attesi campioni entities da autoPump');
    assert.equal(entities.last, 1);

    adapter.detach();
    const afterDetach = bee.getHistory('entities').values.length;
    await delay(80);
    assert.equal(
        bee.getHistory('entities').values.length,
        afterDetach,
        'autoPump deve fermarsi su detach()'
    );

    bee.destroy();
});

test('pump() manuale con autoPump attivo avvisa e non ricalcola', async () => {
    const bee = makeCore();
    const adapter = makeAdapter(bee, { autoPump: true });
    const metrics = [];
    const off = bee.subscribe((packet) => {
        if (packet.type === 'metric' && packet.payload.name === 'entities') {
            metrics.push(packet);
        }
    });
    adapter.attach();

    const before = metrics.length;
    adapter.pump();
    assert.equal(metrics.length, before);

    const warn = bee.getLogs().find((packet) => (
        packet.type === 'warn'
        && packet.source === 'canvas'
        && String(packet.payload.message).includes('autoPump')
    ));
    assert.ok(warn, 'atteso warn se pump() è chiamato a mano durante autoPump');

    adapter.pump();
    const warns = bee.getLogs().filter((packet) => (
        packet.type === 'warn' && String(packet.payload.message).includes('autoPump')
    ));
    assert.equal(warns.length, 1, 'il warn manuale non deve floodare i log');

    off();
    adapter.detach();
    bee.destroy();
});

test('startAutoPump() dopo attach avvia il loop interno', async () => {
    const bee = makeCore();
    const adapter = makeAdapter(bee);
    adapter.attach();
    assert.equal(bee.getHistory('entities').values.length, 0);

    adapter.startAutoPump();
    assert.equal(adapter.autoPump, true);
    await delay(90);
    assert.ok(bee.getHistory('entities').values.length > 0);

    adapter.detach();
    bee.destroy();
});

test('pump() manuale resta valido senza autoPump', () => {
    const bee = makeCore();
    const adapter = makeAdapter(bee);
    adapter.attach();
    adapter.pump();
    adapter.pump();

    assert.equal(bee.getHistory('entities').last, 1);
    assert.ok(bee.getHistory('fps').values.length > 0);
    assert.equal(
        bee.getLogs().some((packet) => String(packet.payload.message).includes('autoPump')),
        false
    );

    adapter.detach();
    bee.destroy();
});

test('snapshot elenca hitbox, collisioni e fps e si registra sul core', () => {
    const bee = makeCore();
    const adapter = new CanvasAdapter(bee, {
        overlay: false,
        entities: [
            { name: 'player', x: 0, y: 0, width: 10, height: 10 },
            { name: 'wall', x: 5, y: 0, width: 10, height: 10 },
            { name: 'idle', x: 100, y: 100, width: 8, height: 8 },
            { name: 'dot', x: 400.24, y: 500.25, width: 3.04, height: 4 }
        ]
    });
    adapter.attach();

    const listed = bee.getAdapters().find((entry) => entry.name === 'canvas');
    assert.equal(listed.label, 'CANVAS');
    assert.equal(listed.hotkey, '');
    assert.equal(listed.enabled, true);

    const before = adapter.snapshot();
    assert.equal(before.items.some((item) => item.rule === 'fps'), false);
    assert.equal(before.items.find((item) => item.selector === 'player').severity, 'warn');
    assert.match(before.items.find((item) => item.selector === 'player').value, /0,0 10x10 colliding/);
    assert.equal(before.items.find((item) => item.selector === 'idle').severity, 'ok');
    assert.equal(before.items.find((item) => item.selector === 'dot').value, '400.2,500.3 3x4');

    adapter.pump();
    adapter.pump();
    const after = adapter.snapshot();
    const fps = after.items.find((item) => item.rule === 'fps');
    assert.equal(fps.selector, 'host');
    assert.equal(fps.severity, 'ok');
    assert.match(fps.value, /^min [\d.]+ avg [\d.]+ max [\d.]+$/);

    const report = exportReport(bee, { format: 'json' });
    const section = report.adapters.find((entry) => entry.name === 'canvas');
    assert.equal(section.items.filter((item) => item.rule === 'hitbox' && item.severity === 'warn').length, 2);

    bee.getHistory = () => ({ name: 'fps', values: [], min: 0, max: 0, avg: 0, last: 0 });
    const fallback = adapter.snapshot().items.find((item) => item.rule === 'fps');
    assert.match(fallback.value, /^min [\d.]+ avg [\d.]+ max [\d.]+$/);

    adapter.detach();
    assert.equal(adapter.snapshot(), null);
    assert.equal(bee.collectSnapshots().length, 0);
    bee.destroy();
});

test('il pulsante CANVAS ferma la telemetria e lo snapshot resta disponibile', () => {
    const bee = makeCore();
    const adapter = makeAdapter(bee);
    adapter.attach();
    adapter.pump();
    adapter.pump();
    const samples = bee.getHistory('entities').values.length;

    bee.setAdapterEnabled('canvas', false);
    adapter.pump();
    assert.equal(bee.getHistory('entities').values.length, samples);
    assert.equal(adapter.snapshot().items[0].selector, 'player');

    bee.setAdapterEnabled('canvas', true);
    adapter.pump();
    assert.ok(bee.getHistory('entities').values.length > samples);

    adapter.detach();
    bee.destroy();
});
