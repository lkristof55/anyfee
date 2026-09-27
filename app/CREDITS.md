# Credits

## Fonts (vendored in `public/fonts/`, latin subsets from Google Fonts)

| Face | Use | License |
|---|---|---|
| Public Sans (USWDS), variable 300–800 | text | SIL Open Font License 1.1 |
| IBM Plex Mono (IBM), 400 and 500 | addresses, ids, code, labels | SIL Open Font License 1.1 |

## Libraries bundled into the site

three.js (MIT), @solana/web3.js (MIT), @wallet-standard/app (Apache-2.0), @noble/curves and
@noble/hashes (MIT), bs58 (MIT), buffer (MIT). esbuild writes their license comments next to the
bundles (`dist/assets/*.LEGAL.txt`).

## Diagrams

Every diagram is procedural (`src/diagrams/`): boxes, discs and lines from three.js primitives
with flat materials, and the same scenes drawn as static SVG. No downloaded models. The GitHub
and X marks on the proof plates are simple stroke glyphs drawn for this site (a git branch and an
X), not the platforms' logos. `public/og.png`, `favicon.png` and `apple-touch-icon.png` are
rendered from the site itself by `scripts/render-og.ts`.
