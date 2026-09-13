/**
 * CanvasAdapter — Canvas 2D / game translator.
 *
 * Reads generic AABB entities, measures host FPS, computes collisions,
 * and pushes packets into the core. Hitboxes are drawn on a stacked
 * overlay canvas so the game pixels stay untouched.
 *
 * The core must never import this file.
 *
 * Entity contract (any extra fields are ignored):
 *   { name?, id?, x|worldX, y|worldY, width|w, height|h, active?, colliding? }
 *
 * @example
 * const adapter = new CanvasAdapter(core, { canvas, entities });
 * adapter.attach();
 * // after updating entity positions each host frame:
 * adapter.pump();
 */

export const CANVAS_ADAPTER_DEFAULTS = Object.freeze({
    overlay: true,
    computeCollisions: true,
    colorActive: '#3dff6a',
    colorColliding: '#ff3b3b',
    colorInactive: '#8a8a8a',
    source: 'canvas'
});

export class CanvasAdapter {
    /**
     * @param {import('../core/BeeLadybugCore.js').BeeLadybugCore} core
     * @param {Partial<typeof CANVAS_ADAPTER_DEFAULTS> & {
     *   canvas?: HTMLCanvasElement,
     *   entities?: object[]
     * }} [options]
     */
    constructor(core, options = {}) {
        const cfg = { ...CANVAS_ADAPTER_DEFAULTS, ...options };
        this.core = core;
        this.canvas = options.canvas ?? null;
        this.entities = options.entities ?? [];
        this.overlayEnabled = cfg.overlay;
        this.computeCollisions = cfg.computeCollisions;
        this.colorActive = cfg.colorActive;
        this.colorColliding = cfg.colorColliding;
        this.colorInactive = cfg.colorInactive;
        this.source = cfg.source;

        /** Host should pause simulation when the core freezes. */
        this.frozen = false;
        /** Host should scale its dt by this factor (F3). */
        this.timeScale = 1;

        this.#attached = false;
        this.#overlay = null;
        this.#unsubscribe = null;
        this.#lastPump = 0;
        this.#fps = 0;
        this.#wasColliding = new Set();
        this.#onResize = () => this.#syncOverlay();
    }

    #attached;
    #overlay;
    #unsubscribe;
    #lastPump;
    #fps;
    #wasColliding;
    #onResize;

    attach() {
        if (this.#attached) return this;
        this.#attached = true;
        this.frozen = Boolean(this.core?.frozen);
        this.timeScale = this.core?.timeScale ?? 1;

        if (this.core && typeof this.core.subscribe === 'function') {
            this.#unsubscribe = this.core.subscribe((packet) => this.#onCore(packet));
        }

        if (this.overlayEnabled) this.#mountOverlay();
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', this.#onResize);
            window.addEventListener('scroll', this.#onResize, true);
        }

        this.core?.sendData('log', {
            source: this.source,
            message: `CanvasAdapter attached (${this.entities.length} entities).`
        });
        this.core?.sendData('state', {
            source: this.source,
            key: 'adapter',
            value: 'canvas'
        });
        return this;
    }

    detach() {
        if (!this.#attached) return this;
        this.#attached = false;
        if (this.#unsubscribe) this.#unsubscribe();
        this.#unsubscribe = null;
        this.#unmountOverlay();
        if (typeof window !== 'undefined') {
            window.removeEventListener('resize', this.#onResize);
            window.removeEventListener('scroll', this.#onResize, true);
        }
        return this;
    }

    /** @param {HTMLCanvasElement | null} canvas */
    setCanvas(canvas) {
        this.canvas = canvas;
        this.#syncOverlay();
        return this;
    }

    /** @param {object[]} entities */
    setEntities(entities) {
        this.entities = entities ?? [];
        return this;
    }

    /**
     * Call once per host frame, after entity positions are updated.
     * Pass a 2D context only if overlay is disabled and you want hitboxes
     * drawn onto the game canvas itself.
     * @param {CanvasRenderingContext2D} [ctx]
     */
    pump(ctx) {
        if (!this.#attached || !this.core) return this;

        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (this.#lastPump) {
            const dt = Math.min(Math.max(now - this.#lastPump, 0), 100);
            const instant = dt > 0 ? 1000 / dt : 0;
            this.#fps = this.#fps ? this.#fps * 0.85 + instant * 0.15 : instant;
        }
        this.#lastPump = now;

        const boxes = this.#collectBoxes();
        this.#markCollisions(boxes);
        this.#emitTelemetry(boxes);
        this.#emitCollisionEdges(boxes);
        this.#drawHitboxes(boxes, ctx);
        return this;
    }

    #onCore(packet) {
        if (packet.type !== 'sys') return;
        const op = packet.payload.op;
        if (op === 'freeze') this.frozen = Boolean(packet.payload.frozen);
        if (op === 'timescale') {
            const scale = Number(packet.payload.scale);
            if (Number.isFinite(scale)) this.timeScale = scale;
        }
        if (op === 'visibility') this.#syncOverlay();
    }

    #collectBoxes() {
        const list = this.entities;
        const boxes = [];
        for (let i = 0; i < list.length; i++) {
            const box = aabbOf(list[i], i);
            if (box) boxes.push(box);
        }
        return boxes;
    }

    #markCollisions(boxes) {
        for (let i = 0; i < boxes.length; i++) boxes[i].hit = Boolean(boxes[i].entity.colliding);

        if (!this.computeCollisions) return;

        for (let i = 0; i < boxes.length; i++) {
            const a = boxes[i];
            for (let j = i + 1; j < boxes.length; j++) {
                const b = boxes[j];
                if (!overlaps(a, b)) continue;
                a.hit = true;
                b.hit = true;
            }
        }
    }

    #emitTelemetry(boxes) {
        let hits = 0;
        let tracked = null;
        for (let i = 0; i < boxes.length; i++) {
            if (boxes[i].hit) hits += 1;
            if (!tracked && isPrimary(boxes[i].entity)) tracked = boxes[i];
        }
        if (!tracked && boxes[0]) tracked = boxes[0];

        if (this.#fps > 0) {
            this.core.sendData('fps', { value: this.#fps, source: this.source });
        }
        this.core.sendData('metric', {
            name: 'entities',
            value: boxes.length,
            source: this.source
        });
        this.core.sendData('metric', {
            name: 'hits',
            value: hits,
            source: this.source
        });
        this.core.sendData('state', {
            source: this.source,
            key: 'hits',
            value: `${hits} / ${boxes.length}`
        });

        if (tracked) {
            this.core.sendData('coord', {
                source: this.source,
                label: tracked.name,
                x: tracked.x,
                y: tracked.y
            });
        }
    }

    #emitCollisionEdges(boxes) {
        const now = new Set();
        for (let i = 0; i < boxes.length; i++) {
            if (!boxes[i].hit) continue;
            now.add(boxes[i].id);
            if (!this.#wasColliding.has(boxes[i].id)) {
                this.core.sendData('warn', {
                    source: this.source,
                    message: `${boxes[i].name} entered collision`
                });
            }
        }
        for (const id of this.#wasColliding) {
            if (now.has(id)) continue;
            const name = idFromKey(id);
            this.core.sendData('log', {
                source: this.source,
                message: `${name} left collision`
            });
        }
        this.#wasColliding = now;
    }

    #drawHitboxes(boxes, hostCtx) {
        const overlayCtx = this.#overlay ? this.#overlay.getContext('2d') : null;
        if (overlayCtx) this.#syncOverlay();

        const ctx = overlayCtx || hostCtx;
        if (!ctx) return;

        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        if (overlayCtx) ctx.clearRect(0, 0, w, h);

        if (this.core && this.core.visible === false) return;

        ctx.save();
        ctx.lineWidth = 1.5;
        ctx.font = '11px ui-monospace, Consolas, monospace';
        ctx.textBaseline = 'bottom';

        for (let i = 0; i < boxes.length; i++) {
            const box = boxes[i];
            const active = box.entity.active !== false;
            const color = box.hit
                ? this.colorColliding
                : (active ? this.colorActive : this.colorInactive);

            ctx.strokeStyle = color;
            ctx.fillStyle = box.hit ? 'rgba(255, 59, 59, 0.16)' : 'rgba(61, 255, 106, 0.08)';
            ctx.fillRect(box.x, box.y, box.w, box.h);
            ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h);

            ctx.fillStyle = color;
            ctx.fillText(box.name, box.x + 3, box.y - 3);
        }

        ctx.restore();
    }

    #mountOverlay() {
        if (typeof document === 'undefined' || this.#overlay) return;
        const canvas = document.createElement('canvas');
        canvas.setAttribute('data-bee-ladybug-canvas', '');
        canvas.style.pointerEvents = 'none';
        canvas.style.position = 'fixed';
        canvas.style.zIndex = '2147483645';
        canvas.style.margin = '0';
        document.body.appendChild(canvas);
        this.#overlay = canvas;
        this.#syncOverlay();
    }

    #unmountOverlay() {
        if (this.#overlay?.parentNode) this.#overlay.parentNode.removeChild(this.#overlay);
        this.#overlay = null;
    }

    #syncOverlay() {
        const host = this.canvas;
        const overlay = this.#overlay;
        if (!host || !overlay) return;
        const rect = host.getBoundingClientRect();
        overlay.width = host.width;
        overlay.height = host.height;
        overlay.style.left = `${rect.left}px`;
        overlay.style.top = `${rect.top}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
        overlay.style.display = this.core && this.core.visible === false ? 'none' : 'block';
    }
}

function aabbOf(entity, index) {
    if (!entity) return null;
    const x = numberOr(entity.worldX, entity.x);
    const y = numberOr(entity.worldY, entity.y);
    const w = numberOr(entity.width, entity.w);
    const h = numberOr(entity.height, entity.h);
    if (x == null || y == null || !w || !h || w <= 0 || h <= 0) return null;
    const name = String(entity.name ?? entity.label ?? entity.id ?? `#${index}`);
    const id = entity.id != null ? `id:${entity.id}` : `idx:${index}:${name}`;
    return { entity, x, y, w, h, name, id, hit: false };
}

function numberOr(a, b) {
    if (typeof a === 'number' && Number.isFinite(a)) return a;
    if (typeof b === 'number' && Number.isFinite(b)) return b;
    return null;
}

function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function isPrimary(entity) {
    const key = String(entity.name ?? entity.label ?? entity.role ?? '').toLowerCase();
    return key === 'player' || key === 'hero' || entity.primary === true;
}

function idFromKey(id) {
    const parts = String(id).split(':');
    return parts[parts.length - 1] || id;
}
