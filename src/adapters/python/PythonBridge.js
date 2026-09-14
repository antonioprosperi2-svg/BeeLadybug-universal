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
        this.#timer = 0;
        this.#packets = 0;
        this.#retries = 0;
    }

    #socket;
    #wanted;
    #timer;
    #packets;
    #retries;

    get connected() {
        return this.status === 'open';
    }

    connect(url) {
        if (url) this.url = url;
        this.#wanted = true;
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
        if (!this.#wanted) return;
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
        if (!this.#wanted || !this.autoReconnect) return;
        this.#clearTimer();
        this.#timer = setTimeout(() => this.#open(), this.reconnectMs);
    }

    #clearTimer() {
        if (this.#timer && typeof clearTimeout === 'function') clearTimeout(this.#timer);
        this.#timer = 0;
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
