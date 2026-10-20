/**
 * CSSAdapter — CSS hunt.
 *
 * Hover an element to list !important hits, viewport overflow, negative
 * margins, invisible text, click blockers and stretched images. The core
 * only receives packets and detail rows; it does not parse CSS.
 *
 * @example
 * const css = new CSSAdapter(core);
 * css.attach();
 * // F6 toggles hunt. S scans the page while hunt is on.
 */

export const CSS_ADAPTER_DEFAULTS = Object.freeze({
    source: 'css',
    hotkey: 'F6',
    scanKey: 'KeyS',
    label: 'F6 CSS',
    maxScan: 8
});

export class CSSAdapter {
    /**
     * @param {import('../core/BeeLadybugCore.js').BeeLadybugCore} core
     * @param {Partial<typeof CSS_ADAPTER_DEFAULTS>} [options]
     */
    constructor(core, options = {}) {
        const cfg = { ...CSS_ADAPTER_DEFAULTS, ...options };
        this.core = core;
        this.source = cfg.source;
        this.hotkey = cfg.hotkey;
        this.scanKey = cfg.scanKey;
        this.label = cfg.label;
        this.maxScan = cfg.maxScan;

        this.#attached = false;
        this.#active = false;
        this.#rules = [];
        this.#unreadable = [];
        this.#sheetsDirty = true;
        this.#x = 0;
        this.#y = 0;
        this.#rafId = 0;
        this.#lastEl = null;
        this.#pinned = null;
        this.#hoverBox = null;
        this.#pinBox = null;
        this.#observer = null;
        this.#onMove = (event) => {
            this.#x = event.clientX;
            this.#y = event.clientY;
            this.#schedule();
        };
        this.#onKey = (event) => this.#handleKey(event);
        this.#onScroll = () => this.#placeBoxes();
        this.#onMutate = (records) => {
            if (!records.some(touchesSheet)) return;
            this.#sheetsDirty = true;
            this.#schedule();
        };
    }

    #attached;
    #active;
    #rules;
    #unreadable;
    #sheetsDirty;
    #x;
    #y;
    #rafId;
    #lastEl;
    #pinned;
    #hoverBox;
    #pinBox;
    #observer;
    #onMove;
    #onKey;
    #onScroll;
    #onMutate;

    get active() {
        return this.#active;
    }

    attach() {
        if (this.#attached) return this;
        this.#attached = true;
        this.core?.registerAdapter('css', {
            label: this.label,
            hotkey: this.hotkey,
            enabled: false,
            enable: () => this.#enable(),
            disable: () => this.#disable()
        });
        this.core?.sendData('log', {
            source: this.source,
            message: 'CSSAdapter attached. F6 CSS hunt. S scans the page while hunt is on.'
        });
        this.core?.sendData('state', {
            source: this.source,
            key: 'css.hunt',
            value: 'off'
        });
        return this;
    }

    detach() {
        if (!this.#attached) return this;
        this.#disable();
        this.#attached = false;
        this.core?.unregisterAdapter('css');
        return this;
    }

    /** Checks 2 and 5 across the document. Click a row to outline it. */
    scan() {
        if (!this.#active || typeof document === 'undefined') return this;
        if (this.#sheetsDirty) this.#rebuildSheets();
        const nodes = document.body ? document.body.querySelectorAll('*') : [];
        const offenders = [];
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            if (!el || isBeeChrome(el) || isSkippedTag(el)) continue;
            const findings = [];
            pushOverflow(el, findings);
            pushImage(el, findings);
            if (!findings.length) continue;
            let score = 0;
            for (let j = 0; j < findings.length; j++) score += findings[j].score;
            offenders.push({ el, findings, score });
        }
        offenders.sort((a, b) => b.score - a.score);
        const top = offenders.slice(0, this.maxScan);
        const items = top.map((entry) => ({
            level: 'error',
            text: `${cssPath(entry.el)} — ${entry.findings.map((hit) => hit.text).join('; ')}`,
            onSelect: () => this.#pin(entry.el)
        }));
        this.#lastEl = null;
        this.core?.publishDetail(items);
        this.core?.sendData('state', {
            source: this.source,
            key: 'css.scan',
            value: String(top.length)
        });
        this.core?.sendData('warn', {
            source: this.source,
            message: top.length
                ? `scan ${top.length} offender(s). Click a row to outline it.`
                : 'scan clean: no overflow or distorted images.'
        });
        return this;
    }

    #enable() {
        if (this.#active || typeof document === 'undefined' || typeof window === 'undefined') return;
        this.#active = true;
        this.#sheetsDirty = true;
        this.#mountBoxes();
        window.addEventListener('mousemove', this.#onMove, true);
        window.addEventListener('keydown', this.#onKey);
        window.addEventListener('scroll', this.#onScroll, true);
        window.addEventListener('resize', this.#onScroll);
        if (typeof MutationObserver !== 'undefined' && document.documentElement) {
            this.#observer = new MutationObserver(this.#onMutate);
            this.#observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['href', 'rel', 'media', 'disabled', 'type'],
                characterData: true
            });
        }
        this.#rebuildSheets();
        this.core?.sendData('state', { source: this.source, key: 'css.hunt', value: 'on' });
        this.core?.sendData('log', {
            source: this.source,
            message: 'CSS hunt on. Hover an element, or press S to scan.'
        });
    }

    #disable() {
        if (!this.#active) return;
        this.#active = false;
        if (typeof window !== 'undefined') {
            window.removeEventListener('mousemove', this.#onMove, true);
            window.removeEventListener('keydown', this.#onKey);
            window.removeEventListener('scroll', this.#onScroll, true);
            window.removeEventListener('resize', this.#onScroll);
        }
        if (this.#rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.#rafId);
        this.#rafId = 0;
        if (this.#observer) this.#observer.disconnect();
        this.#observer = null;
        this.#lastEl = null;
        this.#pinned = null;
        this.#unmountBoxes();
        this.core?.publishDetail([]);
        this.core?.sendData('state', { source: this.source, key: 'css.hunt', value: 'off' });
        this.core?.sendData('log', { source: this.source, message: 'CSS hunt off.' });
    }

    #handleKey(event) {
        if (!this.#active || event.repeat) return;
        if (event.code !== this.scanKey) return;
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        this.scan();
    }

    #schedule() {
        if (!this.#active || this.#rafId || typeof requestAnimationFrame !== 'function') return;
        this.#rafId = requestAnimationFrame(() => {
            this.#rafId = 0;
            if (!this.#active) return;
            if (this.#sheetsDirty) this.#rebuildSheets();
            this.#inspect(this.#x, this.#y);
        });
    }

    #rebuildSheets() {
        this.#sheetsDirty = false;
        const built = collectImportantRules();
        this.#rules = built.rules;
        this.#unreadable = built.unreadable;
        for (let i = 0; i < built.unreadable.length; i++) {
            this.core?.sendData('warn', {
                source: this.source,
                message: `unreadable sheet: ${built.unreadable[i]}`
            });
        }
    }

    #inspect(x, y) {
        const el = pickElement(x, y);
        placeBox(this.#hoverBox, el);
        if (el === this.#lastEl) return;
        this.#lastEl = el;
        if (!el) {
            this.core?.publishDetail([]);
            this.core?.sendData('state', { source: this.source, key: 'css.target', value: '—' });
            return;
        }
        const findings = [];
        pushImportant(el, this.#rules, findings);
        pushOverflow(el, findings);
        pushInvisible(el, findings);
        pushBlockers(el, findings);
        pushImage(el, findings);
        for (let i = 0; i < this.#unreadable.length; i++) {
            findings.push({
                level: 'warn',
                text: `unreadable sheet: ${this.#unreadable[i]}`,
                score: 0
            });
        }
        const path = cssPath(el);
        this.core?.sendData('state', { source: this.source, key: 'css.target', value: path });
        this.core?.sendData('state', {
            source: this.source,
            key: 'css.hits',
            value: String(findings.length)
        });
        this.core?.publishDetail(findings.map((hit) => ({
            level: hit.level,
            text: `${path}  ${hit.text}`,
            onSelect: () => this.#pin(el)
        })));
        if (!findings.length) {
            this.core?.sendData('log', { source: this.source, message: `${path}  clean` });
            return;
        }
        const lead = findings.find((hit) => hit.level === 'error') || findings[0];
        this.core?.sendData(lead.level === 'error' ? 'error' : 'warn', {
            source: this.source,
            message: `${path}  ${lead.text}`
        });
    }

    #pin(el) {
        this.#pinned = el;
        placeBox(this.#pinBox, el);
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
    }

    #placeBoxes() {
        placeBox(this.#hoverBox, this.#lastEl);
        placeBox(this.#pinBox, this.#pinned);
    }

    #mountBoxes() {
        if (typeof document === 'undefined' || this.#hoverBox) return;
        this.#hoverBox = makeBox('hover', '1px solid #ffd36a', 'transparent');
        this.#pinBox = makeBox('pin', '2px solid #ff3b4e', 'rgba(255, 59, 78, 0.12)');
        document.body.appendChild(this.#hoverBox);
        document.body.appendChild(this.#pinBox);
    }

    #unmountBoxes() {
        this.#hoverBox?.remove();
        this.#pinBox?.remove();
        this.#hoverBox = null;
        this.#pinBox = null;
    }
}

function collectImportantRules() {
    const rules = [];
    const unreadable = [];
    if (typeof document === 'undefined') return { rules, unreadable };
    const sheets = document.styleSheets;
    for (let i = 0; i < sheets.length; i++) {
        const sheet = sheets[i];
        let list = null;
        try {
            list = sheet.cssRules;
        } catch {
            unreadable.push(sheet.href || '<style> inline');
            continue;
        }
        walkRules(list, sheetLabel(sheet), rules);
    }
    return { rules, unreadable };
}

function walkRules(list, source, into) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
        const rule = list[i];
        if (!rule) continue;
        if (rule.type === 4 && rule.media) {
            let active = true;
            try {
                active = typeof matchMedia === 'function'
                    ? matchMedia(rule.media.mediaText).matches
                    : true;
            } catch {
                active = true;
            }
            if (active) walkRules(rule.cssRules, source, into);
            continue;
        }
        if (rule.type === 1 && rule.selectorText && rule.style) {
            const props = importantProps(rule.style);
            if (props.length) into.push({ selector: rule.selectorText, source, props });
        } else if (rule.cssRules) {
            walkRules(rule.cssRules, source, into);
        }
    }
}

function importantProps(style) {
    const props = [];
    for (let i = 0; i < style.length; i++) {
        const property = style.item(i);
        if (style.getPropertyPriority(property) !== 'important') continue;
        props.push({ property, value: style.getPropertyValue(property).trim() });
    }
    return props;
}

function sheetLabel(sheet) {
    if (sheet.href) return sheet.href;
    return '<style> inline';
}

function pushImportant(el, rules, findings) {
    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        let matched = false;
        try {
            matched = el.matches(rule.selector);
        } catch {
            continue;
        }
        if (!matched) continue;
        for (let j = 0; j < rule.props.length; j++) {
            const prop = rule.props[j];
            findings.push({
                level: 'warn',
                score: 5,
                text: `!important ${rule.selector} { ${prop.property}: ${prop.value} } @ ${rule.source}`
            });
        }
    }
}

function pushOverflow(el, findings) {
    if (!el.getBoundingClientRect || el === document.documentElement || el === document.body) return;
    const rect = el.getBoundingClientRect();
    const view = document.documentElement.clientWidth;
    if (rect.left < -1 || rect.right > view + 1) {
        const past = rect.left < -1
            ? `left ${Math.round(rect.left)}px`
            : `right +${Math.round(rect.right - view)}px`;
        findings.push({
            level: 'error',
            score: Math.abs(rect.left < -1 ? rect.left : rect.right - view),
            text: `overflows viewport (${past})`
        });
    }
    const style = getComputedStyle(el);
    const sides = ['top', 'right', 'bottom', 'left'];
    for (let i = 0; i < sides.length; i++) {
        const raw = style.getPropertyValue(`margin-${sides[i]}`);
        const value = parseFloat(raw);
        if (!Number.isFinite(value) || value >= 0) continue;
        findings.push({
            level: 'warn',
            score: Math.abs(value),
            text: `negative margin margin-${sides[i]}: ${raw.trim()}`
        });
    }
}

function pushInvisible(el, findings) {
    if (!hasOwnText(el)) return;
    const style = getComputedStyle(el);
    if (opacityZero(el)) {
        findings.push({ level: 'error', score: 30, text: 'invisible text (opacity 0)' });
    }
    const color = parseColor(style.color);
    if (!color || color.a === 0) {
        findings.push({ level: 'error', score: 30, text: 'invisible text (transparent color)' });
        return;
    }
    const behind = paintBehind(el);
    if (behind && nearlySame(color, behind)) {
        findings.push({ level: 'error', score: 30, text: 'invisible text (color matches background)' });
    }
}

function pushBlockers(el, findings) {
    if (!el.getBoundingClientRect || typeof document.elementFromPoint !== 'function') return;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return;
    const pseudo = coveringPseudo(x, y);
    if (pseudo) {
        findings.push({ level: 'error', score: 40, text: `click blocked by ${pseudo}` });
    }
    const hit = document.elementFromPoint(x, y);
    if (!hit || isBeeChrome(hit) || hit === el || el.contains(hit)) return;
    if (pseudo && (hit === document.documentElement || hit === document.body)) return;
    findings.push({ level: 'error', score: 40, text: `click blocked by ${cssPath(hit)}` });
}

function pushImage(el, findings) {
    if (!el || el.tagName !== 'IMG') return;
    const naturalW = el.naturalWidth;
    const naturalH = el.naturalHeight;
    const shownW = el.clientWidth;
    const shownH = el.clientHeight;
    if (!naturalW || !naturalH || !shownW || !shownH) return;
    const natural = naturalW / naturalH;
    const shown = shownW / shownH;
    const diff = Math.abs(natural - shown) / natural;
    const fit = getComputedStyle(el).objectFit;
    if (diff <= 0.05 || fit !== 'fill') return;
    findings.push({
        level: 'error',
        score: diff * 100,
        text: `distorted image ${Math.round(diff * 100)}% (object-fit: fill)`
    });
}

function coveringPseudo(x, y) {
    const hosts = [document.documentElement, document.body];
    const names = ['::before', '::after'];
    for (let i = 0; i < hosts.length; i++) {
        const host = hosts[i];
        if (!host) continue;
        for (let j = 0; j < names.length; j++) {
            const box = pseudoBox(host, names[j]);
            if (!box || box.pointerEvents === 'none') continue;
            if (x < box.x || y < box.y || x > box.x + box.w || y > box.y + box.h) continue;
            return `${host.tagName.toLowerCase()}${names[j]}`;
        }
    }
    return '';
}

function pseudoBox(el, pseudo) {
    const style = getComputedStyle(el, pseudo);
    const content = style.content;
    if (!content || content === 'none' || content === 'normal') return null;
    if (style.position !== 'fixed' && style.position !== 'absolute') return null;
    const width = parseFloat(style.width);
    const height = parseFloat(style.height);
    if (!width || !height || width < 2 || height < 2) return null;
    let x = parseFloat(style.left);
    let y = parseFloat(style.top);
    if (!Number.isFinite(x)) x = 0;
    if (!Number.isFinite(y)) y = 0;
    if (style.position === 'absolute') {
        const host = el.getBoundingClientRect();
        x = host.left + x;
        y = host.top + y;
    }
    return { x, y, w: width, h: height, pointerEvents: style.pointerEvents };
}

function pickElement(x, y) {
    if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return null;
    const stack = document.elementsFromPoint(x, y);
    for (let i = 0; i < stack.length; i++) {
        const el = stack[i];
        if (!el || isBeeChrome(el)) continue;
        if (el === document.documentElement || el === document.body) continue;
        return el;
    }
    return null;
}

function paintBehind(el) {
    const own = parseColor(getComputedStyle(el).backgroundColor);
    if (own && own.a > 0.04) return own;
    let node = el.parentElement;
    while (node) {
        const bg = parseColor(getComputedStyle(node).backgroundColor);
        if (bg && bg.a > 0.04) return bg;
        node = node.parentElement;
    }
    return null;
}

function opacityZero(el) {
    let node = el;
    while (node && node.nodeType === 1) {
        const value = parseFloat(getComputedStyle(node).opacity);
        if (value === 0) return true;
        node = node.parentElement;
    }
    return false;
}

function parseColor(value) {
    const text = String(value || '').trim();
    if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    const match = text.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/);
    if (!match) return null;
    let alpha = 1;
    if (match[4] != null) {
        alpha = match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
    }
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: alpha };
}

function nearlySame(a, b) {
    return Math.abs(a.r - b.r) < 2
        && Math.abs(a.g - b.g) < 2
        && Math.abs(a.b - b.b) < 2
        && Math.abs(a.a - b.a) < 0.05;
}

function hasOwnText(el) {
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'LABEL' || tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (el.childElementCount > 0) return false;
    return Boolean((el.textContent || '').trim());
}

function cssPath(el) {
    if (!el || !el.tagName) return 'node';
    const tag = el.tagName.toLowerCase();
    if (el.id) return `${tag}#${el.id}`;
    const classes = el.classList ? [...el.classList].slice(0, 2) : [];
    if (classes.length) return `${tag}.${classes.join('.')}`;
    return tag;
}

function isSkippedTag(el) {
    const tag = el.tagName;
    return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META';
}

function isTypingTarget(target) {
    if (!target || !target.tagName) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return Boolean(target.isContentEditable);
}

function touchesSheet(record) {
    if (!record) return false;
    if (record.type === 'characterData') return record.target?.parentElement?.nodeName === 'STYLE';
    if (record.type === 'attributes') {
        const name = record.target?.nodeName;
        return name === 'STYLE' || name === 'LINK';
    }
    const nodes = [record.target];
    if (record.addedNodes) {
        for (let i = 0; i < record.addedNodes.length; i++) nodes.push(record.addedNodes[i]);
    }
    if (record.removedNodes) {
        for (let i = 0; i < record.removedNodes.length; i++) nodes.push(record.removedNodes[i]);
    }
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node || node.nodeType !== 1) continue;
        if (node.nodeName === 'STYLE' || node.nodeName === 'LINK') return true;
        if (typeof node.querySelector === 'function' && node.querySelector('style, link')) return true;
    }
    return false;
}

function isBeeChrome(node) {
    let el = node && node.nodeType === 1 ? node : node?.parentElement;
    while (el) {
        if (el.tagName === 'BEE-LADYBUG-OVERLAY') return true;
        if (el.hasAttribute?.('data-bee-ladybug-dom')) return true;
        if (el.hasAttribute?.('data-bee-ladybug-canvas')) return true;
        if (el.hasAttribute?.('data-bee-ladybug-css')) return true;
        el = el.parentElement;
    }
    return false;
}

function makeBox(kind, border, fill) {
    const node = document.createElement('div');
    node.setAttribute('data-bee-ladybug-css', kind);
    node.style.position = 'fixed';
    node.style.pointerEvents = 'none';
    node.style.zIndex = '2147483644';
    node.style.display = 'none';
    node.style.boxSizing = 'border-box';
    node.style.border = border;
    node.style.background = fill;
    return node;
}

function placeBox(node, el) {
    if (!node) return;
    if (!el || typeof el.getBoundingClientRect !== 'function' || isBeeChrome(el)) {
        node.style.display = 'none';
        return;
    }
    const rect = el.getBoundingClientRect();
    node.style.display = 'block';
    node.style.left = `${rect.left}px`;
    node.style.top = `${rect.top}px`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
}
