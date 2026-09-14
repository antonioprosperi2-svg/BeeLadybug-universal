/**
 * Vendor-agnostic AI hook. BeeLadybug never ships an API key or a model:
 * the host app injects complete({ question, snapshot }).
 */

const SECRET_KEY = /key|token|secret|password|authorization|cookie|apikey/i;

/**
 * @param {import('./BeeLadybugCore.js').BeeLadybugCore} core
 * @param {string} question
 */
export function buildAssistantSnapshot(core, question) {
    const logs = core.getLogs().slice(-40).map((packet) => ({
        type: packet.type,
        level: packet.level,
        source: packet.source,
        message: String(packet.payload?.message ?? packet.payload?.value ?? packet.type),
        frame: packet.frame
    }));
    const history = core.getPrimaryHistory();
    return {
        question: String(question || ''),
        version: core.version,
        state: core.getState(),
        hud: scrub(core.getHud()),
        logs,
        history: {
            name: history.name,
            min: history.min,
            max: history.max,
            avg: history.avg,
            last: history.last,
            samples: history.values.slice(-24)
        }
    };
}

export function normalizeAssistant(provider) {
    if (!provider || typeof provider.complete !== 'function') return null;
    const name = typeof provider.name === 'string' && provider.name
        ? provider.name
        : 'custom';
    return { name, complete: provider.complete.bind(provider) };
}

function scrub(value, depth = 0) {
    if (value == null || typeof value !== 'object') {
        if (typeof value === 'string' && value.length > 400) return `${value.slice(0, 400)}…`;
        return value;
    }
    if (depth > 4) return '[…]';
    if (Array.isArray(value)) {
        return value.slice(0, 24).map((item) => scrub(item, depth + 1));
    }
    const out = {};
    for (const key of Object.keys(value)) {
        out[key] = SECRET_KEY.test(key) ? '[redacted]' : scrub(value[key], depth + 1);
    }
    return out;
}
