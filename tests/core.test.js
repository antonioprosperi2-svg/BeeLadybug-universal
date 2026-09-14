import assert from 'node:assert/strict';
import { afterEach, before, test } from 'node:test';
import { BeeLadybugCore, BEE_LADYBUG_VERSION } from '../src/index.js';

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

before(() => {
    installFakeRaf();
});

afterEach(() => {
    // ogni test distrugge la propria istanza
});

test('boot headless: versione, visibilità, log di avvio', () => {
    const bee = makeCore();
    const state = bee.getState();
    const logs = bee.getLogs();

    assert.equal(bee.version, BEE_LADYBUG_VERSION);
    assert.equal(state.visible, true);
    assert.equal(state.frozen, false);
    assert.equal(state.timeScale, 1);
    assert.equal(state.frameCount, 0);
    assert.ok(logs.some((p) => p.source === 'core' && String(p.payload.message).includes('online')));

    bee.destroy();
});

test('sendData timbra wallTime, simTime e frame', () => {
    const bee = makeCore();
    const before = Date.now();
    const packet = bee.sendData('log', { message: 'probe', source: 'test' });
    const after = Date.now();

    assert.ok(packet);
    assert.equal(packet.type, 'log');
    assert.equal(packet.source, 'test');
    assert.equal(typeof packet.wallTime, 'number');
    assert.equal(typeof packet.simTime, 'number');
    assert.equal(typeof packet.frame, 'number');
    assert.ok(packet.wallTime >= before && packet.wallTime <= after);
    assert.equal(packet.simTime, bee.simTime);
    assert.equal(packet.frame, bee.frameCount);
    assert.equal(bee.getLatest('log'), packet);

    bee.destroy();
});

test('subscribe riceve i pacchetti e unsubscribe li ferma', () => {
    const bee = makeCore();
    const seen = [];
    const off = bee.subscribe((packet) => seen.push(packet));

    bee.sendData('warn', { message: 'once', source: 'test' });
    off();
    bee.sendData('warn', { message: 'twice', source: 'test' });

    const warns = seen.filter((p) => p.type === 'warn');
    assert.equal(warns.length, 1);
    assert.equal(warns[0].payload.message, 'once');

    bee.destroy();
});

test('freeze blocca il clock fittizio; sendData resta vivo', async () => {
    const bee = makeCore();
    bee.start();
    await delay(80);

    assert.ok(bee.frameCount > 0);
    assert.ok(bee.simTime > 0);

    bee.freeze();
    const frozenFrame = bee.frameCount;
    const frozenSim = bee.simTime;
    await delay(80);

    assert.equal(bee.frozen, true);
    assert.equal(bee.frameCount, frozenFrame);
    assert.equal(bee.simTime, frozenSim);

    const packet = bee.sendData('metric', { name: 'probe', value: 1, source: 'test' });
    assert.equal(packet.frame, frozenFrame);
    assert.equal(packet.simTime, frozenSim);

    bee.unfreeze();
    await delay(80);
    assert.equal(bee.frozen, false);
    assert.ok(bee.frameCount > frozenFrame);

    bee.destroy();
});
