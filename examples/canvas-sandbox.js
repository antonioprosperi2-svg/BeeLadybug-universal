/**
 * Canvas sandbox — Core + CanvasAdapter over a tiny host game.
 * The game never talks to the overlay. It only updates entities and calls pump().
 */
import { BeeLadybugCore, CanvasAdapter } from '../src/index.js';

const canvas = document.getElementById('appCanvas');
const ctx = canvas.getContext('2d');

const player = { name: 'player', x: 400, y: 210, width: 40, height: 40, primary: true };
const wall = { name: 'wall', x: 430, y: 190, width: 90, height: 90 };
const patrol = { name: 'patrol', x: 220, y: 60, width: 36, height: 36, vx: 1.6 };
const entities = [player, wall, patrol];

const bee = new BeeLadybugCore();
window.bee = bee;

const adapter = new CanvasAdapter(bee, { canvas, entities });
adapter.attach();
window.adapter = adapter;

bee.registerAssistant({
    name: 'mock',
    complete({ snapshot }) {
        return Promise.resolve(`Mock: fps last=${snapshot.history?.last ?? 'n/a'}`);
    }
});
bee.registerAssistant({
    name: 'echo',
    complete({ question }) {
        return Promise.resolve(`Echo: ${question}`);
    }
});

const pointer = { x: player.x, y: player.y, over: false };
canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    pointer.x = (event.clientX - rect.left) * sx;
    pointer.y = (event.clientY - rect.top) * sy;
    pointer.over = true;
});
canvas.addEventListener('mouseleave', () => {
    pointer.over = false;
});

let last = performance.now();
function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(now - last, 100);
    last = now;

    if (!adapter.frozen) {
        const step = dt * adapter.timeScale;
        if (pointer.over) {
            player.x += ((pointer.x - player.width / 2) - player.x) * Math.min(1, step / 40);
            player.y += ((pointer.y - player.height / 2) - player.y) * Math.min(1, step / 40);
        }
        patrol.x += patrol.vx * (step / 16.67);
        if (patrol.x < 40 || patrol.x > canvas.width - patrol.width - 40) patrol.vx *= -1;
        clamp(player, canvas);
        clamp(patrol, canvas);
    }

    ctx.fillStyle = '#1e1e24';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#3498db';
    ctx.fillRect(player.x, player.y, player.width, player.height);
    ctx.fillStyle = '#9b59b6';
    ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
    ctx.fillStyle = '#e67e22';
    ctx.fillRect(patrol.x, patrol.y, patrol.width, patrol.height);

    adapter.pump();
}

function clamp(entity, host) {
    entity.x = Math.max(0, Math.min(host.width - entity.width, entity.x));
    entity.y = Math.max(0, Math.min(host.height - entity.height, entity.y));
}

requestAnimationFrame(loop);
