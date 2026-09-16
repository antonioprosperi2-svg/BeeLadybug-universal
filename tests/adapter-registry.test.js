import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BeeLadybugCore } from '../src/index.js';

function makeCore() {
    return new BeeLadybugCore({
        ui: false,
        mount: false,
        autoAttach: false,
        autoStart: false
    });
}

test('registerAdapter tiene hooks generici senza nomi hardcodati', () => {
    const bee = makeCore();
    const calls = [];
    bee.registerAdapter('probe', {
        label: 'PROBE',
        enable: () => calls.push('on'),
        disable: () => calls.push('off')
    });

    assert.deepEqual(bee.getAdapters(), [
        { name: 'probe', label: 'PROBE', enabled: true }
    ]);
    assert.equal(bee.getState().adapters[0].label, 'PROBE');

    bee.toggleAdapter('probe');
    assert.deepEqual(calls, ['off']);
    assert.equal(bee.getAdapters()[0].enabled, false);

    bee.setAdapterEnabled('probe', true);
    assert.deepEqual(calls, ['off', 'on']);
    assert.equal(bee.getAdapters()[0].enabled, true);

    bee.unregisterAdapter('probe');
    assert.equal(bee.getAdapters().length, 0);

    bee.destroy();
});

test('registerAdapter rifiuta hook incompleti', () => {
    const bee = makeCore();
    bee.registerAdapter('broken', { label: 'NOPE' });
    assert.equal(bee.getAdapters().length, 0);
    const warn = bee.getLogs().find((packet) => packet.type === 'warn');
    assert.ok(warn);
    assert.match(String(warn.payload.message), /enable/);
    bee.destroy();
});

test('telemetry restano fuori dalla console e entrano nello history', () => {
    const bee = makeCore();
    bee.sendData('telemetry', { source: 'probe', kind: 'longtask', duration: 80 });
    assert.equal(bee.getLogs().some((packet) => packet.type === 'telemetry'), false);
    assert.equal(bee.getHistory('longtask').last, 80);
    bee.destroy();
});
