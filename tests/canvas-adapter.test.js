import assert from 'node:assert/strict';
import { afterEach, before, test } from 'node:test';
import { BeeLadybugCore, CanvasAdapter, CANVAS_ADAPTER_DEFAULTS } from '../src/index.js';

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
