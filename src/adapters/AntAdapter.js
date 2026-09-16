/**
 * AntAdapter — DOM mutation rate tracker.
 *
 * Independent MutationObserver. Can sit on the same root as WebDOMAdapter.
 * The core must never import this file.
 *
 * @example
 * const ant = new AntAdapter(core, { root: document.body, threshold: 30 });
 * ant.attach();
 */

export const ANT_ADAPTER_DEFAULTS = Object.freeze({
    threshold: 30,
    windowMs: 1000,
    source: 'ant'
});

export class AntAdapter {
    /**
     * @param {import('../core/BeeLadybugCore.js').BeeLadybugCore} core
     * @param {Partial<typeof ANT_ADAPTER_DEFAULTS> & {
     *   root?: ParentNode | null
     * }} [options]
     */
    constructor(core, options = {}) {
        const cfg = { ...ANT_ADAPTER_DEFAULTS, ...options };
        this.core = core;
        this.root = options.root !== undefined
            ? options.root
            : (typeof document !== 'undefined' ? document.body : null);
        this.threshold = positive(cfg.threshold, ANT_ADAPTER_DEFAULTS.threshold);
        this.windowMs = positive(cfg.windowMs, ANT_ADAPTER_DEFAULTS.windowMs);
        this.source = cfg.source;

        this.#attached = false;
        this.#observer = null;
        this.#counts = new WeakMap();
        this.#onMutate = (records) => this.#ingest(records);
    }

    #attached;
    #observer;
    #counts;
    #onMutate;

    attach() {
        if (this.#attached) return this;
        this.#attached = true;
        this.#enable();
        this.core?.registerAdapter('ant', {
            enable: () => this.#enable(),
            disable: () => this.#disable(),
            label: 'ANT'
        });
        this.core?.sendData('log', {
            source: this.source,
            message: 'AntAdapter attached. Watching DOM mutation rate.'
        });
        return this;
    }

    detach() {
        if (!this.#attached) return this;
        this.#attached = false;
        this.#disable();
        this.core?.unregisterAdapter('ant');
        return this;
    }

    #enable() {
        if (!this.#attached || this.#observer) return;
        if (typeof MutationObserver === 'undefined' || !this.root) return;
        this.#counts = new WeakMap();
        this.#observer = new MutationObserver(this.#onMutate);
        try {
            this.#observer.observe(this.root, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true
            });
        } catch {
            this.#observer.disconnect();
            this.#observer = null;
        }
    }

    #disable() {
        if (this.#observer) this.#observer.disconnect();
        this.#observer = null;
        this.#counts = new WeakMap();
    }

    #ingest(records) {
        if (!this.#attached || !this.core || !records?.length) return;
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        for (let i = 0; i < records.length; i++) {
            const node = records[i]?.target;
            if (!node || isBeeChrome(node)) continue;

            let slot = this.#counts.get(node);
            if (!slot || now - slot.windowStart >= this.windowMs) {
                slot = { count: 0, windowStart: now, warned: false };
                this.#counts.set(node, slot);
            }
            slot.count += 1;
            if (slot.count < this.threshold || slot.warned) continue;

            slot.warned = true;
            const selector = nodeSelector(node);
            this.core.sendData('warn', {
                source: this.source,
                message: `High Mutation Rate on ${selector}`,
                node: selector
            });
        }
    }
}

function positive(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nodeSelector(node) {
    const el = node && node.nodeType === 1 ? node : node?.parentElement;
    if (!el || !el.tagName) return 'node';
    if (el.id) return `#${el.id}`;
    const cls = el.classList && el.classList[0];
    if (cls) return `.${cls}`;
    return el.tagName.toLowerCase();
}

function isBeeChrome(node) {
    let el = node && node.nodeType === 1 ? node : node?.parentElement;
    while (el) {
        const tag = el.tagName;
        if (tag === 'BEE-LADYBUG-OVERLAY') return true;
        if (el.hasAttribute?.('data-bee-ladybug-dom')) return true;
        if (el.hasAttribute?.('data-bee-ladybug-canvas')) return true;
        el = el.parentElement;
    }
    return false;
}
