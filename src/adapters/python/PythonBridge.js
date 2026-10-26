/**
 * PythonBridge — inbound channel for Python / AI / headless processes.
 *
 * Speaks WebSocket JSON and calls core.sendData(type, payload).
 * The core stays browser-side; Python never talks to the overlay.
 *
 * Wire shape (either form):
 *   { "type": "metric", "payload": { "name": "loss", "value": 0.12 } }
 *   { "type": "log", "message": "epoch 3" }
 *
 * ingest() is the same parser used by the socket, so tests and the mock
 * demo do not need a live Python process.
 * `snapshot()` lists the latest metric received for each name.
 */

export const PYTHON_BRIDGE_DEFAULTS = Object.freeze({
    url: 'ws://127.0.0.1:8765',
    autoReconnect: true,
    reconnectMs: 1500,
    source: 'python'
});

export class PythonBridge {
    /**
     * @param {import('../../core/BeeLadybugCore.js').BeeLadybugCore} core
     * @param {Partial<typeof PYTHON_BRIDGE_DEFAULTS>} [options]
     */
    constructor(core, options = {}) {
        const cfg = { ...PYTHON_BRIDGE_DEFAULTS, ...options };
        this.core = core;
        this.url = cfg.url;
        this.autoReconnect = cfg.autoReconnect;
        this.reconnectMs = cfg.reconnectMs;
        this.source = cfg.source;
        this.status = 'idle';

        this.#socket = null;
        this.#wanted = false;
        this.#live = true;
        this.#timer = 0;
        this.#packets = 0;
        this.#retries = 0;
        this.#metrics = new Map();
        this.core?.registerAdapter('python', {
            label: 'PYTHON',
            enabled: true,
            enable: () => this.#enable(),
            disable: () => this.#disable(),
            snapshot: () => this.snapshot()
        });
    }

    #socket;
    #wanted;
    #live;
    #timer;
    #packets;
    #retries;
    #metrics;

    get connected() {
        return this.status === 'open';
    }

    connect(url) {
        if (url) this.url = url;
        this.#wanted = true;
        this.#live = true;
        this.#retries = 0;
        this.#open();
        return this;
    }

    disconnect() {
        this.#wanted = false;
        this.#clearTimer();
        if (this.#socket) {
            try {
                this.#socket.close();
            } catch {
                /* already closing */
            }
            this.#socket = null;
        }
        this.#setStatus('idle');
        this.core?.sendData('log', {
            source: this.source,
            message: 'PythonBridge disconnected.'
        });
        return this;
    }

    /**
     * Latest metric value for each name received through ingest().
     * @returns {{ name: string, items: Array<{ severity: string, selector: string, rule: string, value: string, source: string }> }}
     */
    snapshot() {
        const items = [];
        for (const [name, metric] of this.#metrics) {
            const unit = metric.unit ? ` ${metric.unit}` : '';
            items.push({
                severity: 'ok',
                selector: name,
                rule: 'metric',
                value: `${metricText(metric.value)}${unit}`,
                source: this.source
            });
        }
        return { name: 'python', items };
    }

    /**
     * Parse one wire message (object, JSON string, or array) into sendData().
     * @param {unknown} raw
     */
    ingest(raw) {
        if (!this.core) return this;
        if (raw == null) return this;

        let data = raw;
        if (typeof raw === 'string') {
            const text = raw.trim();
            if (!text) return this;
            try {
                data = JSON.parse(text);
            } catch {
                this.core.sendData('error', {
                    source: this.source,
                    message: `bad JSON: ${text.slice(0, 96)}`
                });
                return this;
            }
        }

        if (Array.isArray(data)) {
            for (let i = 0; i < data.length; i++) this.ingest(data[i]);
            return this;
        }

        if (typeof data !== 'object') return this;

        const type = data.type || data.channel;
        if (typeof type !== 'string' || !type) {
            this.core.sendData('warn', {
                source: this.source,
                message: 'packet missing type'
            });
            return this;
        }

        const payload = unpackPayload(data, this.source);
        if (type === 'metric') this.#rememberMetric(payload);
        this.#packets += 1;
        this.core.sendData(type, payload);
        this.core.sendData('state', {
            source: this.source,
            key: 'py.packets',
            value: this.#packets
        });
        return this;
    }

    #open() {
        if (!this.#wanted || !this.#live) return;
        if (typeof WebSocket === 'undefined') {
            this.core?.sendData('error', {
                source: this.source,
                message: 'WebSocket API missing in this runtime.'
            });
            this.#setStatus('closed');
            return;
        }

        this.#clearTimer();
        if (this.#socket) {
            try {
                this.#socket.close();
            } catch {
                /* ignore */
            }
        }

        this.#setStatus('connecting');
        if (this.#retries === 0) {
            this.core?.sendData('log', {
                source: this.source,
                message: `PythonBridge connecting ${this.url}`
            });
        }

        let socket;
        try {
            socket = new WebSocket(this.url);
        } catch (err) {
            this.core?.sendData('error', {
                source: this.source,
                message: `connect failed: ${err instanceof Error ? err.message : String(err)}`
            });
            this.#setStatus('closed');
            this.#scheduleReconnect();
            return;
        }

        this.#socket = socket;
        socket.addEventListener('open', () => {
            if (socket !== this.#socket) return;
            this.#setStatus('open');
            this.#retries = 0;
            this.core?.sendData('log', {
                source: this.source,
                message: `PythonBridge open (${this.url})`
            });
        });
        socket.addEventListener('message', (event) => {
            if (socket !== this.#socket) return;
            this.ingest(event.data);
        });
        socket.addEventListener('close', () => {
            if (socket !== this.#socket) return;
            this.#socket = null;
            this.#setStatus('closed');
            if (this.#retries === 0) {
                this.core?.sendData('warn', {
                    source: this.source,
                    message: 'PythonBridge socket closed.'
                });
            }
            this.#retries += 1;
            this.#scheduleReconnect();
        });
        socket.addEventListener('error', () => {
            if (this.#retries > 0) return;
            this.core?.sendData('error', {
                source: this.source,
                message: `PythonBridge socket error (${this.url})`
            });
        });
    }

    #scheduleReconnect() {
        if (!this.#wanted || !this.#live || !this.autoReconnect) return;
        this.#clearTimer();
        this.#timer = setTimeout(() => this.#open(), this.reconnectMs);
    }

    #clearTimer() {
        if (this.#timer && typeof clearTimeout === 'function') clearTimeout(this.#timer);
        this.#timer = 0;
    }

    #enable() {
        this.#live = true;
        if (this.#wanted) this.#open();
    }

    #disable() {
        this.#live = false;
        this.#clearTimer();
        const socket = this.#socket;
        this.#socket = null;
        if (socket) {
            try {
                socket.close();
            } catch {
                /* already closing */
            }
        }
        if (this.status !== 'idle') this.#setStatus('closed');
    }

    #rememberMetric(payload) {
        const name = typeof payload.name === 'string' && payload.name ? payload.name : 'metric';
        if (this.#metrics.has(name)) this.#metrics.delete(name);
        this.#metrics.set(name, {
            value: payload.value,
            unit: typeof payload.unit === 'string' ? payload.unit : ''
        });
        while (this.#metrics.size > 40) {
            const oldest = this.#metrics.keys().next().value;
            this.#metrics.delete(oldest);
        }
    }

    #setStatus(status) {
        this.status = status;
        this.core?.sendData('state', {
            source: this.source,
            key: 'py.status',
            value: status
        });
    }
}

function metricText(value) {
    if (value == null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function unpackPayload(data, source) {
    const body = data.payload != null && typeof data.payload === 'object' && !Array.isArray(data.payload)
        ? { ...data.payload }
        : omitType(data);
    if (!body.source) body.source = source;
    return body;
}

function omitType(data) {
    const out = { ...data };
    delete out.type;
    delete out.channel;
    delete out.payload;
    return out;
}
