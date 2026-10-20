import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BeeLadybugCore, CSSAdapter } from '../src/index.js';

function makeCore() {
    return new BeeLadybugCore({
        ui: false,
        mount: false,
        autoAttach: false,
        autoStart: false
    });
}

test('CSSAdapter si registra spento, con hotkey F6, senza caccia attiva', () => {
    const bee = makeCore();
    const css = new CSSAdapter(bee);
    css.attach();

    assert.equal(css.active, false);
    assert.deepEqual(bee.getAdapters(), [
        { name: 'css', label: 'F6 CSS', hotkey: 'F6', enabled: false }
    ]);

    css.detach();
    assert.equal(bee.getAdapters().length, 0);
    bee.destroy();
});
