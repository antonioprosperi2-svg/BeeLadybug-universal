/**
 * CSSAdapter — CSS hunt.
 *
 * Hover an element to list !important hits, viewport overflow, negative
 * margins, invisible text, click blockers and stretched images. The core
 * only receives packets and detail rows; it does not parse CSS.
 * `snapshot()` repeats that scan for the report while the hunt is off.
 *
 * @example
 * const css = new CSSAdapter(core);
 * css.attach();
 * // F6 toggles hunt. S scans the page while hunt is on.
 */

import { isReportNoise } from '../core/ReportExporter.js';

const MAX_SNAPSHOT = 80;

export const CSS_ADAPTER_DEFAULTS = Object.freeze({
    source: 'css',
    hotkey: 'F6',
    scanKey: 'KeyS',
    pinKey: 'KeyP',
    label: 'F6 CSS',
    maxScan: 8,
    issueWindow: 5000,
    maxIssues: 10
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
        this.pinKey = cfg.pinKey;
        this.label = cfg.label;
        this.maxScan = cfg.maxScan;
        this.issueWindow = cfg.issueWindow;
        this.maxIssues = cfg.maxIssues;

        this.#attached = false;
        this.#active = false;
        this.#rules = [];
        this.#sheetsDirty = true;
        this.#x = 0;
        this.#y = 0;
        this.#rafId = 0;
        this.#lastEl = null;
        this.#pinned = null;
        this.#panelLock = false;
        this.#issues = [];
        this.#notes = [];
        this.#seenSheets = new Set();
        this.#issueLog = new Map();
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
    #sheetsDirty;
    #x;
    #y;
    #rafId;
    #lastEl;
    #pinned;
    #panelLock;
    #issues;
    #notes;
    #seenSheets;
    #issueLog;
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
            disable: () => this.#disable(),
            snapshot: () => this.snapshot()
        });
        this.core?.sendData('log', {
            source: this.source,
            message: 'CSSAdapter attached. F6 CSS hunt. S scans. P pins the panel.'
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

    /** Page scan. Click a row to outline one element of that group. */
    scan() {
        if (!this.#active || typeof document === 'undefined') return this;
        if (this.#sheetsDirty) this.#rebuildSheets();
        const nodes = document.body ? document.body.querySelectorAll('*') : [];
        const overflow = [];
        const rows = [];
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            if (!el || isBeeChrome(el) || isSkippedTag(el)) continue;
            const measured = measureViewportOverflow(el);
            if (measured) overflow.push(measured);
            const findings = [];
            pushNegativeMargins(el, findings);
            pushInvisible(el, findings);
            pushBlockers(el, findings);
            pushImage(el, findings);
            pushStacking(el, findings);
            pushImportant(el, this.#rules, findings);
            for (let j = 0; j < findings.length; j++) {
                rows.push({ el, selector: cssPath(el), ...findings[j] });
            }
        }
        const causes = keepOverflowCauses(overflow);
        for (let i = 0; i < causes.length; i++) {
            const cause = causes[i];
            rows.push({
                el: cause.el,
                selector: cssPath(cause.el),
                kind: 'overflows viewport',
                rank: 0,
                level: 'error',
                score: cause.score
            });
        }
        const groups = groupIssues(rows);
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            this.#rememberCause(row.el, row.selector, row.kind);
        }
        this.#publishIssues();
        const shown = groups.slice(0, this.maxScan);
        const items = shown.map((group) => ({
            level: group.level,
            text: formatIssue(group),
            onSelect: () => this.#pin(group.el)
        }));
        this.#lastEl = null;
        this.core?.publishDetail(items);
        this.core?.sendData('state', {
            source: this.source,
            key: 'css.scan',
            value: String(shown.length)
        });
        if (shown.length || isVerbose(this.core)) {
            this.core?.sendData('warn', {
                source: this.source,
                message: shown.length
                    ? `scan ${shown.length} issue(s). Click a row to outline it.`
                    : 'scan clean: no causes found.'
            });
        }
        return this;
    }

    /**
     * Full hunt scan for the report. Hunt can stay off: nothing is logged,
     * pinned, or published. Hidden boxes, WordPress admin, and BeeLadybug
     * chrome are skipped.
     * @returns {{ name: string, items: Array<{ severity: string, selector: string, rule: string, value: string, source: string }> } | null}
     */
    snapshot() {
        if (!this.#attached) return null;
        if (typeof document === 'undefined' || !document.body) return { name: 'css', items: [] };

        const built = collectImportantRules();
        const nodes = document.body.querySelectorAll('*');
        const overflow = [];
        const rows = [];
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            if (!el || isBeeChrome(el) || isSkippedTag(el) || isReportNoise(el)) continue;
            const measured = measureViewportOverflow(el);
            if (measured) overflow.push(measured);
            const findings = [];
            pushNegativeMargins(el, findings);
            pushInvisible(el, findings);
            pushBlockers(el, findings, true);
            pushImage(el, findings);
            pushStacking(el, findings, true);
            pushImportant(el, built.rules, findings);
            for (let j = 0; j < findings.length; j++) {
                rows.push({ el, selector: cssPath(el), ...findings[j] });
            }
        }
        const kept = keepOverflowCauses(overflow);
        for (let i = 0; i < kept.length; i++) {
            const cause = kept[i];
            rows.push({
                el: cause.el,
                selector: cssPath(cause.el),
                kind: 'overflows viewport',
                rank: 0,
                level: 'error',
                score: cause.score
            });
        }

        let causes = [];
        const plain = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (describeCause(row.kind, row.selector)) {
                causes = addCause(causes, { kind: row.kind, path: row.selector, el: row.el }, MAX_SNAPSHOT);
            } else {
                plain.push(row);
            }
        }

        const items = [];
        for (let i = 0; i < causes.length; i++) {
            const entry = causes[i];
            items.push({
                severity: reportSeverity(entry.level),
                selector: entry.cause,
                rule: causeRule(entry.type),
                value: formatCause(entry),
                source: this.source
            });
        }
        const groups = groupIssues(plain);
        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            const count = group.count > 1 ? ` ×${group.count}` : '';
            items.push({
                severity: reportSeverity(group.level),
                selector: group.selector,
                rule: plainRule(group.kind),
                value: `${group.kind}${count}`,
                source: this.source
            });
        }
        for (let i = 0; i < built.unreadable.length; i++) {
            const label = built.unreadable[i];
            items.push({
                severity: 'ok',
                selector: label,
                rule: 'unreadable sheet',
                value: label,
                source: this.source
            });
        }
        items.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
        if (items.length > MAX_SNAPSHOT) items.length = MAX_SNAPSHOT;
        return { name: 'css', items };
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
            message: 'CSS hunt on. Hover an element, P pins the panel, S scans.'
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
        this.#panelLock = false;
        this.#issues = [];
        this.#notes = [];
        this.#seenSheets.clear();
        this.#issueLog.clear();
        this.#unmountBoxes();
        this.core?.publishDetail([]);
        this.core?.publishIssues([]);
        this.core?.sendData('state', { source: this.source, key: 'css.hunt', value: 'off' });
        this.core?.sendData('log', { source: this.source, message: 'CSS hunt off.' });
    }

    #handleKey(event) {
        if (!this.#active || event.repeat) return;
        if (isTypingTarget(event.target)) return;
        if (event.code === this.pinKey) {
            event.preventDefault();
            this.#togglePanelPin();
            return;
        }
        if (event.code !== this.scanKey) return;
        event.preventDefault();
        this.#panelLock = false;
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
        for (let i = 0; i < built.unreadable.length; i++) this.#rememberSheet(built.unreadable[i]);
        this.#publishIssues();
    }

    #inspect(x, y) {
        const el = pickElement(x, y);
        placeBox(this.#hoverBox, el);
        if (this.#panelLock) return;
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
        pushStacking(el, findings);
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
        this.#stickFindings(el, path, findings);
        if (!findings.length) {
            if (isVerbose(this.core)) {
                this.core?.sendData('log', { source: this.source, message: `${path}  clean` });
            }
            return;
        }
        this.#logFindings(path, findings);
    }

    #togglePanelPin() {
        if (this.#panelLock) {
            this.#panelLock = false;
            this.#pinned = null;
            placeBox(this.#pinBox, null);
            this.core?.sendData('state', { source: this.source, key: 'css.pin', value: 'off' });
            this.core?.sendData('log', { source: this.source, message: 'CSS pin off.' });
            this.#lastEl = null;
            this.#schedule();
            return;
        }
        const el = this.#lastEl;
        if (!el) return;
        this.#panelLock = true;
        this.#pin(el);
        const path = cssPath(el);
        this.core?.sendData('state', { source: this.source, key: 'css.pin', value: path });
        this.core?.sendData('log', { source: this.source, message: `CSS pin ${path}` });
    }

    #logFindings(path, findings) {
        const now = nowMs();
        for (let i = 0; i < findings.length; i++) {
            const hit = findings[i];
            const text = hit.text || hit.kind || '';
            if (!text || text.startsWith('unreadable sheet:') || hit.level === 'info') continue;
            if (!rememberIssue(this.#issueLog, `${path}\0${text}`, now, this.issueWindow)) continue;
            const level = hit.level === 'error' ? 'error' : 'warn';
            this.core?.sendData(level, {
                source: this.source,
                message: `${path}  ${text}`
            });
        }
    }

    #stickFindings(el, path, findings) {
        let changed = false;
        for (let i = 0; i < findings.length; i++) {
            const hit = findings[i];
            if (hit.kind === 'overflows viewport' && !elementCausesOverflow(el)) continue;
            if (this.#rememberCause(el, path, hit.kind)) changed = true;
        }
        if (changed) this.#publishIssues();
    }

    #rememberCause(el, path, kind) {
        const next = addCause(this.#issues, { kind, path, el }, this.maxIssues);
        if (next === this.#issues) return false;
        this.#issues = next;
        return true;
    }

    #rememberSheet(href) {
        const label = String(href || '');
        if (!label || this.#seenSheets.has(label)) return;
        this.#seenSheets.add(label);
        this.#notes.push({ text: `unreadable sheet: ${label}` });
        this.core?.sendData('log', {
            source: this.source,
            level: 'info',
            message: `unreadable sheet: ${label}`
        });
    }

    #publishIssues() {
        const bugs = [];
        const notes = this.#notes.map((note) => ({
            level: 'info',
            key: note.text,
            text: note.text
        }));
        for (let i = 0; i < this.#issues.length; i++) {
            const entry = this.#issues[i];
            const item = {
                key: entry.key,
                text: formatCause(entry),
                targets: entry.targets.map((target) => ({
                    text: target.text,
                    onSelect: () => this.#pin(target.el)
                }))
            };
            if (entry.level === 'info') notes.push({ ...item, level: 'info' });
            else bugs.push({ ...item, level: 'error' });
        }
        this.core?.publishIssues(bugs.concat(notes));
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
                rank: 4,
                score: 5,
                kind: `!important ${rule.selector} { ${prop.property}: ${prop.value} }`,
                text: `!important ${rule.selector} { ${prop.property}: ${prop.value} } @ ${rule.source}`
            });
        }
    }
}

function pushOverflow(el, findings) {
    const measured = measureViewportOverflow(el);
    if (measured) {
        const past = measured.left > 1
            ? `left ${Math.round(-measured.left)}px`
            : `right +${Math.round(measured.right)}px`;
        findings.push({
            level: 'error',
            rank: 0,
            score: measured.score,
            kind: 'overflows viewport',
            text: `overflows viewport (${past})`
        });
    }
    pushNegativeMargins(el, findings);
}

function measureViewportOverflow(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    if (typeof document === 'undefined') return null;
    if (el === document.documentElement || el === document.body) return null;
    const rect = el.getBoundingClientRect();
    const view = document.documentElement.clientWidth;
    const left = rect.left < -1 ? -rect.left : 0;
    const right = rect.right > view + 1 ? rect.right - view : 0;
    if (left <= 1 && right <= 1) return null;
    return { el, left, right, width: rect.width, view, score: Math.max(left, right) };
}

/**
 * Keep the node that actually sticks out.
 * Drop a parent when a descendant overflows by the same amount (±2px),
 * and drop a box whose own width fits the viewport when a child is the one overflowing.
 * @param {Array<{ el: Element, left: number, right: number, width: number, view: number, score: number }>} items
 */
export function keepOverflowCauses(items) {
    return items.filter((item) => !echoedByDescendant(item, items) && !fitsOnlyBecauseOfChild(item, items));
}

function echoedByDescendant(item, items) {
    for (let i = 0; i < items.length; i++) {
        const other = items[i];
        if (other.el === item.el || typeof item.el.contains !== 'function' || !item.el.contains(other.el)) continue;
        const leftEcho = item.left <= 1 || Math.abs(item.left - other.left) <= 2;
        const rightEcho = item.right <= 1 || Math.abs(item.right - other.right) <= 2;
        const matched = (item.left > 1 && Math.abs(item.left - other.left) <= 2)
            || (item.right > 1 && Math.abs(item.right - other.right) <= 2);
        if (matched && leftEcho && rightEcho) return true;
    }
    return false;
}

function fitsOnlyBecauseOfChild(item, items) {
    if (item.width > item.view + 2) return false;
    if (item.left <= 1 && item.right <= 1) return false;
    let leftOk = item.left <= 1;
    let rightOk = item.right <= 1;
    let childOverflows = false;
    for (let i = 0; i < items.length; i++) {
        const other = items[i];
        if (other.el === item.el || typeof item.el.contains !== 'function' || !item.el.contains(other.el)) continue;
        if (other.left > 1 || other.right > 1) childOverflows = true;
        if (item.left > 1 && other.left + 2 >= item.left) leftOk = true;
        if (item.right > 1 && other.right + 2 >= item.right) rightOk = true;
    }
    return childOverflows && leftOk && rightOk;
}

function pushNegativeMargins(el, findings) {
    if (typeof getComputedStyle !== 'function') return;
    const style = getComputedStyle(el);
    const sides = ['top', 'right', 'bottom', 'left'];
    for (let i = 0; i < sides.length; i++) {
        const raw = style.getPropertyValue(`margin-${sides[i]}`);
        const value = parseFloat(raw);
        if (!Number.isFinite(value) || value >= 0) continue;
        findings.push({
            level: 'warn',
            rank: 5,
            score: Math.abs(value),
            kind: `negative margin margin-${sides[i]}: ${raw.trim()}`,
            text: `negative margin margin-${sides[i]}: ${raw.trim()}`
        });
    }
}

const ISSUE_RANK = Object.freeze({
    overflow: 0,
    blocker: 1,
    stack: 1,
    invisible: 2,
    image: 3,
    important: 4,
    hint: 6
});

/**
 * @param {Array<{ selector: string, kind: string, rank: number, level: string, score: number, el?: Element }>} rows
 */
export function groupIssues(rows) {
    const map = new Map();
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const kind = row.kind || row.text;
        const key = `${row.selector}\0${kind}`;
        const prev = map.get(key);
        if (!prev) {
            map.set(key, { ...row, kind, count: 1 });
            continue;
        }
        prev.count += 1;
        if (row.score > prev.score) {
            prev.score = row.score;
            prev.el = row.el;
        }
    }
    return [...map.values()].sort((a, b) => a.rank - b.rank || b.score - a.score || b.count - a.count);
}

export function formatIssue(group) {
    const count = group.count > 1 ? ` ×${group.count}` : '';
    return `${group.selector} ${group.kind}${count}`;
}

function pushInvisible(el, findings) {
    if (!hasOwnText(el)) return;
    const style = getComputedStyle(el);
    if (opacityZero(el)) {
        findings.push(issue('invisible text (opacity 0)', ISSUE_RANK.invisible, 30));
    }
    const color = parseColor(style.color);
    if (!color || color.a === 0) {
        findings.push(issue('invisible text (transparent color)', ISSUE_RANK.invisible, 30));
        return;
    }
    const behind = paintBehind(el);
    if (behind && nearlySame(color, behind)) {
        findings.push(issue('invisible text (color matches background)', ISSUE_RANK.invisible, 30));
    }
}

function pushBlockers(el, findings, skipNoise = false) {
    if (!el.getBoundingClientRect || typeof document.elementFromPoint !== 'function') return;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return;
    const pseudo = coveringPseudo(x, y);
    if (pseudo) {
        findings.push(issue(`click blocked by ${pseudo}`, ISSUE_RANK.blocker, 40));
    }
    const hit = document.elementFromPoint(x, y);
    if (!hit || isBeeChrome(hit) || hit === el || el.contains(hit)) return;
    if (pseudo && (hit === document.documentElement || hit === document.body)) return;
    if (skipNoise && isReportNoise(hit)) return;
    findings.push(issue(`click blocked by ${cssPath(hit)}`, ISSUE_RANK.blocker, 40));
}

function pushImage(el, findings) {
    if (!el || el.tagName !== 'IMG') return;
    const naturalW = el.naturalWidth;
    const naturalH = el.naturalHeight;
    if (!naturalW || !naturalH || typeof el.getBoundingClientRect !== 'function') return;
    const rect = el.getBoundingClientRect();
    const fit = (typeof getComputedStyle === 'function' ? getComputedStyle(el).objectFit : '') || 'fill';
    if (!isDistortedImage(naturalW, naturalH, rect.width, rect.height, fit)) return;
    const gap = renderedRatioGap(naturalW, naturalH, rect.width, rect.height);
    findings.push({
        level: 'error',
        rank: ISSUE_RANK.image,
        score: gap * 100,
        kind: 'distorted image',
        text: `distorted image ${Math.round(gap * 100)}% (object-fit: fill)`
    });
}

/**
 * Rendered box versus the file. Attributes and clientWidth are ignored.
 * `object-fit` defaults to fill. Flag when the ratios differ by more than 5%.
 */
export function isDistortedImage(naturalW, naturalH, renderedW, renderedH, objectFit) {
    const fit = objectFit || 'fill';
    if (fit !== 'fill') return false;
    return renderedRatioGap(naturalW, naturalH, renderedW, renderedH) > 0.05;
}

export function renderedRatioGap(naturalW, naturalH, renderedW, renderedH) {
    if (!naturalW || !naturalH || !renderedW || !renderedH) return 0;
    const natural = naturalW / naturalH;
    const rendered = renderedW / renderedH;
    return Math.abs(natural - rendered) / natural;
}

/** @returns {boolean} true when this issue should be written to the event list */
export function rememberIssue(seen, key, now, windowMs = 5000) {
    const prev = seen.get(key);
    if (typeof prev === 'number' && now - prev < windowMs) return false;
    seen.set(key, now);
    if (seen.size > 64) {
        for (const [name, at] of seen) {
            if (now - at >= windowMs) seen.delete(name);
        }
    }
    return true;
}

/**
 * Newest first, duplicates move to the top, capped at `max`.
 * @param {Array<{ text: string, el?: Element }>} list
 * @param {{ text: string, el?: Element }} entry
 */
export function pushStickyIssue(list, entry, max = 10) {
    const next = [entry];
    for (let i = 0; i < list.length; i++) {
        if (list[i].text === entry.text) continue;
        next.push(list[i]);
        if (next.length >= max) break;
    }
    return next.slice(0, max);
}

export function describeCause(kind, path) {
    if (kind === 'overflows viewport') {
        return { key: `overflow\0${path}`, type: 'overflow', cause: path, reason: '', level: 'error' };
    }
    const prefix = 'click blocked by ';
    if (typeof kind === 'string' && kind.startsWith(prefix)) {
        const cause = kind.slice(prefix.length);
        return { key: `block\0${cause}`, type: 'block', cause, reason: '', level: 'error' };
    }
    const stack = typeof kind === 'string' ? kind.match(/^stacking context \(([^)]+)\) by (.+)$/) : null;
    if (stack) {
        return {
            key: `stack\0${stack[2]}\0${stack[1]}`,
            type: 'stack',
            cause: stack[2],
            reason: stack[1],
            level: 'error'
        };
    }
    const hint = typeof kind === 'string' ? kind.match(/^will-change (.+?) by (.+)$/) : null;
    if (hint) {
        return {
            key: `will\0${hint[2]}\0${hint[1]}`,
            type: 'stack-hint',
            cause: hint[2],
            reason: hint[1],
            level: 'info'
        };
    }
    return null;
}

/**
 * One row per cause. A blocker that covers many nodes stays a single row.
 * @param {Array<{ key: string, type: string, cause: string, targets: Array<{ text: string, el?: Element }> }>} list
 * @param {{ kind?: string, path: string, el?: Element }} entry
 */
export function addCause(list, entry, max = 10) {
    const described = describeCause(entry.kind, entry.path);
    if (!described) return list;
    const target = { text: entry.path, el: entry.el };
    const rest = [];
    let prev = null;
    for (let i = 0; i < list.length; i++) {
        if (list[i].key === described.key) prev = list[i];
        else rest.push(list[i]);
    }
    const targets = prev ? prev.targets.filter((item) => !sameTarget(item, target)) : [];
    targets.unshift(target);
    rest.unshift({
        key: described.key,
        type: described.type,
        cause: described.cause,
        reason: described.reason || '',
        level: described.level || 'error',
        targets
    });
    return rest.slice(0, max);
}

export function formatCause(entry) {
    const count = entry.targets.length;
    if (entry.type === 'block') {
        const noun = count === 1 ? 'element' : 'elements';
        return `${entry.cause} blocks clicks on ${count} ${noun}`;
    }
    if (entry.type === 'stack') {
        const noun = count === 1 ? 'child' : 'children';
        return `${entry.cause} creates stacking context (${entry.reason}) - z-index of ${count} ${noun} is trapped`;
    }
    if (entry.type === 'stack-hint') {
        const noun = count === 1 ? 'child' : 'children';
        return `${entry.cause} will-change: ${entry.reason} — z-index of ${count} ${noun} stays in this layer`;
    }
    if (count <= 1) return `${entry.cause} overflows viewport`;
    return `${entry.cause} overflows viewport · ${count} elements`;
}

/**
 * Properties that create a stacking context. `will-change` for transform or
 * opacity is only a hint: it may promote a layer, it is not reported as a bug.
 * @param {{ transform?: string, opacity?: string, filter?: string, position?: string, zIndex?: string, willChange?: string, getPropertyValue?: (name: string) => string }} style
 */
export function stackingReasons(style) {
    const read = (prop, camel) => {
        if (style && typeof style.getPropertyValue === 'function') {
            const raw = style.getPropertyValue(prop);
            if (raw) return String(raw).trim();
        }
        if (style && style[camel] != null && style[camel] !== '') return String(style[camel]).trim();
        return '';
    };
    const bugs = [];
    const transform = read('transform', 'transform');
    if (transform && transform !== 'none') bugs.push('transform');
    const opacity = parseFloat(read('opacity', 'opacity'));
    if (Number.isFinite(opacity) && opacity < 1) bugs.push('opacity');
    const filter = read('filter', 'filter');
    if (filter && filter !== 'none') bugs.push('filter');
    const position = read('position', 'position') || 'static';
    const zIndex = read('z-index', 'zIndex') || 'auto';
    if (position !== 'static' && zIndex !== 'auto') bugs.push('z-index');
    const hint = willChangeHint(read('will-change', 'willChange'));
    return { bugs, hint };
}

function willChangeHint(value) {
    if (!value || value === 'auto') return '';
    const parts = value.split(',').map((part) => part.trim().toLowerCase());
    const hit = [];
    for (let i = 0; i < parts.length; i++) {
        if ((parts[i] === 'transform' || parts[i] === 'opacity') && !hit.includes(parts[i])) hit.push(parts[i]);
    }
    return hit.join(', ');
}

function pushStacking(el, findings, skipNoise = false) {
    if (!el || typeof getComputedStyle !== 'function' || !el.parentElement) return;
    const own = getComputedStyle(el);
    const ownZ = own.zIndex || own.getPropertyValue?.('z-index') || 'auto';
    if (!ownZ || ownZ === 'auto') return;
    let node = el.parentElement;
    while (node && node.nodeType === 1) {
        if (isBeeChrome(node)) return;
        if (skipNoise && isReportNoise(node)) return;
        const found = stackingReasons(getComputedStyle(node));
        const ancestor = cssPath(node);
        if (found.bugs.length) {
            const reason = found.bugs[0];
            findings.push({
                level: 'error',
                rank: ISSUE_RANK.stack,
                score: 35,
                kind: `stacking context (${reason}) by ${ancestor}`,
                text: `z-index trapped by ${ancestor} (${reason})`
            });
            if (found.hint) findings.push(stackHint(ancestor, found.hint));
            return;
        }
        if (found.hint) {
            findings.push(stackHint(ancestor, found.hint));
            return;
        }
        node = node.parentElement;
    }
}

function stackHint(ancestor, hint) {
    return {
        level: 'info',
        rank: ISSUE_RANK.hint,
        score: 1,
        kind: `will-change ${hint} by ${ancestor}`,
        text: `will-change: ${hint} on ${ancestor}`
    };
}

function sameTarget(a, b) {
    if (a.el && b.el) return a.el === b.el;
    return a.text === b.text;
}

function elementCausesOverflow(el) {
    const self = measureViewportOverflow(el);
    if (!self) return false;
    const items = [self];
    if (typeof el.querySelectorAll === 'function') {
        const nodes = el.querySelectorAll('*');
        for (let i = 0; i < nodes.length; i++) {
            const measured = measureViewportOverflow(nodes[i]);
            if (measured) items.push(measured);
        }
    }
    const causes = keepOverflowCauses(items);
    for (let i = 0; i < causes.length; i++) {
        if (causes[i].el === el) return true;
    }
    return false;
}

function nowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function reportSeverity(level) {
    if (level === 'error') return 'error';
    if (level === 'warn' || level === 'warning') return 'warn';
    return 'ok';
}

function severityRank(level) {
    if (level === 'error') return 0;
    if (level === 'warn') return 1;
    return 2;
}

function causeRule(type) {
    if (type === 'block') return 'click blocked';
    if (type === 'stack') return 'stacking context';
    if (type === 'stack-hint') return 'will-change';
    return 'overflow';
}

function plainRule(kind) {
    const text = String(kind || '');
    if (text.startsWith('!important')) return '!important';
    if (text.startsWith('invisible text')) return 'invisible text';
    if (text.startsWith('negative margin')) return 'negative margin';
    if (text === 'distorted image') return 'distorted image';
    return text;
}

function issue(kind, rank, score) {
    return { level: 'error', rank, score, kind, text: kind };
}

function isVerbose(core) {
    return Boolean(core) && !core.frozen && core.timeScale !== 1;
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
