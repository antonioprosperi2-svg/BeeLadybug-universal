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
        this.#active = false;
        this.#observer = null;
        this.#counts = new WeakMap();
        this.#hot = [];
        this.#onMutate = (records) => this.#ingest(records);
    }

    #attached;
    /** False while the ANT button is off: setRoot() must not restart the observer then. */
    #active;
    #observer;
    #counts;
    #hot;
    #onMutate;

    attach() {
        if (this.#attached) return this;
        this.#attached = true;
        this.#turnOn();
        this.core?.registerAdapter('ant', {
            enable: () => this.#turnOn(),
            disable: () => this.#disable(),
            label: 'ANT',
            snapshot: () => this.snapshot()
        });
        if (this.#observer) {
            this.core?.sendData('log', {
                source: this.source,
                message: 'AntAdapter attached. Watching DOM mutation rate.'
            });
        }
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
     * Watch another root. Counters and hot rows restart; `null` stops watching.
     * @param {ParentNode | null} root
     */
    setRoot(root) {
        this.root = root;
        if (!this.#attached) return this;
        this.#reset();
        if (!root || !this.#active) return this;
        this.#warnNotWatching(this.#observe());
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

    #turnOn() {
        if (!this.#attached) return;
        this.#active = true;
        this.#warnNotWatching(this.#observe());
    }

    #disable() {
        this.#active = false;
        this.#reset();
    }

    #reset() {
        if (this.#observer) this.#observer.disconnect();
        this.#observer = null;
        this.#counts = new WeakMap();
        this.#hot = [];
    }

    /** @returns {'' | 'no-root' | 'no-observer' | 'failed'} why nothing is watched, empty when it is */
    #observe() {
        if (this.#observer) return '';
        if (!this.root) return 'no-root';
        if (typeof MutationObserver === 'undefined') return 'no-observer';
        this.#counts = new WeakMap();
        const observer = new MutationObserver(this.#onMutate);
        try {
            observer.observe(this.root, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true
            });
        } catch {
            observer.disconnect();
            return 'failed';
        }
        this.#observer = observer;
        return '';
    }

    #warnNotWatching(reason) {
        if (!reason) return;
        const messages = {
            'no-root': 'no root: mutation rate is not watched. Pass { root } or call setRoot().',
            'no-observer': 'MutationObserver is missing: mutation rate is not watched.',
            failed: 'observe() failed: mutation rate is not watched.'
        };
        this.core?.sendData('warn', { source: this.source, message: messages[reason] });
    }

    #ingest(records) {
        if (!this.#attached || !this.core || !records?.length) return;
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.#prune(now);
        // One layout read per element per batch, however many records it produced.
        const skipped = new Map();
        for (let i = 0; i < records.length; i++) {
            const el = elementOf(records[i]?.target);
            if (!el) continue;
            let skip = skipped.get(el);
            if (skip === undefined) {
                skip = isBeeChrome(el) || isReportNoise(el);
                skipped.set(el, skip);
            }
            if (skip) continue;

            let slot = this.#counts.get(el);
            if (!slot || now - slot.windowStart >= this.windowMs) {
                slot = { count: 0, windowStart: now, warned: false };
                this.#counts.set(el, slot);
            }
            slot.count += 1;
            this.#track(el, slot);
            if (slot.count < this.threshold || slot.warned) continue;

            slot.warned = true;
            const selector = nodeSelector(el);
            this.core.sendData('warn', {
                source: this.source,
                message: `High Mutation Rate on ${selector}`,
                node: selector
            });
        }
    }

    #prune(now) {
        this.#hot = this.#hot.filter((row) => now - row.windowStart < this.windowMs);
    }

    #track(el, slot) {
        const index = this.#hot.findIndex((row) => row.node === el);
        if (slot.count < this.threshold) {
            if (index >= 0) this.#hot.splice(index, 1);
            return;
        }
        const row = {
            node: el,
            selector: nodeSelector(el),
            count: slot.count,
            windowStart: slot.windowStart
        };
        if (index >= 0) this.#hot[index] = row;
        else this.#hot.push(row);
        while (this.#hot.length > MAX_HOT) this.#hot.splice(this.#lowestRow(), 1);
    }

    /** Fewest mutations first; on a tie the older window goes. */
    #lowestRow() {
        let worst = 0;
        for (let i = 1; i < this.#hot.length; i++) {
            const row = this.#hot[i];
            const low = this.#hot[worst];
            if (row.count < low.count || (row.count === low.count && row.windowStart < low.windowStart)) worst = i;
        }
        return worst;
    }
}

function positive(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** A text node counts on its parent element, so one element keeps one window. */
function elementOf(node) {
    if (!node) return null;
    if (node.nodeType === 1) return node;
    return node.parentElement || null;
}

function nodeSelector(node) {
    const el = elementOf(node);
    if (!el || !el.tagName) return 'node';
    if (el.id) return `#${cssEscape(el.id)}`;
    const cls = el.classList && el.classList[0];
    if (cls) return `.${cssEscape(cls)}`;
    return el.tagName.toLowerCase();
}

function cssEscape(value) {
    return String(value).replace(/[^\w-]/g, '\\$&');
}

function isBeeChrome(node) {
    let el = node && node.nodeType === 1 ? node : node?.parentElement;
    while (el) {
        const tag = el.tagName;
        if (tag === 'BEE-LADYBUG-OVERLAY') return true;
        if (el.hasAttribute?.('data-bee-ladybug-dom')) return true;
        if (el.hasAttribute?.('data-bee-ladybug-canvas')) return true;
        if (el.hasAttribute?.('data-bee-ladybug-css')) return true;
        el = el.parentElement;
    }
    return false;
}
