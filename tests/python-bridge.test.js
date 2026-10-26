import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BeeLadybugCore, PythonBridge, exportReport } from '../src/index.js';

function makeCore() {
    return new BeeLadybugCore({
        ui: false,
        mount: false,
        autoAttach: false,
        autoStart: false
    });
}

test('snapshot registra le metriche più recenti senza aprire il socket', () => {
    const bee = makeCore();
    const bridge = new PythonBridge(bee);

    assert.equal(bee.getAdapters()[0].name, 'python');
    assert.equal(bee.getAdapters()[0].label, 'PYTHON');
    assert.equal(bee.getAdapters()[0].hotkey, '');
    assert.equal(bee.getAdapters()[0].enabled, true);
    assert.equal(bridge.status, 'idle');

    bridge.ingest({ type: 'log', message: 'epoch 1' });
    bridge.ingest({ type: 'metric', payload: { name: 'loss', value: 0.12 } });
    bridge.ingest({ type: 'metric', payload: { name: 'loss', value: 0.2, unit: 'avg' } });
    bridge.ingest({ type: 'metric', payload: { name: 'acc', value: 0.91 } });

    const shot = bridge.snapshot();
    assert.equal(shot.name, 'python');
    assert.deepEqual(shot.items, [
        { severity: 'ok', selector: 'loss', rule: 'metric', value: '0.2 avg', source: 'python' },
        { severity: 'ok', selector: 'acc', rule: 'metric', value: '0.91', source: 'python' }
    ]);

    const report = exportReport(bee, { format: 'json' });
    assert.equal(report.adapters.some((section) => section.name === 'python'), true);

    bee.setAdapterEnabled('python', false);
    assert.equal(bridge.status, 'idle');
    assert.equal(bridge.snapshot().items.length, 2);

    bridge.disconnect();
    assert.equal(bridge.snapshot().items[0].value, '0.2 avg');
    bee.destroy();
});
