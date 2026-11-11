# Changelog
<p align="center">
  <img src="https://beeenginejs.com/wp-content/uploads/2026/10/beeladybug-logo-animato-ezgif.com-effects.gif" alt="BeeEngine Logo" width="900" />
</p>
## 0.6.4

- CSS hunt: Ctrl, Cmd and Alt combinations (Ctrl+S, Cmd+S, Ctrl+P) reach the browser. While the overlay is hidden (F2) the hunt ignores keys and pointer, and its hover and pin boxes disappear with it.
- No inspection at (0,0) before the first mouse move.
- `scan()`, hover and pin skip hidden nodes, the WordPress admin bar, and blockers or stacking ancestors that belong to it, like the report does.
- Colors in modern syntax (`oklch()`, `lab()`, `color()`, `color-mix()`) are no longer reported as transparent text. Only a truly transparent color is.
- Disabled stylesheets and stylesheets whose `media` does not match are skipped when looking for `!important`.
- The report keeps every error: `MAX_SNAPSHOT` applies after the severity sort, so `will-change` hints cannot push a stacking error out.
- A stylesheet mutation is detected from the nodes added or removed, not from the whole subtree of the target.
- HUD states `css.target`, `css.hits` and `css.pin` reset when the hunt turns off, and `css.hits` resets when the pointer leaves every node.
- `cssPath` escapes ids and class names.
- `WebDOMAdapter`, `AntAdapter` and the report recognise the hunt boxes (`data-bee-ladybug-css`) as BeeLadybug chrome.

## 0.6.3

- `WebDOMAdapter.setRoot()` disconnects the old observer, creates one when the adapter started with `root: null`, and clears `hover` when it falls outside the new root. `setRoot(null)` stops observing.
- While the DOM button is off, mutations are not queued and no `mutate` warn or `mutations` metric is sent. Turning it off also cancels a pending flush.
- `detach()` resets hover, FPS and mutation counters, so a later `attach()` starts clean. The overlay of a re-attached adapter is visible again.
- The overlay resizes its bitmap and updates its style only when a value changes.
- The HUD `display` state returns to `—` when the hover leaves a node.
- `domNoiseQuiet` is exported from the package index and typed in `index.d.ts`.

## 0.6.2

- `CanvasAdapter`: "left collision" prints the entity name, also for entities with an `id` and names that contain `:`.
- The hitbox overlay mounts only when a host canvas exists. Without one, `attach()` emits a single `warn` and `pump()` draws nothing while telemetry keeps running. `setCanvas(null)` unmounts the overlay.
- The overlay resizes its bitmap and updates its style only when a value changes.
- `detach()` resets collision state, FPS samples and timing, so a later `attach()` starts clean.
- New `stopAutoPump()` stops the internal loop and makes a manual `pump()` valid again.

## 0.6.1

- Identical report rows (selector, rule and value) collapse to one line with a `×N` count. Repeated errors count once in the summary.
- The summary counts CORE · LOG as well as adapter rows. Severity `warm` is stored as `warn`.
- Every descendant of `#wpadminbar` stays out of the report, including `span.ab-icon`. Hitbox coordinates are rounded to one decimal.
- The downloaded file is already named `report-YYYYMMDD-HHMM.html`.

## 0.6.0

- F8 and the overlay button **F8 EXPORT** download an HTML telemetry report. `exportReport()` also returns JSON and CSV.
- Attached adapters add their own rows: canvas hitboxes and FPS, DOM layout, CSS hunt, hot mutation nodes, long tasks, slow resources, and the latest Python metrics.
- A headless core returns the report and does not download a file.

## 0.5.4

- CSS hunt walks ancestors and groups stacking contexts by cause, for example `div.hero creates stacking context (transform) - z-index of 3 children is trapped`. Idea from Rishabh Mishra.
- `will-change: transform` or `opacity` is a grey info hint with a z-index note on the same line, not a red bug.

## 0.5.3

- Issues group by cause: one red line such as `body::after blocks clicks on 10 elements`, expanded on click.
- An unreadable stylesheet is a single grey info line per sheet. It is not repeated on every element and it is not a bug.
- The overlay stays within 50vh and scrolls inside. Status, Issues, Inspect and Events collapse. Issues opens with a red/grey legend.

## 0.5.2

- Distorted images compare the file ratio with the rendered box from `getBoundingClientRect`, only when computed `object-fit` is `fill`.
- While CSS hunt is on, DOM hover and attribute-mutation lines stay out of the event list unless F3 SLOW is on. Each CSS issue is logged once per element every 5 seconds.
- `P` pins the inspector on the current element. Click-blocked and overflow causes stay in an Issues list (max 10, newest first) that does not scroll with the console.

## 0.5.1

- CSS scan keeps the element that causes a viewport overflow. Ancestors that only echo a descendant (±2px), or whose own width fits, are skipped.
- Duplicate scan rows collapse to one line with a count (`article overflows viewport ×4`) and sort by severity: overflow, click blocker, invisible text, distorted image, `!important`.
- A clean hover or a clean scan stays out of the event list unless F3 SLOW is on.

## 0.5.0

- CSS hunt (`F6`): `CSSAdapter` flags `!important` rules, viewport overflow, negative margins, invisible text, click blockers (including fixed `html`/`body` pseudos) and images distorted by `object-fit: fill`.
- `S` while hunt is on scans the page and lists the top offenders. Click a row in the overlay to draw a red outline.
- Stylesheet rules are cached and rebuilt only when a `<style>` or `<link>` changes.
- Demo: `examples/css-hunt.html`.
