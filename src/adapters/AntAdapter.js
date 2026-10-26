/**
 * AntAdapter — DOM mutation rate tracker.
 *
 * Independent MutationObserver. Can sit on the same root as WebDOMAdapter.
 * `snapshot()` lists nodes still over the mutation threshold.
 * The core must never import this file.
 *
 * @example
 * const ant = new AntAdapter(core, { root: document.body, threshold: 30 });
 * ant.attach();
 */

import { isReportNoise } from '../core/ReportExporter.js';

const MAX_HOT = 40;

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
        this.#hot = [];
        this.#onMutate = (records) => this.#ingest(records);
    }

    #attached;
    #observer;
    #counts;
    #hot;
    #onMutate;

    attach() {
        if (this.#attached) return this;
        this.#attached = true;
        this.#enable();
        this.core?.registerAdapter('ant', {
            enable: () => this.#enable(),
            disable: () => this.#disable(),
            label: 'ANT',
            snapshot: () => this.snapshot()
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

    /**
     * Nodes whose current window is still at or above the threshold.
     * Hidden boxes, the WordPress admin bar, and BeeLadybug chrome are skipped.
     * @returns {{ name: string, items: Array<{ severity: string, selector: string, rule: string, value: string, source: string }> } | null}
     */
    snapshot() {
        if (!this.#attached) return null;
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const items = [];
        for (let i = 0; i < this.#hot.length && items.length < MAX_HOT; i++) {
            const row = this.#hot[i];
            if (!row || now - row.windowStart >= this.windowMs) continue;
            if (isBeeChrome(row.node) || isReportNoise(row.node)) continue;
            items.push({
                severity: 'warn',
                selector: row.selector,
                rule: 'mutations',
                value: `${row.count}/${this.windowMs}ms`,
                source: this.source
            });
        }
        return { name: 'ant', items };
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
        this.#hot = [];
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
            this.#track(node, slot);
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

    #track(node, slot) {
        const index = this.#hot.findIndex((row) => row.node === node);
        if (slot.count < this.threshold) {
            if (index >= 0) this.#hot.splice(index, 1);
            return;
        }
        const row = {
            node,
            selector: nodeSelector(node),
            count: slot.count,
            windowStart: slot.windowStart
        };
        if (index >= 0) this.#hot[index] = row;
        else this.#hot.push(row);
        if (this.#hot.length > MAX_HOT) this.#hot.splice(0, this.#hot.length - MAX_HOT);
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
