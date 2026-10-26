# Changelog
<p align="center">
  <img src="https://beeenginejs.com/wp-content/uploads/2026/10/beeladybug-logo-animato-ezgif.com-effects.gif" alt="BeeEngine Logo" width="900" />
</p>
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
