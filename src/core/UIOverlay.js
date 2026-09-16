/**
 * UIOverlay — isolated cyberpunk HUD.
 *
 * Lives in Shadow DOM so host pages cannot restyle it. The core pushes
 * packets; this class only renders. Safe to skip entirely (headless core).
 */

function formatSimTime(ms) {
    const total = Math.max(0, ms) / 1000;
    const m = Math.floor(total / 60);
    const s = total - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

const HOST_TAG = 'bee-ladybug-overlay';

const STYLES = `
:host {
  all: initial;
  pointer-events: none;
}
.bl-root {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  font-family: ui-monospace, "Cascadia Code", "Fira Code", Consolas, monospace;
  color: #e9edf5;
}
.bl-root[data-visible="false"] {
  display: none;
}
.bl-panel {
  pointer-events: auto;
  position: absolute;
  top: 12px;
  left: 12px;
  width: 360px;
  background: rgba(7, 8, 12, 0.94);
  border: 1px solid rgba(255, 59, 78, 0.55);
  box-sizing: border-box;
  overflow: hidden;
}
.bl-panel::before {
  content: "";
  position: absolute;
  inset: 4px;
  border: 1px solid rgba(255, 211, 106, 0.12);
  pointer-events: none;
}
.bl-scan {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0 2px,
    rgba(0, 0, 0, 0.16) 2px 3px
  );
  opacity: 0.35;
}
.bl-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid rgba(255, 59, 78, 0.28);
}
.bl-mark {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ff3b4e;
  position: relative;
  flex: 0 0 auto;
  box-shadow: 0 0 0 1px rgba(255, 211, 106, 0.35);
}
.bl-mark::before,
.bl-mark::after {
  content: "";
  position: absolute;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #12080a;
  top: 4px;
}
.bl-mark::before { left: 3px; }
.bl-mark::after { right: 3px; }
.bl-title {
  color: #ffd36a;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
}
.bl-badge {
  font-size: 9px;
  letter-spacing: 0.12em;
  color: #6ee7ff;
  border: 1px solid rgba(110, 231, 255, 0.35);
  padding: 1px 5px;
}
.bl-mode-wrap {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  position: relative;
}
.bl-mode {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #3eea7a;
}
.bl-mode[data-mode="FREEZE"] { color: #ff3b4e; }
.bl-mode[data-mode^="SLOW"] { color: #ffd36a; }
.bl-info {
  appearance: none;
  position: relative;
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  padding: 0;
  border: 1px solid rgba(139, 145, 163, 0.7);
  border-radius: 50%;
  background: transparent;
  color: #8b91a3;
  font: 700 9px ui-monospace, Consolas, monospace;
  line-height: 1;
  cursor: help;
}
.bl-info:hover,
.bl-info:focus-visible {
  color: #ffd36a;
  border-color: #ffd36a;
  outline: none;
}
.bl-info-tip {
  display: none;
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 228px;
  padding: 8px 9px;
  background: #0c0e14;
  border: 1px solid rgba(255, 211, 106, 0.45);
  color: #e9edf5;
  font: 400 10px/1.45 ui-monospace, Consolas, monospace;
  letter-spacing: 0;
  text-transform: none;
  z-index: 3;
  pointer-events: none;
  white-space: normal;
  text-align: left;
}
.bl-info:hover .bl-info-tip,
.bl-info:focus .bl-info-tip,
.bl-info:focus-visible .bl-info-tip {
  display: block;
}
.bl-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 12px;
  padding: 8px 12px 6px;
  font-size: 11px;
  color: #c5cad6;
}
.bl-stats b {
  color: #fff;
  font-weight: 700;
}
.bl-graph-wrap {
  padding: 0 12px 6px;
}
.bl-graph {
  display: block;
  width: 100%;
  height: 52px;
  background: #05060a;
  border: 1px solid rgba(255, 211, 106, 0.16);
}
.bl-graph-label {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  color: #8b91a3;
  margin-top: 3px;
  letter-spacing: 0.06em;
}
.bl-hud {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 2px 8px;
  padding: 4px 12px 8px;
  font-size: 11px;
  max-height: 88px;
  overflow: auto;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}
.bl-k { color: #8b91a3; }
.bl-v { color: #e9edf5; }
.bl-console {
  height: 168px;
  overflow: auto;
  padding: 6px 10px 8px;
  background: #05060a;
  border-top: 1px solid rgba(255, 59, 78, 0.22);
  font-size: 11px;
  line-height: 1.45;
}
.bl-line { white-space: normal; word-break: break-word; }
.bl-line .t { color: #8b91a3; margin-right: 8px; }
.bl-line .s { color: #6ee7ff; margin-right: 8px; }
.bl-line.info .m { color: #d8dce6; }
.bl-line.warn .m { color: #ffd36a; }
.bl-line.error .m { color: #ff6b7d; }
.bl-line.debug .m { color: #8b91a3; }
.bl-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid rgba(255, 59, 78, 0.22);
}
.bl-btn {
  appearance: none;
  background: #16181f;
  color: #fff6d8;
  border: 1px solid #ffd36a;
  font: 700 9px ui-monospace, Consolas, monospace;
  letter-spacing: 0.06em;
  padding: 5px 7px;
  cursor: pointer;
}
.bl-btn[data-hot="true"] {
  background: #ff3b4e;
  border-color: #ff3b4e;
  color: #fff;
}
.bl-providers {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.bl-providers:empty {
  display: none;
}
.bl-adapters {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.bl-adapters:empty {
  display: none;
}
.bl-adapter {
  appearance: none;
  background: #16181f;
  color: #8b91a3;
  border: 1px solid rgba(139, 145, 163, 0.45);
  font: 700 9px ui-monospace, Consolas, monospace;
  letter-spacing: 0.06em;
  padding: 5px 7px;
  cursor: pointer;
}
.bl-adapter[data-hot="true"] {
  color: #fff6d8;
  border-color: #ffd36a;
}
.bl-adapter[data-flash="true"] {
  animation: bl-adapter-flash 0.55s ease;
}
@keyframes bl-adapter-flash {
  0% {
    background: #ffd36a;
    color: #05060a;
    border-color: #ffd36a;
  }
  100% {
    background: #16181f;
  }
}
.bl-provider {
  appearance: none;
  width: 22px;
  height: 22px;
  padding: 0;
  background: #16181f;
  color: #fff6d8;
  border: 1px solid rgba(255, 211, 106, 0.45);
  font: 700 8px ui-monospace, Consolas, monospace;
  letter-spacing: 0.04em;
  cursor: pointer;
}
.bl-provider[data-hot="true"] {
  background: #6ee7ff;
  border-color: #6ee7ff;
  color: #05060a;
}
.bl-hint {
  margin-left: auto;
  font-size: 9px;
  color: #8b91a3;
}
@media (prefers-reduced-motion: reduce) {
  .bl-scan { display: none; }
  .bl-adapter[data-flash="true"] {
    animation: none;
    background: #ffd36a;
    color: #05060a;
    border-color: #ffd36a;
  }
}
`;

export class UIOverlay {
    /**
     * @param {import('./BeeLadybugCore.js').BeeLadybugCore} core
     * @param {object} [options]
     */
    constructor(core, options = {}) {
        this.core = core;
        void options;
        this.#host = null;
        this.#root = null;
        this.#els = null;
        this.#stickBottom = true;
        this.#lastLogId = 0;
        this.#mounted = false;
        this.#providerSig = '';
        this.#adapterSig = '';
        this.#flashAt = new Map();
        this.#flashTimers = new Map();
    }

    #host;
    #root;
    #els;
    #stickBottom;
    #lastLogId;
    #mounted;
    #providerSig;
    #adapterSig;
    #flashAt;
    #flashTimers;

    /** @param {'auto' | HTMLElement} [target] */
    mount(target = 'auto') {
        if (typeof document === 'undefined') return this;
        const node = target === 'auto' || !target ? document.body : target;
        if (!node) {
            document.addEventListener('DOMContentLoaded', () => this.mount(target), { once: true });
            return this;
        }
        if (this.#mounted) this.unmount();

        if (typeof customElements !== 'undefined' && !customElements.get(HOST_TAG)) {
            customElements.define(HOST_TAG, class extends HTMLElement {});
        }

        this.#host = document.createElement(HOST_TAG);
        this.#root = this.#host.attachShadow({ mode: 'open' });
        this.#root.innerHTML = `
            <style>${STYLES}</style>
            <div class="bl-root" data-visible="true">
              <div class="bl-panel">
                <div class="bl-scan"></div>
                <div class="bl-head">
                  <span class="bl-mark" aria-hidden="true"></span>
                  <span class="bl-title">BEE LADYBUG</span>
                  <span class="bl-badge">CORE</span>
                  <span class="bl-mode-wrap">
                    <span class="bl-mode" data-el="mode">LIVE</span>
                    <button class="bl-info" type="button" aria-describedby="bl-freeze-tip" aria-label="Freeze stops the simulated clock, not this overlay">
                      <span aria-hidden="true">ⓘ</span>
                      <span class="bl-info-tip" id="bl-freeze-tip">Freeze does not stop this overlay. It only stops the simulated clock. Adapters must listen for the sys event (op: freeze).</span>
                    </button>
                  </span>
                </div>
                <div class="bl-stats">
                  <div>HOST <b data-el="hostFps">—</b></div>
                  <div>CORE <b data-el="coreFps">—</b></div>
                  <div>FRAME <b data-el="frame">0</b></div>
                  <div>SIM <b data-el="sim">00:00.0</b></div>
                </div>
                <div class="bl-graph-wrap">
                  <canvas class="bl-graph" data-el="graph" width="336" height="52"></canvas>
                  <div class="bl-graph-label">
                    <span data-el="graphName">HISTORY</span>
                    <span data-el="graphStats">min —  max —</span>
                  </div>
                </div>
                <div class="bl-hud" data-el="hud"></div>
                <div class="bl-console" data-el="console" role="log" aria-live="polite"></div>
                <div class="bl-foot">
                  <button class="bl-btn" data-act="slow" type="button">F3 SLOW</button>
                  <button class="bl-btn" data-act="freeze" type="button">F4 STOP</button>
                  <button class="bl-btn" data-act="live" type="button">1x LIVE</button>
                  <button class="bl-btn" data-act="ask" type="button">ASK AI</button>
                  <span class="bl-providers" data-el="providers"></span>
                  <span class="bl-adapters" data-el="adapters"></span>
                  <span class="bl-hint">F2 overlay</span>
                </div>
              </div>
            </div>
        `;

        this.#els = {
            root: this.#root.querySelector('.bl-root'),
            mode: this.#root.querySelector('[data-el="mode"]'),
            hostFps: this.#root.querySelector('[data-el="hostFps"]'),
            coreFps: this.#root.querySelector('[data-el="coreFps"]'),
            frame: this.#root.querySelector('[data-el="frame"]'),
            sim: this.#root.querySelector('[data-el="sim"]'),
            graph: this.#root.querySelector('[data-el="graph"]'),
            graphName: this.#root.querySelector('[data-el="graphName"]'),
            graphStats: this.#root.querySelector('[data-el="graphStats"]'),
            hud: this.#root.querySelector('[data-el="hud"]'),
            console: this.#root.querySelector('[data-el="console"]'),
            providers: this.#root.querySelector('[data-el="providers"]'),
            adapters: this.#root.querySelector('[data-el="adapters"]')
        };

        this.#root.querySelector('.bl-foot').addEventListener('click', (event) => {
            const btn = event.target.closest('[data-act]');
            if (!btn) return;
            const act = btn.getAttribute('data-act');
            if (act === 'slow') this.core.applySlowMo();
            else if (act === 'freeze') this.core.toggleFreeze();
            else if (act === 'live') this.core.restoreRealtime();
            else if (act === 'ask') this.core.ask();
            else if (act === 'assist') this.core.setActiveAssistant(btn.getAttribute('data-name'));
            else if (act === 'adapter') this.core.toggleAdapter(btn.getAttribute('data-name'));
        });

        this.#els.console.addEventListener('scroll', () => {
            const el = this.#els.console;
            this.#stickBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        });

        node.appendChild(this.#host);
        this.#mounted = true;
        this.setVisible(this.core.visible);
        this.#replayLogs();
        this.render();
        return this;
    }

    unmount() {
        if (this.#host?.parentNode) this.#host.parentNode.removeChild(this.#host);
        this.#host = null;
        this.#root = null;
        this.#els = null;
        this.#mounted = false;
        this.#providerSig = '';
        this.#adapterSig = '';
        this.#clearFlashTimers();
        this.#flashAt.clear();
        return this;
    }

    destroy() {
        this.unmount();
        this.core = null;
        return this;
    }

    setVisible(visible) {
        if (!this.#els) return this;
        this.#els.root.dataset.visible = visible ? 'true' : 'false';
        return this;
    }

    onPacket(packet) {
        if (!this.#els || !packet) return;
        if (packet.type === 'sys') return;
        this.#flashAdapterButton(packet);
        if (packet.level || packet.type === 'log' || packet.type === 'warn' || packet.type === 'error') {
            this.#appendLine(packet);
        }
    }

    onClear(channel) {
        if (!this.#els) return;
        if (!channel || channel === 'logs') {
            this.#els.console.innerHTML = '';
            this.#lastLogId = 0;
        }
        if (!channel || channel === 'hud') this.#els.hud.innerHTML = '';
    }

    render() {
        if (!this.#els || !this.core) return;
        const state = this.core.getState();
        const host = this.core.getHistory('fps');
        const primary = this.core.getPrimaryHistory();

        this.#els.mode.textContent = state.mode;
        this.#els.mode.dataset.mode = state.mode;
        this.#els.hostFps.textContent = host.values.length ? host.last.toFixed(1) : '—';
        this.#els.coreFps.textContent = state.coreFps.toFixed(1);
        this.#els.frame.textContent = String(state.frameCount);
        this.#els.sim.textContent = formatSimTime(state.simTime);

        this.#paintGraph(primary);
        this.#renderHud(state.hud);
        this.#syncButtons(state);
        this.#syncProviders(state);
        this.#syncAdapters(state);

        if (this.#stickBottom) {
            this.#els.console.scrollTop = this.#els.console.scrollHeight;
        }
    }

    #replayLogs() {
        const logs = this.core.getLogs();
        for (let i = 0; i < logs.length; i++) this.#appendLine(logs[i]);
    }

    #appendLine(packet) {
        if (!this.#els || packet.id <= this.#lastLogId) return;
        this.#lastLogId = packet.id;
        const line = document.createElement('div');
        const level = packet.level || 'info';
        line.className = `bl-line ${level}`;
        const msg = packet.payload.message ?? packet.payload.value ?? packet.type;
        line.innerHTML = `<span class="t">${formatSimTime(packet.simTime)}</span><span class="s">${escapeHtml(packet.source)}</span><span class="m">${escapeHtml(String(msg))}</span>`;
        this.#els.console.appendChild(line);

        const max = this.core.maxLogs;
        while (this.#els.console.childElementCount > max) {
            this.#els.console.removeChild(this.#els.console.firstChild);
        }
    }

    #renderHud(hud) {
        const skip = new Set(['frame', 'sim', 'scale', 'fps']);
        const keys = Object.keys(hud).filter((k) => !skip.has(k));
        if (!keys.length) {
            this.#els.hud.innerHTML = `<span class="bl-k">idle</span><span class="bl-v">no adapter data</span>`;
            return;
        }
        let html = '';
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const entry = hud[key];
            const unit = entry.unit ? ` ${entry.unit}` : '';
            html += `<span class="bl-k">${escapeHtml(key)}</span><span class="bl-v">${escapeHtml(fmtHud(entry.value))}${escapeHtml(unit)}</span>`;
        }
        this.#els.hud.innerHTML = html;
    }

    #syncButtons(state) {
        const slow = this.#root.querySelector('[data-act="slow"]');
        const freeze = this.#root.querySelector('[data-act="freeze"]');
        const live = this.#root.querySelector('[data-act="live"]');
        freeze.dataset.hot = state.frozen ? 'true' : 'false';
        slow.dataset.hot = !state.frozen && state.timeScale !== 1 ? 'true' : 'false';
        live.dataset.hot = !state.frozen && state.timeScale === 1 ? 'true' : 'false';
        const ask = this.#root.querySelector('[data-act="ask"]');
        if (ask) {
            ask.dataset.hot = this.core.hasAssistant ? 'true' : 'false';
            ask.disabled = Boolean(this.core.assistantBusy);
        }
    }

    #syncProviders(state) {
        const wrap = this.#els.providers;
        if (!wrap) return;
        const names = Array.isArray(state.assistants) ? state.assistants : [];
        const active = state.assistant ?? '';
        const sig = `${names.join('\0')}\0${active}`;
        if (sig === this.#providerSig) return;
        this.#providerSig = sig;
        let html = '';
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            const hot = name === active ? 'true' : 'false';
            html += `<button class="bl-provider" data-act="assist" data-name="${escapeHtml(name)}" data-hot="${hot}" type="button" title="${escapeHtml(name)}">${escapeHtml(abbrevName(name))}</button>`;
        }
        wrap.innerHTML = html;
    }

    #syncAdapters(state) {
        const wrap = this.#els.adapters;
        if (!wrap) return;
        const list = Array.isArray(state.adapters) ? state.adapters : [];
        const sig = list.map((entry) => `${entry.name}\0${entry.label}\0${entry.enabled ? 1 : 0}`).join('\n');
        if (sig === this.#adapterSig) return;
        this.#adapterSig = sig;
        let html = '';
        for (let i = 0; i < list.length; i++) {
            const entry = list[i];
            const hot = entry.enabled ? 'true' : 'false';
            html += `<button class="bl-adapter" data-act="adapter" data-name="${escapeHtml(entry.name)}" data-hot="${hot}" type="button" title="${escapeHtml(entry.label)}">${escapeHtml(entry.label)}</button>`;
        }
        wrap.innerHTML = html;
    }

    #flashAdapterButton(packet) {
        if (packet.type !== 'warn' && packet.type !== 'telemetry') return;
        const wrap = this.#els.adapters;
        if (!wrap || !this.core || typeof this.core.getAdapters !== 'function') return;
        const name = packet.source;
        if (!this.core.getAdapters().some((entry) => entry.name === name)) return;

        const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
            ? CSS.escape(name)
            : name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const btn = wrap.querySelector(`[data-name="${escaped}"]`);
        if (!btn) return;

        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const last = this.#flashAt.get(name) ?? 0;
        if (now - last < 1500) return;
        this.#flashAt.set(name, now);

        btn.dataset.flash = 'false';
        void btn.offsetWidth;
        btn.dataset.flash = 'true';

        const prev = this.#flashTimers.get(name);
        if (prev && typeof clearTimeout === 'function') clearTimeout(prev);
        if (typeof setTimeout !== 'function') return;
        const timer = setTimeout(() => {
            this.#flashTimers.delete(name);
            if (btn.dataset.flash === 'true') btn.dataset.flash = 'false';
        }, 560);
        this.#flashTimers.set(name, timer);
    }

    #clearFlashTimers() {
        if (typeof clearTimeout !== 'function') {
            this.#flashTimers.clear();
            return;
        }
        for (const timer of this.#flashTimers.values()) clearTimeout(timer);
        this.#flashTimers.clear();
    }

    #paintGraph(series) {
        const canvas = this.#els.graph;
        const ctx = canvas.getContext('2d');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cssW = canvas.clientWidth || 336;
        const cssH = canvas.clientHeight || 52;
        const pixelW = Math.round(cssW * dpr);
        const pixelH = Math.round(cssH * dpr);
        if (canvas.width !== pixelW || canvas.height !== pixelH) {
            canvas.width = pixelW;
            canvas.height = pixelH;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const w = cssW;
        const h = cssH;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#05060a';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(255, 211, 106, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, Math.floor(h / 2) + 0.5);
        ctx.lineTo(w, Math.floor(h / 2) + 0.5);
        ctx.stroke();

        const values = series.values;
        this.#els.graphName.textContent = (series.name || 'HISTORY').toUpperCase();
        if (!values.length) {
            this.#els.graphStats.textContent = 'min —  max —';
            return;
        }

        const min = series.min;
        const max = series.max;
        const span = max - min || 1;
        ctx.beginPath();
        for (let i = 0; i < values.length; i++) {
            const x = (i / Math.max(values.length - 1, 1)) * (w - 2) + 1;
            const y = h - 3 - ((values[i] - min) / span) * (h - 6);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = '#ff3b4e';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        this.#els.graphStats.textContent = `min ${min.toFixed(1)}  max ${max.toFixed(1)}  avg ${series.avg.toFixed(1)}`;
    }
}

function abbrevName(name) {
    const s = String(name || '?');
    return s.slice(0, 2).toUpperCase();
}

function fmtHud(value) {
    if (value == null) return '—';
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
