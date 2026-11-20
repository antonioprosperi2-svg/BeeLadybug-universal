import { BeeLadybugCore, CanvasAdapter, CSSAdapter, WebDOMAdapter } from '../src/index.js';

/**
 * Lives on the page global (MAIN world), outside this bundle.
 * Each injection runs a fresh copy; the global is what remembers on/off.
 */
const STATE_KEY = '__BEE_LADYBUG_EXTENSION__';
const HOST_TAG = 'bee-ladybug-overlay';

export const ENTITY_MESSAGE = 'bee-ladybug-entities';
export const MISSING_ENTITIES = 'nessuna entità: il gioco deve esporre window.__BEE_ENTITIES__';
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * A page with a game canvas starts the canvas adapter only.
 * DOM and CSS stay registered so the HUD buttons can turn them on.
 * A page without a canvas starts DOM and CSS.
 * @param {boolean} hasCanvas
 */
export function pagePlan(hasCanvas) {
    if (hasCanvas) {
        return { canvas: true, domEnabled: false, cssEnabled: false, autoPump: true };
    }
    return { canvas: false, domEnabled: true, cssEnabled: true, autoPump: false };
}

/**
 * @param {ParentNode | { querySelectorAll?: Function }} doc
 */
export function findGameCanvas(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;
    const list = doc.querySelectorAll('canvas');
    for (let i = 0; i < list.length; i++) {
        const canvas = list[i];
        if (!canvas) continue;
        if (typeof canvas.hasAttribute === 'function' && canvas.hasAttribute('data-bee-ladybug-canvas')) continue;
        if (typeof canvas.hasAttribute === 'function' && canvas.hasAttribute('data-bee-ladybug-dom')) continue;
        return canvas;
    }
    return null;
}

/**
 * @param {unknown} data
 * @returns {{ accept: boolean, entities: object[] | null, missing: boolean }}
 */
export function entitiesFromMessage(data) {
    if (!data || typeof data !== 'object' || data.source !== ENTITY_MESSAGE) {
        return { accept: false, entities: null, missing: false };
    }
    if (Array.isArray(data.entities)) {
        return { accept: true, entities: data.entities, missing: false };
    }
    return { accept: true, entities: null, missing: true };
}

/**
 * Space and arrows activate a focused <button>. They are game keys, not HUD keys.
 * @param {{ code?: string, target?: { closest?: Function } }} event
 * @param {{ contains?: Function }} root
 */
export function isHudGameKey(event, root) {
    if (!event || !GAME_KEYS.has(event.code) || !root) return false;
    const target = event.target;
    const button = target && typeof target.closest === 'function' ? target.closest('button') : null;
    if (!button || typeof root.contains !== 'function') return false;
    return root.contains(button);
}

/**
 * A click focuses the HUD button. The next Space key then fires that button again
 * (PILL hides the panel, DOM toggles the page overlay). Take focus away.
 * @param {{ addEventListener?: Function, removeEventListener?: Function, contains?: Function } | null} root
 */
/**
 * The library still has ASK AI. This build has no registered assistant,
 * so the store build hides the button until a later version.
 * @param {{ querySelector?: Function, appendChild?: Function } | null} root
 */
export function hideAskButton(root) {
    if (!root || typeof root.querySelector !== 'function') return;
    if (typeof document !== 'undefined' && typeof root.appendChild === 'function' && !root.querySelector('style[data-bee-hide-ask]')) {
        const style = document.createElement('style');
        style.setAttribute('data-bee-hide-ask', '');
        style.textContent = 'button[data-act="ask"]{display:none !important}';
        root.appendChild(style);
    }
    const button = root.querySelector('[data-act="ask"]');
    if (!button) return;
    button.hidden = true;
    if (button.style) button.style.display = 'none';
    if (typeof button.setAttribute === 'function') button.setAttribute('aria-hidden', 'true');
}

export function guardHudButtons(root) {
    if (!root || typeof root.addEventListener !== 'function') return function noop() {};

    const onMouseDown = (event) => {
        const button = event.target && typeof event.target.closest === 'function'
            ? event.target.closest('button')
            : null;
        if (!button || !root.contains(button)) return;
        event.preventDefault();
    };

    const onClick = (event) => {
        const button = event.target && typeof event.target.closest === 'function'
            ? event.target.closest('button')
            : null;
        if (!button || !root.contains(button)) return;
        if (typeof button.blur === 'function') button.blur();
    };

    const onKeyDown = (event) => {
        if (!isHudGameKey(event, root)) return;
        event.preventDefault();
        const button = event.target.closest('button');
        if (button && typeof button.blur === 'function') button.blur();
    };

    root.addEventListener('mousedown', onMouseDown, true);
    root.addEventListener('click', onClick, true);
    root.addEventListener('keydown', onKeyDown, true);
    return function unguard() {
        root.removeEventListener('mousedown', onMouseDown, true);
        root.removeEventListener('click', onClick, true);
        root.removeEventListener('keydown', onKeyDown, true);
    };
}

/**
 * @param {{ setEntities?: Function }} game
 * @param {{ sendData?: Function }} core
 * @param {{ warned: boolean }} state
 * @param {unknown} data
 */
export function applyEntityMessage(game, core, state, data) {
    const parsed = entitiesFromMessage(data);
    if (!parsed.accept || !game) return state;
    if (parsed.missing) {
        if (!state.warned && core && typeof core.sendData === 'function') {
            state.warned = true;
            core.sendData('warn', { source: 'canvas', message: MISSING_ENTITIES });
        }
        return state;
    }
    if (typeof game.setEntities === 'function') game.setEntities(parsed.entities);
    return state;
}

function stop(state) {
    if (state && typeof state.unlisten === 'function') {
        try {
            state.unlisten();
        } catch {
            /* the listener must not keep the HUD alive */
        }
    }
    if (state && typeof state.unguard === 'function') {
        try {
            state.unguard();
        } catch {
            /* focus guard is optional */
        }
    }
    try {
        const bridge = globalThis.__BEE_LADYBUG_ENTITY_BRIDGE__;
        if (bridge && typeof bridge.stop === 'function') bridge.stop();
    } catch {
        /* the next click starts a fresh bridge */
    }
    const adapters = state && Array.isArray(state.adapters) ? state.adapters : [];
    for (let i = 0; i < adapters.length; i++) {
        const adapter = adapters[i];
        try {
            if (adapter && typeof adapter.detach === 'function') adapter.detach();
        } catch {
            /* one adapter must not keep the others, or the core, alive */
        }
    }
    try {
        if (state && state.core && typeof state.core.destroy === 'function') state.core.destroy();
    } catch {
        /* the global still has to clear, or the next click cannot start clean */
    }
    globalThis[STATE_KEY] = undefined;
}

function listenEntities(game, core) {
    const state = { warned: false };
    const onMessage = (event) => {
        if (!event || event.source !== globalThis) return;
        applyEntityMessage(game, core, state, event.data);
    };
    globalThis.addEventListener('message', onMessage);
    return () => globalThis.removeEventListener('message', onMessage);
}

function start() {
    const canvas = findGameCanvas(document);
    const plan = pagePlan(Boolean(canvas));
    const adapters = [];
    let core;
    let unguard = function noop() {};
    let unlisten = function noop() {};
    try {
        core = new BeeLadybugCore();
        const host = document.querySelector(HOST_TAG);
        const shadow = host && host.shadowRoot;
        hideAskButton(shadow);
        unguard = guardHudButtons(shadow);

        if (plan.canvas) {
            const game = new CanvasAdapter(core, { canvas, autoPump: true });
            game.attach();
            adapters.push(game);
            unlisten = listenEntities(game, core);

            const dom = new WebDOMAdapter(core, {
                root: document.body || document.documentElement
            });
            dom.attach();
            adapters.push(dom);
            core.setAdapterEnabled('dom', false);

            const css = new CSSAdapter(core);
            css.attach();
            adapters.push(css);
        } else {
            const dom = new WebDOMAdapter(core, {
                root: document.body || document.documentElement
            });
            dom.attach();
            adapters.push(dom);

            const css = new CSSAdapter(core);
            css.attach();
            adapters.push(css);
            core.setAdapterEnabled('css', true);
        }

        globalThis[STATE_KEY] = { core, adapters, unguard, unlisten };
    } catch (error) {
        console.error('[BeeLadybug extension]', error);
        stop({ core, adapters, unguard, unlisten });
    }
}

export function boot() {
    const current = globalThis[STATE_KEY];
    if (current) stop(current);
    else start();
}

if (typeof document !== 'undefined') boot();
