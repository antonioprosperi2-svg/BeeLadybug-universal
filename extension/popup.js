export const BLOCKED = 'Questa pagina non si può ispezionare (chrome://, Chrome Web Store o un\'altra pagina protetta). Aprilo su un sito normale.';

export function blockedUrl(url) {
    if (!url) return false;
    if (/^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url)) return true;
    try {
        const host = new URL(url).hostname;
        return host === 'chrome.google.com' || host === 'chromewebstore.google.com';
    } catch {
        return false;
    }
}

/**
 * Inject the HUD into the active tab, then close the popup.
 * Closing returns focus to the page, so Space cannot press this button again.
 * A blocked page or a failed injection leaves the popup open with the message.
 * @param {{ tabs: { query: Function }, scripting: { executeScript: Function } }} chromeApi
 * @param {() => void} close
 * @returns {Promise<string>} status text; empty when the popup is closing
 */
export async function onToggleClick(chromeApi, close) {
    const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return 'Nessuna scheda attiva.';
    if (blockedUrl(tab.url)) return BLOCKED;
    await chromeApi.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['entity-bridge.js'],
        world: 'MAIN'
    });
    await chromeApi.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
        world: 'MAIN'
    });
    close();
    return '';
}

if (typeof document !== 'undefined') {
    const status = document.getElementById('status');
    const toggle = document.getElementById('toggle');
    if (toggle) toggle.addEventListener('click', async () => {
        status.textContent = '';
        try {
            const message = await onToggleClick(chrome, () => window.close());
            if (message) status.textContent = message;
        } catch (error) {
            console.error(error);
            status.textContent = error && error.message ? error.message : String(error);
        }
    });
}
