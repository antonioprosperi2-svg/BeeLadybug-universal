import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BeeLadybugCore, exportReport, isReportNoise } from '../src/index.js';

function makeCore() {
    return new BeeLadybugCore({
        ui: false,
        mount: false,
        autoAttach: false,
        autoStart: false
    });
}

test('exportReport JSON raccoglie log, serie e snapshot registrati', () => {
    const bee = makeCore();
    bee.sendData('fps', { value: 10, source: 'host' });
    bee.sendData('fps', { value: 30, source: 'host' });
    bee.sendData('metric', { name: 'heap', value: 4, unit: 'MB', source: 'host' });
    bee.sendData('warn', { source: 'host', message: 'slow frame' });

    bee.registerAdapter('silent', {
        enable() {},
        disable() {}
    });
    bee.registerAdapter('probe', {
        enabled: false,
        enable() {},
        disable() {},
        snapshot() {
            return {
                name: 'probe',
                items: [
                    { severity: 'error', selector: 'div.hero', rule: 'overflow', value: '12px', source: 'css' },
                    { severity: 'info', selector: 'a, b', rule: 'note', value: 'say "hi"', source: 'probe' }
                ]
            };
        }
    });

    const report = exportReport(bee, { format: 'json' });
    assert.equal(typeof report, 'object');
    assert.equal(report.version, bee.version);
    assert.equal(report.url, '');
    assert.equal(report.viewport, null);
    assert.match(report.fileStamp, /^\d{8}-\d{4}$/);

    const fps = report.series.find((entry) => entry.name === 'fps');
    assert.equal(fps.min, 10);
    assert.equal(fps.max, 30);
    assert.equal(fps.avg, 20);
    assert.deepEqual(fps.samples, [10, 30]);

    const heap = report.series.find((entry) => entry.name === 'heap');
    assert.equal(heap.last, 4);

    assert.ok(report.logs.some((entry) => entry.message.includes('BeeLadybug')));
    assert.ok(report.logs.some((entry) => entry.type === 'warn' && entry.message === 'slow frame'));
    assert.equal(report.adapters.length, 1);
    assert.equal(report.adapters[0].name, 'probe');
    assert.equal(report.adapters[0].items[1].severity, 'ok');
    assert.deepEqual(report.summary, { error: 1, warn: 1, ok: 2 });
    assert.equal(bee.ui, null);

    bee.destroy();
});

test('exportReport CSV e HTML restano stringhe e non scaricano in headless', () => {
    const bee = makeCore();
    assert.equal(bee.ui, null);
    const previousDocument = globalThis.document;
    const previousCreate = URL.createObjectURL;
    globalThis.document = {
        body: {},
        createElement() {
            throw new Error('download');
        }
    };
    URL.createObjectURL = () => {
        throw new Error('download');
    };

    try {
        bee.registerAdapter('probe', {
            enable() {},
            disable() {},
            snapshot() {
                return {
                    items: [{
                        severity: 'warn',
                        selector: 'a, b',
                        rule: 'note',
                        value: 'say "hi"',
                        source: 'probe'
                    }]
                };
            }
        });

        const csv = exportReport(bee, { format: 'csv' });
        assert.match(csv, /^adapter,severity,selector,rule,value,source\n/);
        assert.match(csv, /probe,warn,"a, b",note,"say ""hi""",probe/);

        const html = exportReport(bee, { format: 'html' });
        assert.equal(typeof html, 'string');
        assert.match(html, /BeeLadybug report \d{8}-\d{4}/);
        assert.match(html, /say &quot;hi&quot;/);
        assert.match(html, /print-color-adjust: exact/);
    } finally {
        if (previousCreate === undefined) delete URL.createObjectURL;
        else URL.createObjectURL = previousCreate;
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        bee.destroy();
    }
});

test('uno snapshot che fallisce diventa una riga warn e gli altri restano', () => {
    const bee = makeCore();
    bee.registerAdapter('bad', {
        enable() {},
        disable() {},
        snapshot() {
            throw new Error('boom');
        }
    });
    bee.registerAdapter('ok', {
        enable() {},
        disable() {},
        snapshot() {
            return null;
        }
    });

    const report = exportReport(bee, { format: 'json' });
    assert.equal(report.adapters.length, 1);
    assert.equal(report.adapters[0].items[0].rule, 'snapshot');
    assert.equal(report.adapters[0].items[0].value, 'boom');
    assert.equal(report.summary.warn, 1);
    bee.destroy();
});

test('isReportNoise salta nascosti, barra WordPress e chrome BeeLadybug', () => {
    assert.equal(isReportNoise(null), false);
    assert.equal(isReportNoise({ id: 'wpadminbar', nodeType: 1 }), true);
    assert.equal(isReportNoise({ className: 'ab-item', nodeType: 1 }), true);
    assert.equal(isReportNoise({
        nodeType: 1,
        parentElement: { id: 'wpadminbar', nodeType: 1 }
    }), true);
    assert.equal(isReportNoise({ tagName: 'BEE-LADYBUG-OVERLAY', nodeType: 1 }), true);
    assert.equal(isReportNoise({
        nodeType: 1,
        hasAttribute(name) { return name === 'data-bee-ladybug-css'; },
        getBoundingClientRect() { return { width: 20, height: 20 }; }
    }), true);
    assert.equal(isReportNoise({
        nodeType: 1,
        id: 'hero',
        className: 'hero',
        getBoundingClientRect() { return { width: 0, height: 40 }; }
    }), true);

    const previous = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({ display: 'none', visibility: 'visible' });
    try {
        assert.equal(isReportNoise({
            nodeType: 1,
            id: 'box',
            getBoundingClientRect() { return { width: 10, height: 10 }; }
        }), true);
    } finally {
        if (previous === undefined) delete globalThis.getComputedStyle;
        else globalThis.getComputedStyle = previous;
    }

    assert.equal(isReportNoise({
        nodeType: 1,
        id: 'hero',
        className: 'hero',
        getBoundingClientRect() { return { width: 12, height: 12 }; }
    }), false);

    const bar = { id: 'wpadminbar', nodeType: 1, parentElement: null };
    const menu = { nodeType: 1, id: 'menu', className: 'menu', parentElement: bar };
    const icon = {
        nodeType: 1,
        tagName: 'SPAN',
        id: '',
        className: '',
        classList: ['ab-icon'],
        parentElement: menu
    };
    assert.equal(isReportNoise(icon), true);
    assert.equal(isReportNoise(menu), true);
    assert.equal(isReportNoise({
        nodeType: 1,
        className: '',
        classList: ['ab-icon'],
        getBoundingClientRect() { return { width: 16, height: 16 }; }
    }), true);
});

test('righe identiche contano una volta, warm diventa warn, e il log entra nel riepilogo', () => {
    const bee = makeCore();
    bee.sendData('error', { source: 'core', message: 'boom', level: 'warm' });
    bee.registerAdapter('probe', {
        enable() {},
        disable() {},
        snapshot() {
            return {
                items: [
                    { severity: 'error', selector: 'div.hero', rule: 'overflow', value: '12px', source: 'css' },
                    { severity: 'error', selector: 'div.hero', rule: 'overflow', value: '12px', source: 'css' },
                    { severity: 'warm', selector: 'span', rule: 'note', value: 'x', source: 'probe' }
                ]
            };
        }
    });

    const report = exportReport(bee, { format: 'json' });
    const overflow = report.adapters[0].items.find((item) => item.rule === 'overflow');
    assert.equal(overflow.value, '12px ×2');
    assert.equal(report.adapters[0].items.filter((item) => item.rule === 'overflow').length, 1);
    assert.equal(report.adapters[0].items.find((item) => item.rule === 'note').severity, 'warn');
    assert.equal(report.logs.some((entry) => entry.level === 'warm'), true);
    assert.equal(report.summary.error, 1);
    assert.ok(report.summary.warn >= 2);
    assert.ok(report.summary.ok >= 1);

    const html = exportReport(bee, { format: 'html' });
    assert.match(html, /12px ×2/);
    bee.destroy();
});

test('il download si chiama report-AAAAMMGG-HHMM.html', () => {
    const bee = makeCore();
    bee.ui = { mounted: true, destroy() {} };
    const links = [];
    const previousDocument = globalThis.document;
    const previousCreate = URL.createObjectURL;
    const previousRevoke = URL.revokeObjectURL;
    globalThis.document = {
        body: {
            appendChild(node) { links.push(node); },
            removeChild() {}
        },
        createElement() {
            const node = { href: '', download: '', rel: '', click() {}, remove() {} };
            node.setAttribute = (name, value) => {
                if (name === 'download') node.download = value;
            };
            return node;
        }
    };
    URL.createObjectURL = () => 'blob:report';
    URL.revokeObjectURL = () => {};

    try {
        const html = exportReport(bee, { format: 'html' });
        assert.equal(typeof html, 'string');
        assert.equal(links.length, 1);
        assert.match(links[0].download, /^report-\d{8}-\d{4}\.html$/);
    } finally {
        if (previousCreate === undefined) delete URL.createObjectURL;
        else URL.createObjectURL = previousCreate;
        if (previousRevoke === undefined) delete URL.revokeObjectURL;
        else URL.revokeObjectURL = previousRevoke;
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        bee.destroy();
    }
});
