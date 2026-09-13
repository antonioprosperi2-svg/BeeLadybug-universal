/**
 * PythonBridge — future inbound channel for Python / AI processes.
 *
 * Planned transport: WebSocket (or HTTP ingest) that unpacks JSON packets
 * and calls core.sendData(type, payload). The core stays browser-side;
 * Python never talks to the overlay directly.
 *
 * Expected wire shape:
 *   { "type": "log"|"error"|"metric"|"fps"|"state", "payload": { ... } }
 */
export class PythonBridge {
    /**
     * @param {import('../../core/BeeLadybugCore.js').BeeLadybugCore} core
     * @param {{ url?: string }} [options]
     */
    constructor(core, options = {}) {
        this.core = core;
        this.url = options.url ?? 'ws://127.0.0.1:8765';
        this.#socket = null;
    }

    #socket;

    connect() {
        this.core?.sendData('log', {
            source: 'python',
            level: 'warn',
            message: `PythonBridge reserved (${this.url}). WebSocket ingest comes after adapters.`
        });
        return this;
    }

    disconnect() {
        if (this.#socket) {
            this.#socket.close();
            this.#socket = null;
        }
        return this;
    }
}
