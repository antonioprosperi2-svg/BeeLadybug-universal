/**
 * WebDOMAdapter — HTML / layout translator.
 *
 * Reads box models, the node under the pointer, and mutation noise,
 * then pushes packets into the core. Highlights are drawn on a stacked
 * overlay canvas so the page stays untouched.
 *
 * The core must never import this file.
 *
 * @example
 * const adapter = new WebDOMAdapter(core, { root: document.body, watch: ['.card'] });
 * adapter.attach();
 */

export const WEB_DOM_ADAPTER_DEFAULTS = Object.freeze({
    overlay: true,
    autoTick: true,
    watch: [],
    source: 'dom',
    colorHover: '#6ee7ff',
    colorWatch: '#3dff6a',
    colorMargin: 'rgba(255, 211, 106, 0.18)',
    colorPadding: 'rgba(61, 255, 106, 0.16)',
    colorContent: 'rgba(110, 231, 255, 0.20)'
});

export class WebDOMAdapter {
    /**
     * @param {import('../core/BeeLadybugCore.js').BeeLadybugCore} core
     * @param {Partial<typeof WEB_DOM_ADAPTER_DEFAULTS> & {
     *   root?: ParentNode | null
     * }} [options]
     */
    constructor(core, options = {}) {
        const cfg = { ...WEB_DOM_ADAPTER_DEFAULTS, ...options };
        this.core = core;
        this.root = options.root !== undefined
            ? options.root
            : (typeof document !== 'undefined' ? document.body : null);
        this.overlayEnabled = cfg.overlay;
        this.autoTick = cfg.autoTick;
        this.watch = Array.isArray(cfg.watch) ? cfg.watch.slice() : [];
        this.source = cfg.source;
        this.colorHover = cfg.colorHover;
        this.colorWatch = cfg.colorWatch;
        this.colorMargin = cfg.colorMargin;
        this.colorPadding = cfg.colorPadding;
        this.colorContent = cfg.colorContent;

        this.frozen = false;
        this.timeScale = 1;
        this.hover = null;

        this.#attached = false;
        this.#overlay = null;
        this.#unsubscribe = null;
        this.#observer = null;
        this.#rafId = 0;
        this.#pointer = { x: 0, y: 0, dirty: false };
        this.#lastPump = 0;
        this.#fps = 0;
        this.#mutAdded = 0;
        this.#mutRemoved = 0;
        this.#mutAttr = 0;
        this.#mutTimer = 0;
        this.#lastHoverKey = '';
        this.#onMove = (event) => {
            this.#pointer.x = event.clientX;
            this.#pointer.y = event.clientY;
            this.#pointer.dirty = true;
        };
        this.#onResize = () => this.#syncOverlay();
        this.#onTick = () => {
            this.#rafId = requestAnimationFrame(this.#onTick);
            this.pump();
        };
        this.#onMutate = (records) => this.#queueMutations(records);
    }

    #attached;
    #overlay;
    #unsubscribe;
    #observer;
    #rafId;
    #pointer;
    #lastPump;
    #fps;
    #mutAdded;
    #mutRemoved;
    #mutAttr;
    #mutTimer;
    #lastHoverKey;
    #onMove;
    #onResize;
    #onTick;
    #onMutate;

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
            window.addEventListener('mousemove', this.#onMove, true);
            window.addEventListener('resize', this.#onResize);
            window.addEventListener('scroll', this.#onResize, true);
        }
        if (this.root && typeof MutationObserver !== 'undefined') {
            this.#observer = new MutationObserver(this.#onMutate);
            this.#observer.observe(this.root, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style', 'hidden', 'disabled', 'open']
            });
        }
        if (this.autoTick && typeof requestAnimationFrame === 'function') {
            this.#rafId = requestAnimationFrame(this.#onTick);
        }

        this.core?.sendData('log', {
            source: this.source,
            message: 'WebDOMAdapter attached. Hover a node to inspect the box model.'
        });
        this.core?.sendData('state', {
            source: this.source,
            key: 'adapter',
            value: 'dom'
        });
        return this;
    }

    detach() {
        if (!this.#attached) return this;
        this.#attached = false;
        if (this.#unsubscribe) this.#unsubscribe();
        this.#unsubscribe = null;
        if (this.#observer) this.#observer.disconnect();
        this.#observer = null;
        if (this.#rafId && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.#rafId);
        }
        this.#rafId = 0;
        if (this.#mutTimer && typeof clearTimeout === 'function') clearTimeout(this.#mutTimer);
        this.#mutTimer = 0;
        if (typeof window !== 'undefined') {
            window.removeEventListener('mousemove', this.#onMove, true);
            window.removeEventListener('resize', this.#onResize);
            window.removeEventListener('scroll', this.#onResize, true);
        }
        this.#unmountOverlay();
        return this;
    }

    /** @param {ParentNode | null} root */
    setRoot(root) {
        this.root = root;
        if (this.#attached && this.#observer && root) {
            this.#observer.disconnect();
            this.#observer.observe(root, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style', 'hidden', 'disabled', 'open']
            });
        }
        return this;
    }

    pump() {
        if (!this.#attached || !this.core) return this;

        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (this.#lastPump) {
            const dt = Math.min(Math.max(now - this.#lastPump, 0), 100);
            const instant = dt > 0 ? 1000 / dt : 0;
            this.#fps = this.#fps ? this.#fps * 0.85 + instant * 0.15 : instant;
        }
        this.#lastPump = now;

        if (!this.frozen && this.#pointer.dirty) {
            this.#pointer.dirty = false;
            this.hover = this.#pick(this.#pointer.x, this.#pointer.y);
        }

        this.#emitTelemetry();
        this.#draw();
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

    #pick(x, y) {
        if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') {
            return null;
        }
        const stack = document.elementsFromPoint(x, y);
        for (let i = 0; i < stack.length; i++) {
            const el = stack[i];
            if (!el || el.nodeType !== 1) continue;
            if (isBeeChrome(el)) continue;
            if (this.root && this.root !== document && !this.root.contains(el) && el !== this.root) continue;
            return el;
        }
        return null;
    }

    #watchedNodes() {
        if (!this.root || !this.watch.length || typeof this.root.querySelectorAll !== 'function') return [];
        const out = [];
        const seen = new Set();
        for (let i = 0; i < this.watch.length; i++) {
            const sel = this.watch[i];
            let list;
            try {
                list = this.root.querySelectorAll(sel);
            } catch {
                continue;
            }
            for (let j = 0; j < list.length; j++) {
                if (seen.has(list[j])) continue;
                seen.add(list[j]);
                out.push(list[j]);
            }
        }
        return out;
    }

    #emitTelemetry() {
        const hover = this.hover;
        const nodes = countElements(this.root);
        if (this.#fps > 0) {
            this.core.sendData('fps', { value: this.#fps, source: this.source });
        }
        this.core.sendData('metric', { name: 'nodes', value: nodes, source: this.source });
        this.core.sendData('coord', {
            source: this.source,
            label: 'pointer',
            x: this.#pointer.x,
            y: this.#pointer.y
        });

        if (!hover) {
            if (this.#lastHoverKey) {
                this.#lastHoverKey = '';
                this.core.sendData('state', { source: this.source, key: 'hover', value: '—' });
                this.core.sendData('state', { source: this.source, key: 'box', value: '—' });
            }
            return;
        }

        const model = boxModel(hover);
        const key = cssPath(hover);
        this.core.sendData('state', { source: this.source, key: 'hover', value: key });
        this.core.sendData('state', {
            source: this.source,
            key: 'box',
            value: `${Math.round(model.border.w)}×${Math.round(model.border.h)}`
        });
        this.core.sendData('state', {
            source: this.source,
            key: 'display',
            value: model.display
        });

        if (key !== this.#lastHoverKey) {
            this.#lastHoverKey = key;
            this.core.sendData('log', {
                source: this.source,
                message: `hover ${key}  ${Math.round(model.border.w)}×${Math.round(model.border.h)}  ${model.display}`
            });
        }
    }

    #queueMutations(records) {
        if (this.frozen) return;
        for (let i = 0; i < records.length; i++) {
            const rec = records[i];
            if (isBeeChrome(rec.target)) continue;
            if (rec.type === 'childList') {
                this.#mutAdded += rec.addedNodes.length;
                this.#mutRemoved += rec.removedNodes.length;
            } else if (rec.type === 'attributes') {
                this.#mutAttr += 1;
            }
        }
        if (this.#mutTimer || typeof setTimeout !== 'function') return;
        this.#mutTimer = setTimeout(() => {
            this.#mutTimer = 0;
            this.#flushMutations();
        }, 180);
    }

    #flushMutations() {
        const added = this.#mutAdded;
        const removed = this.#mutRemoved;
        const attr = this.#mutAttr;
        this.#mutAdded = 0;
        this.#mutRemoved = 0;
        this.#mutAttr = 0;
        if (!added && !removed && !attr) return;
        const parts = [];
        if (added) parts.push(`+${added}`);
        if (removed) parts.push(`-${removed}`);
        if (attr) parts.push(`attr ${attr}`);
        this.core?.sendData('warn', {
            source: this.source,
            message: `mutate ${parts.join(' ')}`
        });
        this.core?.sendData('metric', {
            name: 'mutations',
            value: added + removed + attr,
            source: this.source
        });
    }

    #draw() {
        const canvas = this.#overlay;
        if (!canvas) return;
        this.#syncOverlay();
        const ctx = canvas.getContext('2d');
        const w = window.innerWidth;
        const h = window.innerHeight;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (this.core && this.core.visible === false) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const watched = this.#watchedNodes();
        for (let i = 0; i < watched.length; i++) {
            if (watched[i] === this.hover) continue;
            strokeBox(ctx, boxModel(watched[i]).border, this.colorWatch);
        }

        if (this.hover) {
            drawBoxModel(ctx, boxModel(this.hover), {
                margin: this.colorMargin,
                padding: this.colorPadding,
                content: this.colorContent,
                line: this.colorHover
            });
            drawLabel(ctx, this.hover, w, h, this.colorHover);
        }
    }

    #mountOverlay() {
        if (typeof document === 'undefined' || this.#overlay) return;
        const canvas = document.createElement('canvas');
        canvas.setAttribute('data-bee-ladybug-dom', '');
        canvas.style.pointerEvents = 'none';
        canvas.style.position = 'fixed';
        canvas.style.left = '0';
        canvas.style.top = '0';
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
        const canvas = this.#overlay;
        if (!canvas || typeof window === 'undefined') return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = window.innerWidth;
        const h = window.innerHeight;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.display = this.core && this.core.visible === false ? 'none' : 'block';
    }
}

function isBeeChrome(node) {
    let el = node && node.nodeType === 1 ? node : node?.parentElement;
    while (el) {
        const tag = el.tagName;
        if (tag === 'BEE-LADYBUG-OVERLAY') return true;
        if (el.hasAttribute?.('data-bee-ladybug-dom')) return true;
        if (el.hasAttribute?.('data-bee-ladybug-canvas')) return true;
        el = el.parentElement;
    }
    return false;
}

function cssPath(el) {
    if (!el || !el.tagName) return 'node';
    const tag = el.tagName.toLowerCase();
    if (el.id) return `${tag}#${cssEscape(el.id)}`;
    const classes = el.classList ? [...el.classList].slice(0, 2) : [];
    if (classes.length) return `${tag}.${classes.map(cssEscape).join('.')}`;
    return tag;
}

function cssEscape(value) {
    return String(value).replace(/[^\w-]/g, '\\$&');
}

function parsePx(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
}

function boxModel(el) {
    const r = el.getBoundingClientRect();
    const s = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    const mt = s ? parsePx(s.marginTop) : 0;
    const mr = s ? parsePx(s.marginRight) : 0;
    const mb = s ? parsePx(s.marginBottom) : 0;
    const ml = s ? parsePx(s.marginLeft) : 0;
    const bt = s ? parsePx(s.borderTopWidth) : 0;
    const br = s ? parsePx(s.borderRightWidth) : 0;
    const bb = s ? parsePx(s.borderBottomWidth) : 0;
    const bl = s ? parsePx(s.borderLeftWidth) : 0;
    const pt = s ? parsePx(s.paddingTop) : 0;
    const pr = s ? parsePx(s.paddingRight) : 0;
    const pb = s ? parsePx(s.paddingBottom) : 0;
    const pl = s ? parsePx(s.paddingLeft) : 0;
    return {
        display: s ? s.display : 'block',
        margin: { x: r.left - ml, y: r.top - mt, w: r.width + ml + mr, h: r.height + mt + mb },
        border: { x: r.left, y: r.top, w: r.width, h: r.height },
        padding: {
            x: r.left + bl,
            y: r.top + bt,
            w: Math.max(0, r.width - bl - br),
            h: Math.max(0, r.height - bt - bb)
        },
        content: {
            x: r.left + bl + pl,
            y: r.top + bt + pt,
            w: Math.max(0, r.width - bl - br - pl - pr),
            h: Math.max(0, r.height - bt - bb - pt - pb)
        }
    };
}

function fillBox(ctx, box, color) {
    if (!box.w || !box.h) return;
    ctx.fillStyle = color;
    ctx.fillRect(box.x, box.y, box.w, box.h);
}

function strokeBox(ctx, box, color) {
    if (!box.w || !box.h) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h);
}

function drawBoxModel(ctx, model, colors) {
    fillBox(ctx, model.margin, colors.margin);
    fillBox(ctx, model.border, 'rgba(7, 8, 12, 0.04)');
    fillBox(ctx, model.padding, colors.padding);
    fillBox(ctx, model.content, colors.content);
    strokeBox(ctx, model.border, colors.line);
}

function drawLabel(ctx, el, viewW, viewH, color) {
    const model = boxModel(el);
    const text = `${cssPath(el)}  ${Math.round(model.border.w)}×${Math.round(model.border.h)}`;
    ctx.font = '11px ui-monospace, Consolas, monospace';
    const width = Math.ceil(ctx.measureText(text).width) + 12;
    const height = 18;
    let x = model.border.x;
    let y = model.border.y - height - 4;
    if (y < 8) y = model.border.y + model.border.h + 4;
    if (x + width > viewW - 8) x = Math.max(8, viewW - width - 8);
    if (x < 8) x = 8;
    if (y + height > viewH - 8) y = Math.max(8, viewH - height - 8);
    ctx.fillStyle = 'rgba(7, 8, 12, 0.92)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = color;
    ctx.strokeRect(x + 0.5, y + 0.5, width, height);
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 6, y + height / 2);
}

function countElements(root) {
    if (!root) return 0;
    if (root.nodeType === 1) return 1 + (root.getElementsByTagName?.('*').length ?? 0);
    return root.getElementsByTagName?.('*').length ?? 0;
}
