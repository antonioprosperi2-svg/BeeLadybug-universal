/**
 * Core sandbox — proves BeeLadybug works with no Canvas adapter.
 * Three fake sources push raw packets through sendData().
 */
import { BeeLadybugCore } from '../src/index.js';

const bee = new BeeLadybugCore();
window.bee = bee;

const sim = {
    running: true,
    scale: 1,
    tick: 0,
    tokens: 0,
    status: 'idle'
};

bee.subscribe((packet) => {
    if (packet.type !== 'sys') return;
    const op = packet.payload.op;
    if (op === 'freeze') sim.running = !packet.payload.frozen;
    if (op === 'timescale') sim.scale = Number(packet.payload.scale) || 1;
});

bee.sendData('state', { key: 'source', value: 'sandbox (no adapter)' });
bee.sendData('state', { key: 'ai.status', value: sim.status });

const pulse = document.getElementById('pulse');
const hostMeta = document.getElementById('host-meta');

const fpsBtn = document.getElementById('inject-fps');
const logBtn = document.getElementById('inject-log');
const errBtn = document.getElementById('inject-error');
const clearBtn = document.getElementById('clear-logs');

fpsBtn?.addEventListener('click', () => {
    const value = 40 + Math.random() * 30;
    bee.sendData('fps', { value, source: 'manual' });
    bee.sendData('log', { source: 'manual', message: `Forced FPS sample ${value.toFixed(1)}` });
});

logBtn?.addEventListener('click', () => {
    bee.sendData('log', { source: 'manual', message: 'Operator ping from the sandbox.' });
});

errBtn?.addEventListener('click', () => {
    bee.sendData('error', {
        source: 'ai',
        message: 'Inference timeout: prompt exceeded 8s budget.'
    });
});

clearBtn?.addEventListener('click', () => {
    bee.sendData('clear', { channel: 'logs' });
    bee.sendData('log', { source: 'core', message: 'Console cleared.' });
});

let pointerX = 0;
let pointerY = 0;
let pointerDirty = false;
window.addEventListener('mousemove', (event) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    pointerDirty = true;
});

let last = performance.now();
function pump(now) {
    requestAnimationFrame(pump);
    const dt = Math.min(now - last, 100);
    last = now;
    if (pointerDirty) {
        pointerDirty = false;
        bee.sendData('coord', { source: 'dom', label: 'pointer', x: pointerX, y: pointerY });
    }
    if (!sim.running) {
        if (pulse) pulse.style.transform = 'scale(1)';
        if (hostMeta) hostMeta.textContent = 'FREEZE';
        return;
    }

    sim.tick += dt * sim.scale;
    const scale = 0.85 + 0.15 * Math.sin(sim.tick / 180);
    if (pulse) pulse.style.transform = `scale(${scale})`;
    if (hostMeta) {
        hostMeta.textContent = sim.scale === 1
            ? `RUN  tick ${Math.floor(sim.tick)}`
            : `SLOW ${sim.scale}x  tick ${Math.floor(sim.tick)}`;
    }
    const wave = 58 + Math.sin(sim.tick / 400) * 6 + (Math.random() - 0.5) * 2;
    bee.sendData('fps', { value: wave, source: 'sim' });

    if (Math.floor(sim.tick / 1600) !== Math.floor((sim.tick - dt * sim.scale) / 1600)) {
        sim.status = sim.status === 'idle' ? 'infer' : 'idle';
        bee.sendData('state', { key: 'ai.status', value: sim.status });
        bee.sendData('log', { source: 'ai', message: `pipeline → ${sim.status}` });
    }

    if (sim.status === 'infer' && Math.random() < 0.02) {
        sim.tokens += 8;
        bee.sendData('metric', { name: 'tokens', value: sim.tokens, unit: 'tok', source: 'ai' });
    }

    if (Math.random() < 0.004) {
        bee.sendData('error', {
            source: 'ai',
            message: `latency spike ${Math.round(180 + Math.random() * 400)}ms`
        });
    }
}

requestAnimationFrame(pump);
