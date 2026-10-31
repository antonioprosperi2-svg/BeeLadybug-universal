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

function fakeContext(canvas) {
    return {
        canvas,
        clears: 0,
        clearRect() { this.clears += 1; },
        save() {},
        restore() {},
        fillRect() {},
        strokeRect() {},
        fillText() {}
    };
}

function installFakeDocument() {
    const previous = globalThis.document;
    const created = [];
    const body = {
        children: [],
        appendChild(node) {
            node.parentNode = body;
            body.children.push(node);
        },
        removeChild(node) {
            body.children = body.children.filter((child) => child !== node);
            node.parentNode = null;
        }
    };
    globalThis.document = {
        body,
        createElement() {
            const node = {
                style: {},
                parentNode: null,
                widthWrites: 0,
                heightWrites: 0,
                setAttribute() {}
            };
            let width = 300;
            let height = 150;
            Object.defineProperty(node, 'width', {
                get: () => width,
                set: (value) => { width = value; node.widthWrites += 1; }
            });
            Object.defineProperty(node, 'height', {
                get: () => height,
                set: (value) => { height = value; node.heightWrites += 1; }
            });
            const ctx = fakeContext(node);
            node.getContext = () => ctx;
            created.push(node);
            return node;
        }
    };
    return {
        body,
        created,
        restore() {
            if (previous === undefined) delete globalThis.document;
            else globalThis.document = previous;
        }
    };
}

function fakeHost(width = 640, height = 360) {
    const host = {
        width,
        height,
        rectReads: 0,
        rect: { left: 10, top: 20, width, height },
        getBoundingClientRect() {
            host.rectReads += 1;
            return host.rect;
        }
    };
    return host;
}

function messages(bee, type) {
    return bee.getLogs()
        .filter((packet) => packet.type === type)
        .map((packet) => String(packet.payload.message));
}

test('left collision usa il nome anche con id e con ":" nel nome', () => {
    const bee = makeCore();
    const orc = { id: 5, name: 'orc:boss', x: 0, y: 0, width: 10, height: 10 };
    const wall = { id: 6, name: 'wall', x: 5, y: 0, width: 10, height: 10 };
    const adapter = makeAdapter(bee, { entities: [orc, wall] });
    adapter.attach();

    adapter.pump();
    assert.ok(messages(bee, 'warn').includes('orc:boss entered collision'));

    wall.x = 100;
    adapter.pump();
    const logs = messages(bee, 'log');
    assert.ok(logs.includes('orc:boss left collision'));
    assert.ok(logs.includes('wall left collision'));
    assert.equal(logs.some((text) => /^\d+ left collision$/.test(text)), false);

    adapter.detach();
    bee.destroy();
});

test('left collision ricorda il nome di un\'entità tolta dalla lista', () => {
    const bee = makeCore();
    const hero = { id: 1, name: 'hero:a', x: 0, y: 0, width: 10, height: 10 };
    const gate = { id: 2, name: 'gate:b', x: 4, y: 0, width: 10, height: 10 };
    const adapter = makeAdapter(bee, { entities: [hero, gate] });
    adapter.attach();
    adapter.pump();

    adapter.setEntities([hero]);
    adapter.pump();
    const logs = messages(bee, 'log');
    assert.ok(logs.includes('gate:b left collision'));
    assert.ok(logs.includes('hero:a left collision'));

    adapter.detach();
    bee.destroy();
});

test('senza canvas e con overlay attivo: un solo warn, nessun errore, telemetria viva', () => {
    const bee = makeCore();
    const fake = installFakeDocument();
    try {
        const adapter = new CanvasAdapter(bee, {
            overlay: true,
            entities: [{ name: 'player', x: 4, y: 8, width: 16, height: 12 }]
        });
        adapter.attach();
        adapter.pump();
        adapter.pump();

        const warns = messages(bee, 'warn').filter((text) => text.includes('no canvas'));
        assert.equal(warns.length, 1);
        assert.match(warns[0], /Pass \{ canvas \} or call setCanvas\(\)/);
        assert.equal(bee.getLogs().find((packet) => String(packet.payload.message).includes('no canvas')).source, 'canvas');
        assert.equal(fake.created.length, 0, 'nessun canvas overlay creato');
        assert.equal(fake.body.children.length, 0);
        assert.equal(bee.getHistory('entities').last, 1);
        assert.ok(bee.getHistory('fps').values.length > 0);

        adapter.detach();
    } finally {
        fake.restore();
        bee.destroy();
    }
});

test('overlay: si monta con il canvas, setCanvas(null) lo smonta, setCanvas lo rimonta', () => {
    const bee = makeCore();
    const fake = installFakeDocument();
    try {
        const adapter = new CanvasAdapter(bee, {
            overlay: true,
            canvas: fakeHost(),
            entities: [{ name: 'player', x: 4, y: 8, width: 16, height: 12 }]
        });
        adapter.attach();
        assert.equal(fake.body.children.length, 1);
        assert.equal(messages(bee, 'warn').some((text) => text.includes('no canvas')), false);

        adapter.setCanvas(null);
        assert.equal(fake.body.children.length, 0);
        adapter.pump();
        assert.equal(bee.getHistory('entities').last, 1);

        adapter.setCanvas(fakeHost());
        assert.equal(fake.body.children.length, 1);

        adapter.detach();
        assert.equal(fake.body.children.length, 0);
    } finally {
        fake.restore();
        bee.destroy();
    }
});

test('syncOverlay assegna width/height solo se cambiano e segue resize e scroll', () => {
    const bee = makeCore();
    const fake = installFakeDocument();
    try {
        const host = fakeHost();
        const adapter = new CanvasAdapter(bee, {
            overlay: true,
            canvas: host,
            entities: [{ name: 'player', x: 4, y: 8, width: 16, height: 12 }]
        });
        adapter.attach();
        const overlay = fake.created[0];
        assert.equal(overlay.widthWrites, 1);
        assert.equal(overlay.heightWrites, 1);
        assert.equal(overlay.style.left, '10px');
        assert.equal(overlay.style.display, 'block');

        adapter.pump();
        adapter.pump();
        adapter.pump();
        assert.equal(overlay.widthWrites, 1);
        assert.equal(overlay.heightWrites, 1);
        assert.ok(overlay.getContext('2d').clears >= 3, 'clearRect resta nel disegno');

        host.width = 800;
        host.rect = { left: 30, top: 40, width: 800, height: 360 };
        adapter.pump();
        assert.equal(overlay.widthWrites, 2);
        assert.equal(overlay.heightWrites, 1);
        assert.equal(overlay.style.left, '30px');
        assert.equal(overlay.style.width, '800px');

        adapter.detach();
    } finally {
        fake.restore();
        bee.destroy();
    }
});

test('dopo detach() e nuovo attach() non escono left collision falsi', () => {
    const bee = makeCore();
    const hero = { id: 1, name: 'hero', x: 0, y: 0, width: 10, height: 10 };
    const gate = { id: 2, name: 'gate', x: 4, y: 0, width: 10, height: 10 };
    const adapter = makeAdapter(bee, { entities: [hero, gate] });
    adapter.attach();
    adapter.pump();
    adapter.pump();
    assert.ok(bee.getHistory('fps').values.length > 0);

    adapter.detach();
    gate.x = 200;
    adapter.attach();
    adapter.pump();

    assert.equal(messages(bee, 'log').some((text) => text.includes('left collision')), false);
    assert.equal(messages(bee, 'warn').filter((text) => text.includes('entered collision')).length, 2);

    adapter.detach();
    bee.destroy();
});

test('stopAutoPump() ferma il loop e riabilita pump() manuale senza warn', async () => {
    const bee = makeCore();
    const adapter = makeAdapter(bee, { autoPump: true });
    adapter.attach();
    await delay(90);
    assert.ok(bee.getHistory('entities').values.length > 0);

    assert.equal(adapter.stopAutoPump(), adapter);
    assert.equal(adapter.autoPump, false);
    const stopped = bee.getHistory('entities').values.length;
    await delay(80);
    assert.equal(bee.getHistory('entities').values.length, stopped, 'il loop interno deve fermarsi');

    adapter.pump();
    assert.equal(bee.getHistory('entities').values.length, stopped + 1);
    assert.equal(messages(bee, 'warn').some((text) => text.includes('autoPump')), false);

    adapter.startAutoPump();
    assert.equal(adapter.autoPump, true);
    adapter.detach();
    bee.destroy();
});
