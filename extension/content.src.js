import { BeeLadybugCore, CanvasAdapter, CSSAdapter, WebDOMAdapter } from '../src/index.js';

/**
 * Lives on the page global (MAIN world), outside this bundle.
 * Each injection runs a fresh copy; the global is what remembers on/off.
 */
const STATE_KEY = '__BEE_LADYBUG_EXTENSION__';

function stop(state) {
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

function start() {
    const canvas = document.querySelector('canvas');
    const adapters = [];
    let core;
    try {
        core = new BeeLadybugCore();
        const dom = new WebDOMAdapter(core, {
            root: document.body || document.documentElement
        });
        dom.attach();
        adapters.push(dom);

        const css = new CSSAdapter(core);
        css.attach();
        adapters.push(css);

        if (canvas) {
            const game = new CanvasAdapter(core, { canvas });
            game.attach();
            adapters.push(game);
        }

        globalThis[STATE_KEY] = { core, adapters };
    } catch (error) {
        console.error('[BeeLadybug extension]', error);
        stop({ core, adapters });
    }
}

const current = globalThis[STATE_KEY];
if (current) stop(current);
else start();
