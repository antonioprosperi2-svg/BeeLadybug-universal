# Changelog

## 0.5.0

- CSS hunt (`F6`): `CSSAdapter` flags `!important` rules, viewport overflow, negative margins, invisible text, click blockers (including fixed `html`/`body` pseudos) and images distorted by `object-fit: fill`.
- `S` while hunt is on scans the page and lists the top offenders. Click a row in the overlay to draw a red outline.
- Stylesheet rules are cached and rebuilt only when a `<style>` or `<link>` changes.
- Demo: `examples/css-hunt.html`.
