/**
 * BeeLadybugCore — universal telemetry brain.
 *
 * Knows nothing about Canvas, DOM, Python, or models. Adapters push raw
 * packets through sendData(type, payload). The core stamps them, stores
 * history, owns an independent clock, and forwards snapshots to the UI.
 */

import { UIOverlay } from './UIOverlay.js';
import { buildAssistantSnapshot, normalizeAssistant } from './AiAssistant.js';

export const BEE_LADYBUG_VERSION = '0.4.0';

export const CORE_DEFAULTS = Object.freeze({
    toggleKey: 'F2',
    slowKey: 'F3',
    freezeKey: 'F4',
    slowScale: 0.25,
    maxLogs: 250,
    historySize: 120,
    /** @type {'auto' | false | HTMLElement} */
    mount: 'auto',
    ui: true,
    autoAttach: true,
    autoStart: true
});

/** Packet types the overlay treats as first-class. Anything else is still stored. */
export const WELL_KNOWN_TYPES = Object.freeze([
    'fps',
    'metric',
    'coord',
    'log',
    'warn',
    'error',
    'state',
    'sys',
    'clear',
    'telemetry'
]);

/**
 * @typedef {object} BeePacket
 * @property {number} id
 * @property {string} type
 * @property {Record<string, unknown>} payload
 * @property {number} wallTime
 * @property {number} simTime
 * @property {number} frame
 * @property {string} source
 * @property {'debug'|'info'|'warn'|'error'|null} level
 */

export class BeeLadybugCore {
    /**
     * @param {Partial<typeof CORE_DEFAULTS> & { overlay?: object }} [options]
     */
    constructor(options = {}) {
        const cfg = { ...CORE_DEFAULTS, ...options };
        this.version = BEE_LADYBUG_VERSION;
        this.toggleKey = cfg.toggleKey;
        this.slowKey = cfg.slowKey;
        this.freezeKey = cfg.freezeKey;
        this.slowScale = cfg.slowScale;
        this.maxLogs = cfg.maxLogs;
        this.historySize = cfg.historySize;

        this.visible = true;
        this.frozen = false;
        this.timeScale = 1;

        /** Independent simulated clock (ms). Does not freeze the overlay RAF. */
        this.simTime = 0;
        /** Independent frame counter. Increments only while unfrozen. */
        this.frameCount = 0;
        /** Smoothed overlay tick rate — not the host FPS. */
        this.coreFps = 0;

        /** @type {BeePacket[]} */
        this.#logs = [];
        /** @type {Map<string, number[]>} */
        this.#history = new Map();
        /** @type {Map<string, { value: unknown, unit?: string, type: string }>} */
        this.#hud = new Map();
        /** @type {Map<string, BeePacket>} */
        this.#latest = new Map();
        /** @type {Set<(packet: BeePacket) => void>} */
        this.#listeners = new Set();

        this.#seq = 0;
        this.#lastRaf = 0;
        this.#rafId = 0;
        this.#bound = false;
        this.#onKeyDown = (event) => this.#handleKey(event);
        this.#onTick = (now) => this.#tick(now);
        this.#started = false;
        this.#assistants = new Map();
        this.#activeAssistant = null;
        this.#askBusy = false;
        this.#adapters = new Map();

        this.ui = null;
        if (cfg.ui !== false && typeof document !== 'undefined') {
            this.ui = new UIOverlay(this, options.overlay);
        }

        if (cfg.autoAttach) this.attach();
        if (cfg.mount !== false && this.ui) this.ui.mount(cfg.mount);
        if (cfg.autoStart) this.start();

        this.sendData('sys', { op: 'boot', version: this.version });
        this.sendData('log', {
            source: 'core',
            message: `BeeLadybug ${this.version} online. Waiting for adapters.`
        });
    }

    #logs;
    #history;
    #hud;
    #latest;
    #listeners;
    #seq;
    #lastRaf;
    #rafId;
    #bound;
    #onKeyDown;
    #onTick;
    #started;
    /** @type {Map<string, { name: string, complete: Function }>} */
    #assistants;
    /** @type {string | null} */
    #activeAssistant;
    #askBusy;
    /** @type {Map<string, { name: string, label: string, enabled: boolean, enable: Function, disable: Function }>} */
    #adapters;

    /**
     * Public adapter contract. `type` is a channel name; `payload` is raw data.
     * Scalars are wrapped as `{ value }`.
     *
     * @param {string} type
     * @param {unknown} [payload]
     * @returns {BeePacket | null}
     */
    sendData(type, payload) {
        if (typeof type !== 'string' || !type) return null;

        if (type === 'clear') {
            this.#clear(payload && typeof payload === 'object' ? payload : {});
            return this.#emit(this.#makePacket('sys', { op: 'clear', ...(asObject(payload)) }));
        }

        const packet = this.#makePacket(type, payload);
        this.#latest.set(type, packet);
        this.#ingest(packet);
        return this.#emit(packet);
    }

    /**
     * @param {(packet: BeePacket) => void} handler
     * @returns {() => void} unsubscribe
     */
    subscribe(handler) {
        this.#listeners.add(handler);
        return () => this.#listeners.delete(handler);
    }

    get hasAssistant() {
        return Boolean(this.#activeProvider());
    }

    get assistantBusy() {
        return this.#askBusy;
    }

    /** Registered provider names, insertion order. */
    getAssistants() {
        return [...this.#assistants.keys()];
    }

    /**
     * Add a model without dropping the others. Same `name` updates that slot.
     * The first registration becomes active; later ones do not steal focus.
     * @param {{ name?: string, complete: (input: { question: string, snapshot: object }) => unknown }} provider
     */
    registerAssistant(provider) {
        return this.#putAssistant(provider, { activate: !this.#activeAssistant, via: 'registerAssistant' });
    }

    /**
     * @param {string} name
     */
    setActiveAssistant(name) {
        const key = String(name || '');
        if (!this.#assistants.has(key)) {
            this.sendData('warn', {
                source: 'ai',
                message: `No assistant named "${key}". bee.registerAssistant({ name, complete }) first.`
            });
            return this;
        }
        this.#activeAssistant = key;
        this.sendData('state', { source: 'ai', key: 'ai.assist', value: key });
        this.sendData('log', { source: 'ai', message: `assistant active (${key})` });
        return this;
    }

    /**
     * Register and activate one provider. Does not remove the others.
     * @param {{ name?: string, complete: (input: { question: string, snapshot: object }) => unknown }} provider
     */
    setAssistant(provider) {
        return this.#putAssistant(provider, { activate: true, via: 'setAssistant' });
    }

    /**
     * @param {string} [name] omit to drop every provider
     */
    clearAssistant(name) {
        if (name == null || name === '') {
            this.#assistants.clear();
            this.#activeAssistant = null;
        } else {
            const key = String(name);
            this.#assistants.delete(key);
            if (this.#activeAssistant === key) {
                this.#activeAssistant = this.#assistants.keys().next().value ?? null;
            }
        }
        this.sendData('state', {
            source: 'ai',
            key: 'ai.assist',
            value: this.#activeAssistant ?? 'off'
        });
        return this;
    }

    /**
     * Send recent telemetry to the active assistant and print the answer.
     * @param {string} [question]
     * @returns {Promise<string|null>}
     */
    async ask(question = 'Diagnose the current telemetry.') {
        const assistant = this.#activeProvider();
        if (!assistant) {
            this.sendData('warn', {
                source: 'ai',
                message: 'No assistant. bee.registerAssistant({ name, complete }) then ASK AI.'
            });
            return null;
        }
        if (this.#askBusy) {
            this.sendData('warn', { source: 'ai', message: 'assistant busy' });
            return null;
        }
        const q = String(question || 'Diagnose the current telemetry.');
        this.#askBusy = true;
        this.sendData('state', { source: 'ai', key: 'ai.assist', value: 'thinking' });
        this.sendData('log', { source: 'ai', message: `ask: ${q}` });
        try {
            const snapshot = buildAssistantSnapshot(this, q);
            const raw = await assistant.complete({ question: q, snapshot });
            const text = String(raw ?? '').trim() || '(empty answer)';
            this.sendData('log', { source: 'ai', message: text });
            this.sendData('state', { source: 'ai', key: 'ai.assist', value: assistant.name });
            return text;
        } catch (err) {
            this.sendData('error', {
                source: 'ai',
                message: err instanceof Error ? err.message : String(err)
            });
            this.sendData('state', {
                source: 'ai',
                key: 'ai.assist',
                value: assistant?.name ?? 'error'
            });
            return null;
        } finally {
            this.#askBusy = false;
        }
    }

    #activeProvider() {
        return this.#activeAssistant ? this.#assistants.get(this.#activeAssistant) ?? null : null;
    }

    /**
     * Register a toggleable diagnostic adapter. The core stores hooks only —
     * it does not import or special-case adapter modules.
     * @param {string} name
     * @param {{ enable: () => void, disable: () => void, label?: string }} hooks
     */
    registerAdapter(name, hooks = {}) {
        const key = String(name || '').trim();
        if (!key || typeof hooks.enable !== 'function' || typeof hooks.disable !== 'function') {
            this.sendData('warn', {
                source: 'core',
                message: 'registerAdapter() needs a name and { enable, disable }.'
            });
            return this;
        }
        const label = String(hooks.label || key).trim() || key;
        this.#adapters.set(key, {
            name: key,
            label,
            enabled: true,
            enable: hooks.enable,
            disable: hooks.disable
        });
        this.sendData('sys', { op: 'adapter', name: key, registered: true, label, enabled: true });
        return this;
    }

    /**
     * @param {string} name
     */
    unregisterAdapter(name) {
        const key = String(name || '').trim();
        if (!key || !this.#adapters.has(key)) return this;
        this.#adapters.delete(key);
        this.sendData('sys', { op: 'adapter', name: key, registered: false });
        return this;
    }

    /** Registered diagnostic adapters, insertion order. */
    getAdapters() {
        return [...this.#adapters.values()].map((entry) => ({
            name: entry.name,
            label: entry.label,
            enabled: entry.enabled
        }));
    }

    /**
     * @param {string} name
     */
    toggleAdapter(name) {
        const entry = this.#adapters.get(String(name || '').trim());
        if (!entry) return this;
        return this.setAdapterEnabled(entry.name, !entry.enabled);
    }

    /**
     * @param {string} name
     * @param {boolean} enabled
     */
    setAdapterEnabled(name, enabled) {
        const entry = this.#adapters.get(String(name || '').trim());
        if (!entry) return this;
        const next = Boolean(enabled);
        if (entry.enabled === next) return this;
        try {
            if (next) entry.enable();
            else entry.disable();
            entry.enabled = next;
        } catch (err) {
            console.warn('[BeeLadybug] adapter toggle error', err);
        }
        this.sendData('sys', {
            op: 'adapter',
            name: entry.name,
            enabled: entry.enabled
        });
        return this;
    }

    /**
     * @param {{ name?: string, complete: Function }} provider
     * @param {{ activate: boolean, via: string }} opts
     */
    #putAssistant(provider, opts) {
        const next = normalizeAssistant(provider);
        if (!next) {
            this.sendData('warn', {
                source: 'ai',
                message: `${opts.via}() needs { complete(ctx) }. No vendor is bundled.`
            });
            return this;
        }
        this.#assistants.set(next.name, next);
        if (opts.activate) this.#activeAssistant = next.name;
        this.sendData('state', {
            source: 'ai',
            key: 'ai.assist',
            value: this.#activeAssistant ?? next.name
        });
        this.sendData('log', {
            source: 'ai',
            message: `assistant ready (${next.name})`
        });
        return this;
    }


    start() {
        if (this.#started) return this;
        this.#started = true;
        this.#lastRaf = 0;
        if (typeof requestAnimationFrame === 'function') {
            this.#rafId = requestAnimationFrame(this.#onTick);
        }
        return this;
    }

    stop() {
        this.#started = false;
        if (this.#rafId && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.#rafId);
        }
        this.#rafId = 0;
        return this;
    }

    attach() {
        if (this.#bound || typeof window === 'undefined') return this;
        window.addEventListener('keydown', this.#onKeyDown);
        this.#bound = true;
        return this;
    }

    detach() {
        if (!this.#bound || typeof window === 'undefined') return this;
        window.removeEventListener('keydown', this.#onKeyDown);
        this.#bound = false;
        return this;
    }

    destroy() {
        this.stop();
        this.detach();
        this.#listeners.clear();
        this.#logs.length = 0;
        this.#history.clear();
        this.#hud.clear();
        this.#latest.clear();
        this.#assistants.clear();
        this.#activeAssistant = null;
        this.#askBusy = false;
        this.#adapters.clear();
        this.ui?.destroy();
        this.ui = null;
        return this;
    }

    show() {
        if (this.visible) return this;
        this.visible = true;
        this.ui?.setVisible(true);
        this.sendData('sys', { op: 'visibility', visible: true });
        return this;
    }

    hide() {
        if (!this.visible) return this;
        this.visible = false;
        this.ui?.setVisible(false);
        this.sendData('sys', { op: 'visibility', visible: false });
        return this;
    }

    toggle() {
        return this.visible ? this.hide() : this.show();
    }

    /**
     * Stops the simulated clock only. Overlay RAF keeps running.
     * Adapters must listen for `sys` packets with `op: 'freeze'`.
     */
    freeze() {
        if (this.frozen) return this;
        this.frozen = true;
        this.sendData('sys', { op: 'freeze', frozen: true });
        this.sendData('log', { source: 'core', level: 'warn', message: 'Sim clock FREEZE' });
        return this;
    }

    unfreeze() {
        if (!this.frozen) return this;
        this.frozen = false;
        this.sendData('sys', { op: 'freeze', frozen: false });
        this.sendData('log', { source: 'core', message: 'Sim clock RUN' });
        return this;
    }

    toggleFreeze() {
        return this.frozen ? this.unfreeze() : this.freeze();
    }

    setTimeScale(scale) {
        const next = Number(scale);
        if (!Number.isFinite(next) || next < 0) return this;
        this.timeScale = next;
        this.sendData('sys', { op: 'timescale', scale: next });
        return this;
    }

    applySlowMo() {
        if (this.frozen) this.unfreeze();
        const next = this.timeScale === this.slowScale ? 1 : this.slowScale;
        this.setTimeScale(next);
        this.sendData('log', {
            source: 'core',
            message: next === 1 ? 'Sim clock 1x LIVE' : `Sim clock SLOW ${next}x`
        });
        return this;
    }

    restoreRealtime() {
        if (this.frozen) this.unfreeze();
        this.setTimeScale(1);
        this.sendData('log', { source: 'core', message: 'Sim clock 1x LIVE' });
        return this;
    }

    getState() {
        return {
            version: this.version,
            visible: this.visible,
            frozen: this.frozen,
            timeScale: this.timeScale,
            simTime: this.simTime,
            frameCount: this.frameCount,
            coreFps: this.coreFps,
            logCount: this.#logs.length,
            hud: this.getHud(),
            mode: this.#modeLabel(),
            assistant: this.#activeAssistant,
            assistants: this.getAssistants(),
            adapters: this.getAdapters()
        };
    }

    /** @returns {BeePacket[]} */
    getLogs() {
        return this.#logs;
    }

    /**
     * @param {string} name
     * @returns {{ name: string, values: number[], min: number, max: number, avg: number, last: number }}
     */
    getHistory(name) {
        const values = this.#history.get(name) ?? [];
        return summarize(name, values);
    }

    /**
     * Prefer host `fps` history; fall back to the core tick rate.
     * @returns {{ name: string, values: number[], min: number, max: number, avg: number, last: number }}
     */
    getPrimaryHistory() {
        const host = this.#history.get('fps');
        if (host && host.length) return summarize('fps', host);
        const tick = this.#history.get('core.fps');
        return summarize('core.fps', tick ?? []);
    }

    getHud() {
        const out = {};
        for (const [key, entry] of this.#hud) out[key] = entry;
        return out;
    }

    /** @param {string} type */
    getLatest(type) {
        return this.#latest.get(type) ?? null;
    }

    #modeLabel() {
        if (this.frozen) return 'FREEZE';
        if (this.timeScale !== 1) return `SLOW ${this.timeScale}x`;
        return 'LIVE';
    }

    #makePacket(type, payload) {
        const body = asObject(payload);
        const source = typeof body.source === 'string' && body.source ? body.source : 'adapter';
        return {
            id: ++this.#seq,
            type,
            payload: body,
            wallTime: Date.now(),
            simTime: this.simTime,
            frame: this.frameCount,
            source,
            level: inferLevel(type, body)
        };
    }

    #emit(packet) {
        for (const handler of this.#listeners) {
            try {
                handler(packet);
            } catch (err) {
                console.warn('[BeeLadybug] subscriber error', err);
            }
        }
        this.ui?.onPacket(packet);
        return packet;
    }

    #ingest(packet) {
        const { type, payload } = packet;

        if (type === 'sys') return;

        if (type === 'fps') {
            const value = numeric(payload.value ?? payload.fps);
            if (value != null) {
                this.#pushHistory('fps', value);
                this.#hud.set('fps', { value, unit: 'fps', type });
            }
            return;
        }

        if (type === 'metric') {
            const name = String(payload.name ?? payload.key ?? 'metric');
            const value = numeric(payload.value);
            if (value != null) this.#pushHistory(name, value);
            this.#hud.set(name, { value: payload.value, unit: payload.unit, type });
            return;
        }

        if (type === 'coord') {
            const label = String(payload.label ?? payload.name ?? 'coord');
            const x = numeric(payload.x);
            const y = numeric(payload.y);
            this.#hud.set(label, {
                value: x != null && y != null ? `${formatNum(x)}, ${formatNum(y)}` : payload,
                type
            });
            return;
        }

        if (type === 'state') {
            const key = String(payload.key ?? payload.name ?? 'state');
            this.#hud.set(key, { value: payload.value, unit: payload.unit, type });
            return;
        }

        if (type === 'telemetry') {
            const name = String(payload.kind ?? payload.name ?? 'telemetry');
            const value = numeric(payload.duration ?? payload.value);
            if (value != null) this.#pushHistory(name, value);
            return;
        }

        if (isConsoleType(type) || packet.level) {
            this.#pushLog(packet);
        }
    }

    #pushLog(packet) {
        this.#logs.push(packet);
        if (this.#logs.length > this.maxLogs) {
            this.#logs.splice(0, this.#logs.length - this.maxLogs);
        }
    }

    #pushHistory(name, value) {
        let series = this.#history.get(name);
        if (!series) {
            series = [];
            this.#history.set(name, series);
        }
        series.push(value);
        if (series.length > this.historySize) series.shift();
    }

    #clear(payload) {
        const channel = payload.channel ?? payload.type;
        if (!channel || channel === 'logs') this.#logs.length = 0;
        if (!channel || channel === 'history') this.#history.clear();
        if (!channel || channel === 'hud') this.#hud.clear();
        this.ui?.onClear(channel);
    }

    #tick(now) {
        if (!this.#started) return;
        this.#rafId = requestAnimationFrame(this.#onTick);

        const dt = this.#lastRaf ? now - this.#lastRaf : 16.67;
        this.#lastRaf = now;
        const clamped = Math.min(Math.max(dt, 0), 100);
        const instant = clamped > 0 ? 1000 / clamped : 0;
        this.coreFps = this.coreFps ? this.coreFps * 0.9 + instant * 0.1 : instant;
        this.#pushHistory('core.fps', this.coreFps);

        if (!this.frozen) {
            this.simTime += clamped * this.timeScale;
            this.frameCount += 1;
        }

        this.#hud.set('frame', { value: this.frameCount, type: 'sys' });
        this.#hud.set('sim', { value: formatSimTime(this.simTime), type: 'sys' });
        this.#hud.set('scale', { value: `${this.timeScale.toFixed(2)}x`, type: 'sys' });

        if (this.visible) this.ui?.render();
    }

    #handleKey(event) {
        if (event.repeat) return;
        const code = event.code;

        if (code === this.toggleKey) {
            event.preventDefault();
            this.toggle();
            return;
        }

        if (!this.visible) return;

        if (code === this.slowKey) {
            event.preventDefault();
            this.applySlowMo();
            return;
        }

        if (code === this.freezeKey) {
            event.preventDefault();
            this.toggleFreeze();
        }
    }
}

function asObject(payload) {
    if (payload == null) return {};
    if (typeof payload !== 'object') return { value: payload, message: String(payload) };
    return payload;
}

function numeric(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function inferLevel(type, payload) {
    if (payload.level) return String(payload.level);
    if (type === 'error') return 'error';
    if (type === 'warn') return 'warn';
    if (type === 'log' || type === 'debug') return payload.level ?? 'info';
    return null;
}

function isConsoleType(type) {
    return type === 'log' || type === 'warn' || type === 'error' || type === 'debug';
}

function formatNum(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatSimTime(ms) {
    const total = Math.max(0, ms) / 1000;
    const m = Math.floor(total / 60);
    const s = total - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

function summarize(name, values) {
    if (!values.length) {
        return { name, values, min: 0, max: 0, avg: 0, last: 0 };
    }
    let min = values[0];
    let max = values[0];
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
    }
    return {
        name,
        values,
        min,
        max,
        avg: sum / values.length,
        last: values[values.length - 1]
    };
}
