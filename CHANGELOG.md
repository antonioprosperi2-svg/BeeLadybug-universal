# Changelog

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
