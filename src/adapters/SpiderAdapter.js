/**
 * SpiderAdapter — long-task and slow-resource tracker.
 *
 * Native PerformanceObserver only. The core must never import this file.
 *
 * @example
 * const spider = new SpiderAdapter(core, { resourceThreshold: 500 });
 * spider.attach();
 */

export const SPIDER_ADAPTER_DEFAULTS = Object.freeze({
    longTaskThreshold: 50,
    resourceThreshold: 500,
    source: 'spider'
});

export class SpiderAdapter {
    /**
     * @param {import('../core/BeeLadybugCore.js').BeeLadybugCore} core
     * @param {Partial<typeof SPIDER_ADAPTER_DEFAULTS>} [options]
     */
    constructor(core, options = {}) {
        const cfg = { ...SPIDER_ADAPTER_DEFAULTS, ...options };
        this.core = core;
        this.longTaskThreshold = positive(cfg.longTaskThreshold, SPIDER_ADAPTER_DEFAULTS.longTaskThreshold);
        this.resourceThreshold = positive(cfg.resourceThreshold, SPIDER_ADAPTER_DEFAULTS.resourceThreshold);
        this.source = cfg.source;

        this.#attached = false;
        this.#longObserver = null;
        this.#resourceObserver = null;
        this.#longTaskMissingLogged = false;
        this.#onLongTask = (list) => this.#ingestLongTasks(list);
        this.#onResource = (list) => this.#ingestResources(list);
    }

    #attached;
    #longObserver;
    #resourceObserver;
    #longTaskMissingLogged;
    #onLongTask;
    #onResource;

    attach() {
        if (this.#attached) return this;
        this.#attached = true;
        this.#enable();
        this.core?.registerAdapter('spider', {
            enable: () => this.#enable(),
            disable: () => this.#disable(),
            label: 'SPIDER'
        });
        this.core?.sendData('log', {
            source: this.source,
            message: 'SpiderAdapter attached. Watching long tasks and slow resources.'
        });
        return this;
    }

    detach() {
        if (!this.#attached) return this;
        this.#attached = false;
        this.#disable();
        this.core?.unregisterAdapter('spider');
        return this;
    }

    #enable() {
        if (!this.#attached) return;
        if (typeof PerformanceObserver !== 'function') {
            this.#logLongTaskUnavailable();
            return;
        }
        const types = supportedEntryTypes();
        if (types.includes('longtask')) this.#watchLongTasks();
        else this.#logLongTaskUnavailable();
        if (types.includes('resource')) this.#watchResources();
    }

    #disable() {
        if (this.#longObserver) this.#longObserver.disconnect();
        if (this.#resourceObserver) this.#resourceObserver.disconnect();
        this.#longObserver = null;
        this.#resourceObserver = null;
    }

    #watchLongTasks() {
        if (this.#longObserver) return;
        try {
            this.#longObserver = new PerformanceObserver(this.#onLongTask);
            this.#longObserver.observe({ entryTypes: ['longtask'] });
        } catch {
            this.#longObserver = null;
            this.#logLongTaskUnavailable();
        }
    }

    #watchResources() {
        if (this.#resourceObserver) return;
        try {
            this.#resourceObserver = new PerformanceObserver(this.#onResource);
            this.#resourceObserver.observe({ entryTypes: ['resource'] });
        } catch {
            this.#resourceObserver = null;
        }
    }

    #ingestLongTasks(list) {
        if (!this.#attached || !this.core) return;
        const entries = list?.getEntries?.() ?? [];
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (!entry || entry.duration <= this.longTaskThreshold) continue;
            this.core.sendData('telemetry', {
                source: this.source,
                kind: 'longtask',
                duration: entry.duration,
                attribution: entry.attribution?.[0]?.containerType ?? 'unknown'
            });
        }
    }

    #ingestResources(list) {
        if (!this.#attached || !this.core) return;
        const entries = list?.getEntries?.() ?? [];
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (!entry || entry.duration <= this.resourceThreshold) continue;
            this.core.sendData('warn', {
                source: this.source,
                message: `Risorsa lenta: ${entry.name} (${Math.round(entry.duration)}ms)`
            });
        }
    }

    #logLongTaskUnavailable() {
        if (this.#longTaskMissingLogged) return;
        this.#longTaskMissingLogged = true;
        this.core?.sendData('log', {
            source: this.source,
            message: 'Long task detection non disponibile in questo browser'
        });
    }
}

function positive(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function supportedEntryTypes() {
    if (typeof PerformanceObserver !== 'function') return [];
    const list = PerformanceObserver.supportedEntryTypes;
    return list ? [...list] : [];
}
