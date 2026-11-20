import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import {
    MISSING_ENTITIES,
    applyEntityMessage,
    entitiesFromMessage,
    findGameCanvas,
    guardHudButtons,
    isHudGameKey,
    pagePlan
} from '../extension/content.src.js';
import { onToggleClick } from '../extension/popup.js';

test('con un canvas parte solo CanvasAdapter, senza canvas partono DOM e CSS', () => {
    assert.deepEqual(pagePlan(true), {
        canvas: true,
        domEnabled: false,
        cssEnabled: false,
        autoPump: true
    });
    assert.deepEqual(pagePlan(false), {
        canvas: false,
        domEnabled: true,
        cssEnabled: true,
        autoPump: false
    });
});

test('il canvas del gioco non è l\'overlay di BeeLadybug', () => {
    const game = { hasAttribute() { return false; } };
    const overlay = {
        hasAttribute(name) { return name === 'data-bee-ladybug-canvas'; }
    };
    const dom = {
        hasAttribute(name) { return name === 'data-bee-ladybug-dom'; }
    };
    const doc = { querySelectorAll() { return [overlay, dom, game]; } };
    assert.equal(findGameCanvas(doc), game);
    assert.equal(findGameCanvas({ querySelectorAll() { return []; } }), null);
});

test('il messaggio entità accetta un array e segna assente tutto il resto', () => {
    const player = { name: 'player', x: 1 };
    assert.deepEqual(entitiesFromMessage({ source: 'bee-ladybug-entities', entities: [player] }), {
        accept: true,
        entities: [player],
        missing: false
    });
    assert.equal(entitiesFromMessage({ source: 'bee-ladybug-entities', entities: null }).missing, true);
    assert.equal(entitiesFromMessage({ source: 'other', entities: [] }).accept, false);
    assert.equal(entitiesFromMessage(null).accept, false);
});

test('senza __BEE_ENTITIES__ l\'HUD avvisa una volta, poi setEntities riceve la lista', () => {
    const warns = [];
    const applied = [];
    const game = { setEntities(list) { applied.push(list); } };
    const core = { sendData(type, payload) { warns.push({ type, payload }); } };
    const state = { warned: false };
    applyEntityMessage(game, core, state, { source: 'bee-ladybug-entities', entities: null });
    applyEntityMessage(game, core, state, { source: 'bee-ladybug-entities', entities: null });
    assert.equal(warns.length, 1);
    assert.equal(warns[0].type, 'warn');
    assert.equal(warns[0].payload.message, MISSING_ENTITIES);
    const list = [{ name: 'player', x: 4 }];
    applyEntityMessage(game, core, state, { source: 'bee-ladybug-entities', entities: list });
    assert.deepEqual(applied, [list]);
    assert.equal(warns.length, 1);
});

test('Spazio e frecce su un bottone dell\'HUD non lo riattivano', () => {
    const events = [];
    const button = {
        blurred: 0,
        blur() { button.blurred += 1; },
        closest(sel) { return sel === 'button' ? button : null; }
    };
    const span = { closest(sel) { return sel === 'button' ? button : null; } };
    const outside = { closest() { return null; } };
    const root = {
        hidden: false,
        hide() { root.hidden = true; },
        contains(node) { return node === button; },
        addEventListener(type, fn) { events.push({ type, fn }); },
        removeEventListener() {}
    };
    guardHudButtons(root);

    function fire(type, event) {
        events.find((entry) => entry.type === type).fn(event);
    }

    const down = { target: span, preventDefault() { down.prevented = true; } };
    fire('mousedown', down);
    assert.equal(down.prevented, true);

    fire('click', { target: button });
    assert.equal(button.blurred, 1);

    const space = {
        code: 'Space',
        target: button,
        preventDefault() { space.prevented = true; },
        stopPropagation() { space.stopped = true; }
    };
    fire('keydown', space);
    assert.equal(space.prevented, true);
    assert.equal(space.stopped, undefined);
    assert.equal(button.blurred, 2);
    assert.equal(root.hidden, false);
    assert.equal(isHudGameKey(space, root), true);

    const arrow = {
        code: 'ArrowLeft',
        target: button,
        preventDefault() { arrow.prevented = true; }
    };
    fire('keydown', arrow);
    assert.equal(arrow.prevented, true);

    const f2 = {
        code: 'F2',
        target: button,
        preventDefault() { f2.prevented = true; }
    };
    fire('keydown', f2);
    assert.equal(f2.prevented, undefined);
    assert.equal(isHudGameKey(f2, root), false);

    const gameKey = {
        code: 'Space',
        target: outside,
        preventDefault() { gameKey.prevented = true; }
    };
    fire('keydown', gameKey);
    assert.equal(gameKey.prevented, undefined);
    assert.equal(isHudGameKey(gameKey, root), false);
});

test('il bridge MAIN copia __BEE_ENTITIES__ ogni 100ms e non porta funzioni', () => {
    const code = readFileSync(new URL('../extension/entity-bridge.js', import.meta.url), 'utf8');
    const sandbox = {
        messages: [],
        intervals: 0,
        cleared: 0,
        setInterval(fn, ms) {
            sandbox.intervals += 1;
            sandbox.tick = fn;
            sandbox.ms = ms;
            return 7;
        },
        clearInterval() { sandbox.cleared += 1; },
        postMessage(data) {
            sandbox.messages.push(structuredClone(data));
        }
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    vm.runInContext(code, sandbox);
    assert.equal(sandbox.intervals, 1);
    assert.equal(sandbox.ms, 100);

    sandbox.__BEE_ENTITIES__ = [{
        name: 'player',
        x: 4,
        y: 8,
        width: 16,
        height: 12,
        update() {}
    }];
    sandbox.tick();
    assert.equal(sandbox.messages.length, 1);
    assert.equal(sandbox.messages[0].source, 'bee-ladybug-entities');
    assert.deepEqual(sandbox.messages[0].entities, [{
        name: 'player',
        x: 4,
        y: 8,
        width: 16,
        height: 12
    }]);

    sandbox.__BEE_ENTITIES__ = undefined;
    sandbox.tick();
    assert.equal(sandbox.messages[1].entities, null);

    sandbox.__BEE_LADYBUG_ENTITY_BRIDGE__.stop();
    assert.equal(sandbox.cleared, 1);
    assert.equal(sandbox.__BEE_LADYBUG_ENTITY_BRIDGE__, undefined);
});

test('il popup si chiude dopo aver inviato l\'HUD alla scheda', async () => {
    const files = [];
    let closed = false;
    const message = await onToggleClick({
        tabs: {
            query: async () => [{ id: 4, url: 'https://example.com/' }]
        },
        scripting: {
            executeScript: async (options) => {
                files.push(options.files[0]);
            }
        }
    }, () => { closed = true; });
    assert.equal(message, '');
    assert.deepEqual(files, ['entity-bridge.js', 'content.js']);
    assert.equal(closed, true);
});

test('una pagina protetta o un\'iniezione fallita lascia il popup aperto', async () => {
    let closed = false;
    const blocked = await onToggleClick({
        tabs: {
            query: async () => [{ id: 4, url: 'chrome://extensions/' }]
        },
        scripting: {
            executeScript: async () => { throw new Error('non deve iniettare'); }
        }
    }, () => { closed = true; });
    assert.equal(closed, false);
    assert.match(blocked, /non si può ispezionare/);

    await assert.rejects(() => onToggleClick({
        tabs: {
            query: async () => [{ id: 4, url: 'https://example.com/' }]
        },
        scripting: {
            executeScript: async () => { throw new Error('boom'); }
        }
    }, () => { closed = true; }));
    assert.equal(closed, false);
});
