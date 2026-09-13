# BeeLadybug

Universal telemetry and visual inspection overlay.

BeeLadybug is **not** a Canvas widget. It is a small open-source debugger
core that accepts raw packets from any source — Canvas 2D games, DOM pages,
headless bots, Python processes, AI pipelines — and renders them in one
dark console.

> Il Core non sa cosa sta monitorando. Riceve solo dati grezzi.

## Perché questa struttura

Il file storico `BeeLadybug` era accoppiato a un engine di gioco (entità,
hitbox, `ctx.drawOverlay`). Quello non scala a un sito HTML o a un modello
Python. Per questo il progetto riparte da zero con due strati:

| Strato | Responsabilità |
| --- | --- |
| `src/core/` | Orologio fittizio, buffer, grafici, overlay cyberpunk |
| `src/adapters/` | Traduttori. Convertono un mondo specifico in `sendData()` |

L'overlay **non** è disegnato sul Canvas. È un pannello HTML in Shadow DOM:
funziona sopra un gioco, sopra una pagina, o da solo in una sandbox.

```
bee-ladybug/
├── src/
│   ├── index.js                 # API pubblica
│   ├── core/
│   │   ├── BeeLadybugCore.js    # stato, clock, sendData
│   │   └── UIOverlay.js         # console scura + sparkline
│   └── adapters/
│       ├── CanvasAdapter.js     # hitbox / FPS / collisioni Canvas 2D
│       ├── WebDOMAdapter.js     # box model / hover / mutazioni HTML
│       └── python/
│           └── PythonBridge.js  # futuro: WebSocket → sendData
├── examples/
│   ├── core-sandbox.js          # demo senza adapter
│   ├── core.html
│   ├── canvas-sandbox.js        # demo CanvasAdapter
│   ├── dom-sandbox.js
│   └── dom.html
├── index.html
├── package.json
└── README.md
```

## Quick start

Servire la cartella con un server statico (i moduli ES non partono da `file://`):

```bash
python -m http.server 8080
```

Aprire `http://localhost:8080`. Premere `F2` / `F3` / `F4`. In console:

```js
bee.sendData('log', { source: 'human', message: 'hello core' })
bee.sendData('fps', { value: 61 })
bee.sendData('error', { source: 'ai', message: 'timeout' })
```

Uso minimo in un'app:

```js
import { BeeLadybugCore } from './src/index.js';

const bee = new BeeLadybugCore();
bee.sendData('log', { message: 'boot', source: 'app' });
```

Core headless (bot, test, Node con DOM assente):

```js
const bee = new BeeLadybugCore({ ui: false, mount: false, autoAttach: false });
bee.sendData('metric', { name: 'loss', value: 0.12 });
```

## Contratto `sendData(type, payload)`

Gli adapter parlano **solo** così. Uno scalare viene avvolto in `{ value }`.

| `type` | `payload` | Effetto |
| --- | --- | --- |
| `fps` | `{ value }` | HUD + grafico storico |
| `metric` | `{ name, value, unit? }` | HUD + serie storica |
| `coord` | `{ label?, x, y }` | HUD |
| `state` | `{ key, value }` | HUD |
| `log` | `{ message, level?, source? }` | console |
| `warn` | `{ message, source? }` | console ambra |
| `error` | `{ message, source? }` | console rossa |
| `clear` | `{ channel?: 'logs'\|'history'\|'hud' }` | reset buffer |
| `sys` | emesso dal Core | freeze / visibilità / scala |

Ogni pacchetto viene stampato con:

- `wallTime` — orologio reale
- `simTime` — tempo fittizio del Core
- `frame` — frame-count indipendente dall'host

Il freeze **non** ferma l'overlay. Ferma solo il clock fittizio. Gli adapter
possono ascoltare `type: 'sys'` e mettere in pausa il loro mondo.

```js
bee.subscribe((packet) => {
  if (packet.type === 'sys' && packet.payload.op === 'freeze') {
    host.paused = packet.payload.frozen;
  }
});
```

## Tasti

| Tasto | Azione |
| --- | --- |
| `F2` | mostra / nascondi overlay (e hitbox canvas) |
| `F3` | slow-motion del tempo fittizio (`0.25x` / `1x`) |
| `F4` | freeze / run del tempo fittizio |

Niente `F12`, niente tilde: sui layout italiani la tilde non è un tasto unico.

## CanvasAdapter

```js
import { BeeLadybugCore, CanvasAdapter } from './src/index.js';

const bee = new BeeLadybugCore();
const adapter = new CanvasAdapter(bee, {
  canvas,                 // HTMLCanvasElement del gioco
  entities,               // array di AABB, tenuto per riferimento
  overlay: true,          // hitbox su canvas stacked (default)
  computeCollisions: true
});
adapter.attach();

function loop() {
  if (!adapter.frozen) updateGame(adapter.timeScale);
  drawGame();
  adapter.pump();           // una volta per frame host
  requestAnimationFrame(loop);
}
```

L'adapter accetta oggetti qualsiasi con `x/y/width/height` (o `worldX/worldY`).
Disegna le hitbox su un canvas trasparente sopra il gioco: verde = ok, rosso = collide.
Espone `frozen` e `timeScale` così l'host può mettere in pausa la simulazione.
Pacchetti: `fps`, `metric entities`, `metric hits`, `coord` del player, `warn` all'ingresso collisione.

## WebDOMAdapter

```js
import { BeeLadybugCore, WebDOMAdapter } from './src/index.js';

const bee = new BeeLadybugCore();
const adapter = new WebDOMAdapter(bee, {
  root: document.body,     // sottoalbero da ispezionare
  watch: ['.card', '#cta'],
  overlay: true,
  autoTick: true           // non serve un game loop
});
adapter.attach();
```

Traduce il DOM in pacchetti: nodo sotto il puntatore, box model (margin / padding / content), conteggio nodi, mutazioni (`+n -n attr`). `F4` congela l'hover. `F2` nasconde overlay e highlight. Il Core non sa che esiste HTML.

## API Core

```js
const bee = new BeeLadybugCore({
  toggleKey: 'F2',
  slowKey: 'F3',
  freezeKey: 'F4',
  slowScale: 0.25,
  maxLogs: 250,
  historySize: 120,
  mount: 'auto',   // document.body, HTMLElement, o false
  ui: true,
  autoAttach: true,
  autoStart: true
});

bee.sendData(type, payload);
bee.subscribe(handler);          // ritorna unsubscribe
bee.getState();
bee.getLogs();
bee.getHistory('fps');
bee.getHud();
bee.show(); bee.hide(); bee.toggle();
bee.freeze(); bee.unfreeze(); bee.toggleFreeze();
bee.applySlowMo(); bee.restoreRealtime();
bee.destroy();
```

## Roadmap

1. **Ora** — Core + overlay + CanvasAdapter + WebDOMAdapter. Fatto.
2. **PythonBridge** — WebSocket JSON `{ type, payload }` verso `sendData`.
3. **Pacchetto npm** — `import { BeeLadybugCore } from 'bee-ladybug'`.

## Come contribuire

Il Core resta cieco. Se una feature ha bisogno di conoscere Canvas, DOM o
Python, vive in un adapter. Patch al Core solo per clock, buffer, protocollo
o UI condivisa.

