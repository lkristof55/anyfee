# Credits

## Fonts (vendored in `public/fonts/`, latin subsets from Google Fonts)

| Face | Use | License |
|---|---|---|
| Big Shoulders Display (Patric King, XXLG) | display, engraved box numbers | SIL Open Font License 1.1 |
| Public Sans (USWDS) | body | SIL Open Font License 1.1 |
| IBM Plex Mono (IBM) | addresses, ids, labels | SIL Open Font License 1.1 |

## Libraries bundled into the site

three.js (MIT), @solana/web3.js (MIT), @wallet-standard/app (Apache-2.0), @noble/curves and
@noble/hashes (MIT), bs58 (MIT), buffer (MIT). esbuild writes their license comments next to the
bundles (`dist/assets/*.LEGAL.txt`).

## 3D

Everything in the lobby wall is procedural (`src/wall/`): geometry from three.js primitives,
brass, glass, dial and engraving drawn to canvas textures at runtime. No downloaded models.
`public/og.png`, `favicon.png` and `apple-touch-icon.png` are rendered from the site itself by
`scripts/render-og.ts`.
