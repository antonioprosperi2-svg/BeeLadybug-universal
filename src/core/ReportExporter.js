/**
 * ReportExporter — turns a core snapshot into HTML, JSON, or CSV.
 *
 * No adapter imports. Attached modules are asked through the snapshot
 * hook stored by the core. A missing hook is skipped.
 */

const LATEST_TYPES = Object.freeze([
    'fps',
    'metric',
    'coord',
    'log',
    'warn',
    'error',
    'state',
    'sys',
    'telemetry'
]);

/**
 * @typedef {'html' | 'json' | 'csv'} ReportFormat
 * @typedef {'error' | 'warn' | 'ok'} ReportSeverity
 * @typedef {{ severity: ReportSeverity, selector: string, rule: string, value: string, source: string }} ReportItem
 */

/**
 * Build a report and, when the overlay is mounted, download it.
 * Headless cores (`ui: false`, or no document) return the value and do not download.
 *
 * JSON returns the plain object. HTML and CSV return strings.
 *
 * @param {object} core
 * @param {{ format?: ReportFormat }} [options]
 * @returns {object | string}
 */
export function exportReport(core, options = {}) {
    if (!core || typeof core.getState !== 'function' || typeof core.collectSnapshots !== 'function') {
        throw new TypeError('exportReport() needs a BeeLadybug core.');
    }

    const format = normalizeFormat(options.format);
    const report = buildReport(core);

    if (format === 'json') {
        saveIfMounted(core, report, 'json', 'application/json', JSON.stringify(report, null, 2));
        return report;
    }

    if (format === 'csv') {
        const text = renderCsv(report);
        saveIfMounted(core, report, 'csv', 'text/csv', text);
        return text;
    }

    const html = renderHtml(report);
    saveIfMounted(core, report, 'html', 'text/html', html);
    return html;
}

/**
 * Skip hidden boxes, the WordPress admin bar, and BeeLadybug's own chrome.
 * Adapters call this while they still have the element. The exported row does not.
 *
 * @param {object | null | undefined} node
 * @returns {boolean}
 */
export function isReportNoise(node) {
    if (!node || typeof node !== 'object') return false;
    const el = node.nodeType === 1 ? node : (node.parentElement || node);
    if (!el || typeof el !== 'object') return false;

    const seen = new Set();
    let current = el;
    while (current && typeof current === 'object') {
        if (seen.has(current)) break;
        seen.add(current);
        if (current.id === 'wpadminbar') return true;
        if (hasAbClass(current.className)) return true;
        if (current.tagName === 'BEE-LADYBUG-OVERLAY') return true;
        if (hasBeeAttribute(current)) return true;
        current = current.parentElement || null;
    }

    const style = readStyle(el);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;

    if (typeof el.getBoundingClientRect === 'function') {
        const rect = el.getBoundingClientRect();
        if (rect && (Number(rect.width) === 0 || Number(rect.height) === 0)) return true;
    }

    return false;
}

/**
 * @param {object} core
 */
function buildReport(core) {
    const state = core.getState();
    const generatedAt = new Date();
    const env = readEnvironment();
    const logs = readLogs(core);
    const series = readSeries(core);
    const latest = readLatest(core);
    const adapters = readAdapters(core);
    const summary = countFindings(adapters);

    return {
        version: state.version,
        generatedAt: generatedAt.toISOString(),
        fileStamp: fileStamp(generatedAt),
        url: env.url,
        viewport: env.viewport,
        clock: {
            wallTime: generatedAt.getTime(),
            simTime: state.simTime,
            frame: state.frameCount,
            frozen: state.frozen,
            timeScale: state.timeScale,
            coreFps: state.coreFps
        },
        summary,
        logs,
        series,
        latest,
        adapters
    };
}

/**
 * @param {object} core
 */
function readLogs(core) {
    const logs = typeof core.getLogs === 'function' ? core.getLogs() : [];
    return logs.map((packet) => ({
        type: packet.type,
        level: packet.level ?? null,
        source: packet.source,
        message: packetMessage(packet),
        wallTime: packet.wallTime,
        simTime: packet.simTime,
        frame: packet.frame
    }));
}

/**
 * FPS plus every metric name currently on the HUD.
 * @param {object} core
 */
function readSeries(core) {
    const names = new Set(['fps']);
    const hud = typeof core.getHud === 'function' ? core.getHud() : {};
    for (const [name, entry] of Object.entries(hud)) {
        if (entry && entry.type === 'metric') names.add(name);
    }

    const series = [];
    for (const name of names) {
        const history = core.getHistory(name);
        if (!history || !history.values || !history.values.length) continue;
        series.push({
            name: history.name,
            min: history.min,
            max: history.max,
            avg: history.avg,
            last: history.last,
            samples: history.values.slice()
        });
    }
    return series;
}

/**
 * @param {object} core
 */
function readLatest(core) {
    if (typeof core.getLatest !== 'function') return [];
    const packets = [];
    for (const type of LATEST_TYPES) {
        const packet = core.getLatest(type);
        if (!packet) continue;
        packets.push({
            id: packet.id,
            type: packet.type,
            payload: packet.payload,
            wallTime: packet.wallTime,
            simTime: packet.simTime,
            frame: packet.frame,
            source: packet.source,
            level: packet.level ?? null
        });
    }
    return packets;
}

/**
 * @param {object} core
 */
function readAdapters(core) {
    const raw = core.collectSnapshots();
    const sections = [];
    for (const entry of raw) {
        if (entry.error) {
            sections.push({
                name: entry.name,
                items: [makeItem({
                    severity: 'warn',
                    rule: 'snapshot',
                    value: entry.error,
                    source: entry.name
                })]
            });
            continue;
        }
        const result = entry.result;
        const name = result && typeof result.name === 'string' && result.name
            ? result.name
            : entry.name;
        const list = result && Array.isArray(result.items) ? result.items : [];
        sections.push({
            name,
            items: list.filter((row) => row && typeof row === 'object').map((row) => makeItem(row, name))
        });
    }
    return sections;
}

/**
 * @param {object} row
 * @param {string} [fallbackSource]
 * @returns {ReportItem}
 */
function makeItem(row, fallbackSource = '') {
    return {
        severity: normalizeSeverity(row.severity),
        selector: asText(row.selector),
        rule: asText(row.rule),
        value: asText(row.value),
        source: asText(row.source) || fallbackSource
    };
}

/**
 * @param {Array<{ items: ReportItem[] }>} adapters
 */
function countFindings(adapters) {
    const summary = { error: 0, warn: 0, ok: 0 };
    for (const section of adapters) {
        for (const item of section.items) summary[item.severity] += 1;
    }
    return summary;
}

/**
 * @param {string | undefined} format
 * @returns {ReportFormat}
 */
function normalizeFormat(format) {
    if (format === 'json' || format === 'csv' || format === 'html') return format;
    return 'html';
}

/**
 * @param {unknown} value
 * @returns {ReportSeverity}
 */
function normalizeSeverity(value) {
    const text = String(value || '').toLowerCase();
    if (text === 'error') return 'error';
    if (text === 'warn' || text === 'warning') return 'warn';
    return 'ok';
}

/**
 * @param {object} report
 */
function renderCsv(report) {
    const lines = ['adapter,severity,selector,rule,value,source'];
    for (const log of report.logs) {
        lines.push(csvRow([
            'core',
            logSeverity(log),
            '',
            log.type,
            log.message,
            log.source
        ]));
    }
    for (const series of report.series) {
        lines.push(csvRow([
            'core',
            'ok',
            '',
            series.name,
            `min ${formatNum(series.min)} / avg ${formatNum(series.avg)} / max ${formatNum(series.max)}`,
            'core'
        ]));
    }
    for (const section of report.adapters) {
        for (const item of section.items) {
            lines.push(csvRow([
                section.name,
                item.severity,
                item.selector,
                item.rule,
                item.value,
                item.source
            ]));
        }
    }
    return `${lines.join('\n')}\n`;
}

/**
 * @param {unknown[]} cells
 */
function csvRow(cells) {
    return cells.map(csvCell).join(',');
}

/**
 * @param {unknown} value
 */
function csvCell(value) {
    const text = value == null ? '' : String(value);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

/**
 * @param {{ type: string, level: string | null }} log
 * @returns {ReportSeverity}
 */
function logSeverity(log) {
    if (log.level === 'error' || log.type === 'error') return 'error';
    if (log.level === 'warn' || log.type === 'warn') return 'warn';
    return 'ok';
}

/**
 * @param {object} report
 */
function renderHtml(report) {
    const title = `BeeLadybug report ${report.fileStamp}`;
    const viewport = report.viewport
        ? `${report.viewport.width}×${report.viewport.height}`
        : 'n/a';
    const sections = report.adapters.map((section) => renderSection(section)).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #07080c;
    color: #f1f2f6;
    font: 14px/1.45 ui-monospace, Consolas, monospace;
  }
  main { max-width: 1100px; margin: 0 auto; padding: 28px 22px 64px; }
  h1 { margin: 0 0 8px; color: #ff3b4e; font-size: 22px; letter-spacing: 0.04em; }
  h2 { margin: 28px 0 10px; font-size: 13px; letter-spacing: 0.14em; color: #8b91a3; }
  .meta { color: #8b91a3; margin: 0 0 18px; }
  .counts { display: flex; gap: 10px; flex-wrap: wrap; margin: 0 0 8px; }
  .count { padding: 8px 12px; background: #101218; border: 1px solid #2a2e3a; }
  .count b { display: block; font-size: 20px; }
  .count.error b { color: #ff3b4e; }
  .count.warn b { color: #ffd36a; }
  .count.ok b { color: #3dd68c; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 8px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #2a2e3a; vertical-align: top; }
  th { color: #8b91a3; font-weight: 600; cursor: pointer; background: #101218; }
  tr.sev-error td { color: #ff8b96; }
  tr.sev-warn td { color: #ffd36a; }
  tr.sev-ok td { color: #d5d8e2; }
  td.sev { font-weight: 700; }
  tr.sev-error td.sev { color: #ff3b4e; }
  tr.sev-warn td.sev { color: #ffd36a; }
  tr.sev-ok td.sev { color: #3dd68c; }
  .empty { color: #8b91a3; }
  @media print {
    body { background: #07080c; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    main { max-width: none; padding: 0; }
    h2, table, .count { break-inside: avoid; }
    thead { display: table-header-group; }
    th { cursor: default; }
  }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">v${escapeHtml(report.version)} · ${escapeHtml(report.generatedAt)} · sim ${escapeHtml(formatSim(report.clock.simTime))} · frame ${escapeHtml(report.clock.frame)} · ${escapeHtml(report.clock.frozen ? 'FREEZE' : `${formatNum(report.clock.timeScale)}x`)}<br>
  ${escapeHtml(report.url || 'n/a')} · viewport ${escapeHtml(viewport)}</p>
  <div class="counts">
    <div class="count error"><b>${report.summary.error}</b>errors</div>
    <div class="count warn"><b>${report.summary.warn}</b>warnings</div>
    <div class="count ok"><b>${report.summary.ok}</b>ok</div>
  </div>
  <h2>CORE · LOG</h2>
  ${renderLogTable(report.logs)}
  <h2>CORE · SERIES</h2>
  ${renderSeriesTable(report.series)}
  ${sections || '<h2>ADAPTERS</h2><p class="empty">No attached module exposed a snapshot.</p>'}
</main>
<script>
document.querySelectorAll('table').forEach((table) => {
  table.querySelectorAll('thead th').forEach((th, index) => {
    th.addEventListener('click', () => {
      const body = table.tBodies[0];
      if (!body) return;
      const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
      table.querySelectorAll('thead th').forEach((other) => { delete other.dataset.dir; });
      th.dataset.dir = dir;
      const mul = dir === 'asc' ? 1 : -1;
      [...body.rows].sort((a, b) => {
        const av = a.cells[index] ? a.cells[index].textContent : '';
        const bv = b.cells[index] ? b.cells[index].textContent : '';
        const an = Number(av);
        const bn = Number(bv);
        if (av !== '' && bv !== '' && Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * mul;
        return av.localeCompare(bv) * mul;
      }).forEach((row) => body.appendChild(row));
    });
  });
});
</script>
</body>
</html>
`;
}

/**
 * @param {Array<{ type: string, level: string | null, source: string, message: string, simTime: number, frame: number }>} logs
 */
function renderLogTable(logs) {
    if (!logs.length) return '<p class="empty">No log lines.</p>';
    const rows = logs.map((log) => {
        const severity = logSeverity(log);
        return `<tr class="sev-${severity}"><td class="sev">${escapeHtml(severity)}</td><td>${escapeHtml(log.type)}</td><td>${escapeHtml(log.source)}</td><td>${escapeHtml(log.message)}</td><td>${escapeHtml(formatSim(log.simTime))}</td><td>${escapeHtml(log.frame)}</td></tr>`;
    }).join('');
    return `<table>
<thead><tr><th>severity</th><th>type</th><th>source</th><th>message</th><th>sim</th><th>frame</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

/**
 * @param {Array<{ name: string, min: number, avg: number, max: number, last: number, samples: number[] }>} series
 */
function renderSeriesTable(series) {
    if (!series.length) return '<p class="empty">No fps or metric samples.</p>';
    const rows = series.map((entry) => `<tr class="sev-ok"><td>${escapeHtml(entry.name)}</td><td>${escapeHtml(formatNum(entry.min))}</td><td>${escapeHtml(formatNum(entry.avg))}</td><td>${escapeHtml(formatNum(entry.max))}</td><td>${escapeHtml(formatNum(entry.last))}</td><td>${entry.samples.length}</td></tr>`).join('');
    return `<table>
<thead><tr><th>name</th><th>min</th><th>avg</th><th>max</th><th>last</th><th>samples</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

/**
 * @param {{ name: string, items: ReportItem[] }} section
 */
function renderSection(section) {
    const title = escapeHtml(section.name);
    if (!section.items.length) {
        return `<h2>${title}</h2><p class="empty">No rows.</p>`;
    }
    const rows = section.items.map((item) => `<tr class="sev-${item.severity}"><td class="sev">${escapeHtml(item.severity)}</td><td>${escapeHtml(item.selector)}</td><td>${escapeHtml(item.rule)}</td><td>${escapeHtml(item.value)}</td><td>${escapeHtml(item.source)}</td></tr>`).join('');
    return `<h2>${title}</h2>
<table>
<thead><tr><th>severity</th><th>selector</th><th>rule</th><th>value</th><th>source</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

/**
 * @param {object} core
 * @param {{ fileStamp: string }} report
 * @param {string} ext
 * @param {string} mime
 * @param {string} text
 */
function saveIfMounted(core, report, ext, mime, text) {
    if (!core.ui) return;
    if (typeof document === 'undefined' || !document.body) return;
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof Blob === 'undefined') return;

    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `report-${report.fileStamp}.${ext}`;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function readEnvironment() {
    if (typeof window === 'undefined' || typeof location === 'undefined') {
        return { url: '', viewport: null };
    }
    const width = Number(window.innerWidth);
    const height = Number(window.innerHeight);
    return {
        url: String(location.href || ''),
        viewport: Number.isFinite(width) && Number.isFinite(height)
            ? { width, height }
            : null
    };
}

/**
 * @param {object} packet
 */
function packetMessage(packet) {
    const payload = packet && packet.payload;
    if (!payload || typeof payload !== 'object') return '';
    if (typeof payload.message === 'string') return payload.message;
    if (payload.value != null) return String(payload.value);
    return '';
}

/**
 * @param {unknown} value
 */
function asText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * @param {number} value
 */
function formatNum(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    if (Number.isInteger(n)) return String(n);
    return String(Math.round(n * 100) / 100);
}

/**
 * @param {number} ms
 */
function formatSim(ms) {
    const total = Math.max(0, Number(ms) || 0) / 1000;
    const minutes = Math.floor(total / 60);
    const seconds = total - minutes * 60;
    return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}

/**
 * @param {Date} date
 */
function fileStamp(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * @param {unknown} value
 */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * @param {unknown} className
 */
function hasAbClass(className) {
    const raw = typeof className === 'string'
        ? className
        : (className && typeof className === 'object' && 'baseVal' in className
            ? String(className.baseVal)
            : '');
    return raw.split(/\s+/).some((token) => token.startsWith('ab-'));
}

/**
 * @param {object} el
 */
function hasBeeAttribute(el) {
    if (typeof el.hasAttribute !== 'function') return false;
    return el.hasAttribute('data-bee-ladybug-dom')
        || el.hasAttribute('data-bee-ladybug-canvas')
        || el.hasAttribute('data-bee-ladybug-css');
}

/**
 * @param {object} el
 */
function readStyle(el) {
    if (typeof getComputedStyle !== 'function') return null;
    try {
        return getComputedStyle(el);
    } catch {
        return null;
    }
}
