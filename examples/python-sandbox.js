/**
 * Python sandbox — Core + PythonBridge.
 * Mock buttons use ingest() (same parser as the socket).
 * Connect talks to examples/python/sender.py
 */
import { BeeLadybugCore, PythonBridge } from '../src/index.js';

const bee = new BeeLadybugCore();
const bridge = new PythonBridge(bee, { url: 'ws://127.0.0.1:8765' });
window.bee = bee;
window.bridge = bridge;

bee.sendData('state', { key: 'adapter', value: 'python' });

bee.registerAssistant({
    name: 'mock',
    complete({ snapshot }) {
        const errors = snapshot.logs.filter((line) => line.level === 'error').length;
        const last = snapshot.history?.last;
        return Promise.resolve(
            `Mock AI: ${errors} error(i), metric ${snapshot.history?.name ?? 'n/a'} last=${last ?? 'n/a'}. Sostituisci complete() con il tuo modello.`
        );
    }
});
bee.registerAssistant({
    name: 'echo',
    complete({ question, snapshot }) {
        return Promise.resolve(
            `Echo: q="${question}" logs=${snapshot.logs.length} hud=${Object.keys(snapshot.hud).length}`
        );
    }
});

const statusEl = document.getElementById('py-status');
function paintStatus() {
    if (statusEl) statusEl.textContent = bridge.status.toUpperCase();
}
paintStatus();
setInterval(paintStatus, 200);

document.getElementById('py-connect')?.addEventListener('click', () => {
    bridge.connect();
});
document.getElementById('py-disconnect')?.addEventListener('click', () => {
    bridge.disconnect();
});
document.getElementById('py-log')?.addEventListener('click', () => {
    bridge.ingest({ type: 'log', message: 'mock python log from the sandbox.' });
});
document.getElementById('py-metric')?.addEventListener('click', () => {
    const loss = 0.2 + Math.random() * 0.3;
    bridge.ingest({ type: 'metric', payload: { name: 'loss', value: Number(loss.toFixed(3)) } });
    bridge.ingest({ type: 'state', payload: { key: 'ai.status', value: 'mock-train' } });
});
document.getElementById('py-error')?.addEventListener('click', () => {
    bridge.ingest({
        type: 'error',
        payload: { message: 'CUDA OOM on batch 12 (mock).' }
    });
});
