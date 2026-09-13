/**
 * WebDOMAdapter — HTML / layout translator.
 *
 * Next slice: observe inspected nodes, box model, pointer target and
 * mutation noise, then push packets into the core.
 */
export class WebDOMAdapter {
    /**
     * @param {import('../core/BeeLadybugCore.js').BeeLadybugCore} core
     * @param {{ root?: ParentNode }} [options]
     */
    constructor(core, options = {}) {
        this.core = core;
        this.root = options.root ?? (typeof document !== 'undefined' ? document.body : null);
        this.#attached = false;
    }

    #attached;

    attach() {
        if (this.#attached) return this;
        this.#attached = true;
        this.core?.sendData('log', {
            source: 'dom',
            message: 'WebDOMAdapter attached. observers will be implemented next.'
        });
        return this;
    }

    detach() {
        this.#attached = false;
        return this;
    }

    pump() {
        if (!this.#attached || !this.core) return this;
        return this;
    }
}
