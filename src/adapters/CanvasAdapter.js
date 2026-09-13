/**
 * CanvasAdapter — game / Canvas 2D translator.
 *
 * Next slice: read hitboxes, collisions and host FPS, then push packets
 * into the core. The core must never import this file.
 *
 * @example
 * const adapter = new CanvasAdapter(core, { canvas, entities });
 * adapter.attach();
 * // inside the game loop: adapter.pump();
 */
export class CanvasAdapter {
    /**
     * @param {import('../core/BeeLadybugCore.js').BeeLadybugCore} core
     * @param {{ canvas?: HTMLCanvasElement, entities?: object[] }} [options]
     */
    constructor(core, options = {}) {
        this.core = core;
        this.canvas = options.canvas ?? null;
        this.entities = options.entities ?? [];
        this.#attached = false;
    }

    #attached;

    attach() {
        if (this.#attached) return this;
        this.#attached = true;
        this.core?.sendData('log', {
            source: 'canvas',
            message: 'CanvasAdapter attached. pump() will be implemented next.'
        });
        return this;
    }

    detach() {
        this.#attached = false;
        return this;
    }

    /**
     * Call once per host frame. Translates canvas/game state into sendData packets.
     */
    pump() {
        if (!this.#attached || !this.core) return this;
        return this;
    }
}
