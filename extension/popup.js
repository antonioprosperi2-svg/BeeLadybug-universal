const status = document.getElementById('status');
const toggle = document.getElementById('toggle');

const BLOCKED = 'Questa pagina non si può ispezionare (chrome://, Chrome Web Store o un\'altra pagina protetta). Aprilo su un sito normale.';

function blockedUrl(url) {
    if (!url) return false;
    if (/^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url)) return true;
    try {
        const host = new URL(url).hostname;
        return host === 'chrome.google.com' || host === 'chromewebstore.google.com';
    } catch {
        return false;
    }
}

toggle.addEventListener('click', async () => {
    status.textContent = '';
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
            status.textContent = 'Nessuna scheda attiva.';
            return;
        }
        if (blockedUrl(tab.url)) {
            status.textContent = BLOCKED;
            return;
        }
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js'],
            world: 'MAIN'
        });
    } catch (error) {
        console.error(error);
        status.textContent = error && error.message ? error.message : String(error);
    }
});
