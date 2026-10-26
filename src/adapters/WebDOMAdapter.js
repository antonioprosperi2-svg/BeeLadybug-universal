/**
 * WebDOMAdapter — HTML / layout translator.
 *
 * Reads box models, the node under the pointer, and mutation noise,
 * then pushes packets into the core. Highlights are drawn on a stacked
 * overlay canvas so the page stays untouched.
 * `snapshot()` hands the report the box model, problem nodes, and
 * the latest mutation counts.
 *
 * The core must never import this file.
 *
 * @example
 * const adapter = new WebDOMAdapter(core, { root: document.body, watch: ['.card'] });
 * adapter.attach();
 */

import { isReportNoise } from '../core/ReportExporter.js';

const MAX_PROBLEM_ROWS = 40;

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
        this.#reporting = true;
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
        this.#seenAdded = 0;
        this.#seenRemoved = 0;
        this.#seenAttr = 0;
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
    #reporting;
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
    #seenAdded;
    #seenRemoved;
    #seenAttr;
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

        this.#reporting = true;
        this.core?.registerAdapter('dom', {
            label: 'DOM',
            enabled: true,
            enable: () => this.#enable(),
            disable: () => this.#disable(),
            snapshot: () => this.snapshot()
        });

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
        this.core?.unregisterAdapter('dom');
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

    /**
     * Box model of the hover and watched nodes, layout problems under root,
     * and the latest mutation counts. Returns null when detached.
     * Hidden boxes, the WordPress admin bar, and BeeLadybug chrome are skipped.
     * The core stores this function and does not read the rows.
     * @returns {{ name: string, items: Array<{ severity: string, selector: string, rule: string, value: string, source: string }> } | null}
     */
    snapshot() {
        if (!this.#attached) return null;
        const items = [];
        const seen = new Set();
        const targets = [];
        if (this.hover) targets.push(this.hover);
        const watched = this.#watchedNodes();
        for (let i = 0; i < watched.length; i++) targets.push(watched[i]);
        for (let i = 0; i < targets.length; i++) {
            const node = targets[i];
            if (!node || seen.has(node) || !reportable(node)) continue;
            seen.add(node);
            items.push(boxItem(node, this.source));
        }
        const problems = problemItems(this.root, this.source);
        for (let i = 0; i < problems.length; i++) items.push(problems[i]);
        items.push(mutationItem(this.#mutationCounts(), this.root, this.source));
        return { name: 'dom', items };
    }

    pump() {
        if (!this.#attached || !this.core) return this;
        if (!this.#reporting) return this;

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
            if (!domNoiseQuiet(cssHuntEnabled(this.core), this.frozen, this.timeScale)) {
                this.core.sendData('log', {
                    source: this.source,
                    message: `hover ${key}  ${Math.round(model.border.w)}×${Math.round(model.border.h)}  ${model.display}`
                });
            }
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
        if (added || removed || attr) {
            this.#seenAdded = added;
            this.#seenRemoved = removed;
            this.#seenAttr = attr;
        }
        this.#mutAdded = 0;
        this.#mutRemoved = 0;
        this.#mutAttr = 0;
        if (!added && !removed && !attr) return;
        const quiet = domNoiseQuiet(cssHuntEnabled(this.core), this.frozen, this.timeScale);
        const parts = [];
        if (added) parts.push(`+${added}`);
        if (removed) parts.push(`-${removed}`);
        if (attr && !quiet) parts.push(`attr ${attr}`);
        if (parts.length) {
            this.core?.sendData('warn', {
                source: this.source,
                message: `mutate ${parts.join(' ')}`
            });
        }
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
        const hidden = !this.#reporting || (this.core && this.core.visible === false);
        canvas.style.display = hidden ? 'none' : 'block';
    }

    #enable() {
        this.#reporting = true;
        this.#syncOverlay();
    }

    #disable() {
        this.#reporting = false;
        this.#syncOverlay();
    }

    #mutationCounts() {
        const pending = this.#mutAdded + this.#mutRemoved + this.#mutAttr;
        if (pending) {
            return { added: this.#mutAdded, removed: this.#mutRemoved, attr: this.#mutAttr };
        }
        return { added: this.#seenAdded, removed: this.#seenRemoved, attr: this.#seenAttr };
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

function reportable(node) {
    if (!node || node.nodeType !== 1) return false;
    if (typeof node.getBoundingClientRect !== 'function') return false;
    if (isBeeChrome(node) || isReportNoise(node)) return false;
    return true;
}

function boxItem(node, source) {
    const model = boxModel(node);
    return {
        severity: 'ok',
        selector: cssPath(node),
        rule: 'box',
        value: boxValue(model, styleOf(node)),
        source
    };
}

function boxValue(model, style) {
    const border = model.border;
    const content = model.content;
    return `border ${Math.round(border.w)}x${Math.round(border.h)} margin ${sideText(style, 'margin')} padding ${sideText(style, 'padding')} content ${Math.round(content.w)}x${Math.round(content.h)} ${model.display}`;
}

function sideText(style, kind) {
    const prefix = kind === 'margin' ? 'margin' : 'padding';
    const top = style ? parsePx(style[`${prefix}Top`]) : 0;
    const right = style ? parsePx(style[`${prefix}Right`]) : 0;
    const bottom = style ? parsePx(style[`${prefix}Bottom`]) : 0;
    const left = style ? parsePx(style[`${prefix}Left`]) : 0;
    return `${top},${right},${bottom},${left}`;
}

function problemItems(root, source) {
    const nodes = collectElements(root);
    const items = [];
    const seen = new Set();
    for (let i = 0; i < nodes.length && items.length < MAX_PROBLEM_ROWS; i++) {
        const node = nodes[i];
        if (!node || seen.has(node) || !reportable(node)) continue;
        seen.add(node);
        const style = styleOf(node);
        const margin = sideText(style, 'margin');
        if (hasNegative(margin)) {
            items.push(problemItem(node, 'negative margin', margin, source));
            if (items.length >= MAX_PROBLEM_ROWS) break;
        }
        const clip = clipValue(node);
        if (clip) {
            items.push(problemItem(node, 'clipped', clip, source));
            if (items.length >= MAX_PROBLEM_ROWS) break;
        }
        const model = boxModel(node);
        if (model.border.w > 0 && model.border.h > 0 && (model.content.w === 0 || model.content.h === 0)) {
            items.push(problemItem(
                node,
                'collapsed content',
                `content ${Math.round(model.content.w)}x${Math.round(model.content.h)}`,
                source
            ));
        }
    }
    return items;
}

function problemItem(node, rule, value, source) {
    return {
        severity: 'warn',
        selector: cssPath(node),
        rule,
        value,
        source
    };
}

function hasNegative(sides) {
    return sides.split(',').some((part) => Number(part) < 0);
}

function clipValue(node) {
    const sw = finite(node.scrollWidth);
    const cw = finite(node.clientWidth);
    const sh = finite(node.scrollHeight);
    const ch = finite(node.clientHeight);
    const wide = sw != null && cw != null && sw > cw + 2;
    const tall = sh != null && ch != null && sh > ch + 2;
    if (!wide && !tall) return '';
    return `scroll ${sw ?? 0}x${sh ?? 0} client ${cw ?? 0}x${ch ?? 0}`;
}

function mutationItem(counts, root, source) {
    const total = counts.added + counts.removed + counts.attr;
    return {
        severity: total > 0 ? 'warn' : 'ok',
        selector: root && root.nodeType === 1 ? cssPath(root) : 'root',
        rule: 'mutations',
        value: `+${counts.added} -${counts.removed} attr ${counts.attr}`,
        source
    };
}

function styleOf(node) {
    if (typeof getComputedStyle !== 'function') return null;
    try {
        return getComputedStyle(node);
    } catch {
        return null;
    }
}

function collectElements(root) {
    if (!root) return [];
    const out = [];
    if (root.nodeType === 1) out.push(root);
    let list = null;
    if (typeof root.querySelectorAll === 'function') {
        try {
            list = root.querySelectorAll('*');
        } catch {
            list = null;
        }
    }
    if (list) {
        for (let i = 0; i < list.length; i++) out.push(list[i]);
    }
    return out;
}

function finite(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function countElements(root) {
    if (!root) return 0;
    if (root.nodeType === 1) return 1 + (root.getElementsByTagName?.('*').length ?? 0);
    return root.getElementsByTagName?.('*').length ?? 0;
}

/**
 * While CSS hunt is on, hover and attribute-mutation lines stay quiet
 * unless F3 SLOW is running.
 */
export function domNoiseQuiet(cssEnabled, frozen, timeScale) {
    if (!cssEnabled) return false;
    return Boolean(frozen) || timeScale === 1;
}

function cssHuntEnabled(core) {
    if (!core || typeof core.getAdapters !== 'function') return false;
    const list = core.getAdapters();
    for (let i = 0; i < list.length; i++) {
        if (list[i].name === 'css' && list[i].enabled) return true;
    }
    return false;
}
