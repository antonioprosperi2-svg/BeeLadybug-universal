/**
 * Runs in the page (MAIN world). The HUD bundle only receives postMessage,
 * so it never reads the game's globals itself.
 * Contract: { source: 'bee-ladybug-entities', entities: object[] | null } every 100ms.
 */
(function startBeeLadybugEntityBridge() {
    var root = typeof globalThis !== 'undefined' ? globalThis : window;
    var KEY = '__BEE_LADYBUG_ENTITY_BRIDGE__';
    if (root[KEY]) return;

    var SOURCE = 'bee-ladybug-entities';
    var TEXT = ['name', 'id', 'label', 'role'];
    var NUMS = ['x', 'y', 'worldX', 'worldY', 'width', 'w', 'height', 'h'];

    function copyEntity(item) {
        if (!item || typeof item !== 'object') return null;
        var out = {};
        var i;
        for (i = 0; i < TEXT.length; i++) {
            var textKey = TEXT[i];
            var textValue = item[textKey];
            if (typeof textValue === 'string' || typeof textValue === 'number') out[textKey] = textValue;
        }
        for (i = 0; i < NUMS.length; i++) {
            var numKey = NUMS[i];
            var numValue = item[numKey];
            if (typeof numValue === 'number' && Number.isFinite(numValue)) out[numKey] = numValue;
        }
        if (typeof item.active === 'boolean') out.active = item.active;
        if (typeof item.colliding === 'boolean') out.colliding = item.colliding;
        if (item.primary === true) out.primary = true;
        return out;
    }

    function plainEntities(list) {
        if (!Array.isArray(list)) return null;
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var copy = copyEntity(list[i]);
            if (copy) out.push(copy);
        }
        return out;
    }

    function publish() {
        var entities = null;
        try {
            entities = plainEntities(root.__BEE_ENTITIES__);
        } catch {
            entities = null;
        }
        try {
            root.postMessage({ source: SOURCE, entities: entities }, '*');
        } catch {
            /* a bad payload must not kill the next tick */
        }
    }

    var timer = root.setInterval(publish, 100);
    root[KEY] = {
        stop: function stop() {
            root.clearInterval(timer);
            root[KEY] = undefined;
        }
    };
})();
