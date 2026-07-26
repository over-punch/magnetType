# magnetType

[![npm](https://img.shields.io/npm/v/%40liiift-studio%2Fmagnettype.svg)](https://www.npmjs.com/package/@liiift-studio/magnettype) [![minzipped size](https://img.shields.io/bundlephobia/minzip/%40liiift-studio%2Fmagnettype)](https://bundlephobia.com/package/@liiift-studio/magnettype) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![part of liiift type-tools](https://img.shields.io/badge/liiift-type--tools-blueviolet)](https://github.com/Liiift-Studio/type-tools)

**Type that responds to your cursor.** As the cursor sweeps across the text, each word — or each character — pulls toward a heavier weight, then settles back as it passes. CSS `font-variation-settings` applies a single value to the whole element, with no native way to drive axis values per word from cursor proximity, to selectively widen visually confusable characters for legibility, or to vary weight per-character across a block element. magnetType adds all three.

![magnetType word mode: the words nearest the cursor swell toward a bold weight, fading back to light at the edges](https://raw.githubusercontent.com/Liiift-Studio/magnetType/master/assets/hero.gif?v=1)

**[Try the live demo at magnettype.com →](https://magnettype.com)** · [npm](https://www.npmjs.com/package/@liiift-studio/magnettype) · [GitHub](https://github.com/Liiift-Studio/magnetType)

TypeScript · Zero dependencies (~6 kB gzipped) · React + Vanilla JS

---

## Install

```bash
npm install @liiift-studio/magnettype
```

> **Variable font required:** magnetType sets `font-variation-settings` per word or per character. The target font must support the axes you specify (e.g. a font with a `wght` axis for weight-based effects, or a `wdth` axis for legibility mode). The effect is invisible with non-variable fonts.

**Axis jargon, decoded:** variable fonts expose adjustable *axes*, each a four-letter tag. `wght` is **weight** (boldness), `wdth` is **width**, `opsz` is **optical size**. An axis range like `[300, 700]` means "interpolate from 300 (light) up to 700 (bold)" as the cursor approaches. magnetType drives these axes live; CSS can only set them once.

**Compatibility:** ~6 kB gzipped, zero runtime dependencies. React 17+ is an optional peer dependency — the core algorithm and vanilla-JS API run with no framework. Requires a browser that supports variable fonts and `font-variation-settings` (all evergreen browsers; Chrome/Edge 62+, Firefox 62+, Safari 11+). On touch devices with no cursor, field and character modes have no pointer to track; legibility mode applies its boost statically.

---

## Complete example (copy-paste, runs as-is)

The examples below assume a loaded variable font with a `wght` axis. Here is a full setup — load the font, point `font-family` at it, then wrap your text:

```tsx
import { MagnetTypeText } from '@liiift-studio/magnettype'

// 1. Load a variable font (any font with a `wght` axis works — Inter, Recursive,
//    Roboto Flex, Source Serif…). Put this in your global CSS:
//
//    @font-face {
//      font-family: 'Recursive';
//      src: url('/fonts/Recursive_VF.woff2') format('woff2');
//      font-weight: 300 1000;   /* declare the supported wght range */
//    }

export default function Hero() {
  return (
    <MagnetTypeText
      mode="word"
      axes={{ wght: [300, 800] }}   // light → bold as the cursor nears each word
      radius={150}                   // px from the cursor at which the pull begins
      falloff="quadratic"
      style={{ fontFamily: 'Recursive, sans-serif', fontSize: '2rem' }}
    >
      Type that responds to presence.
    </MagnetTypeText>
  )
}
```

> Without a `font-family` resolving to a variable font, the effect is silently invisible — the markup is correct but the glyphs cannot change weight. This is the most common first-run gotcha.

### Word mode vs character mode

| | Word mode (`MagnetTypeText mode="word"`) | Character mode (`MagnetChar`) |
|---|---|---|
| Unit affected | whole words | individual characters |
| Visual | ![word mode still](https://raw.githubusercontent.com/Liiift-Studio/magnetType/master/assets/word.png?v=1) | ![character mode still](https://raw.githubusercontent.com/Liiift-Studio/magnetType/master/assets/char.png?v=1) |
| Driven by | a continuous `requestAnimationFrame` loop | passive, batched per-frame on `mousemove` / `scroll` |
| Mixed inline content (links, `<code>`) | — | yes |

---

## Usage

### React — field mode (`MagnetTypeText`)

Per-word cursor-proximity weight variation driven by a continuous rAF loop.

```tsx
import { MagnetTypeText } from '@liiift-studio/magnettype'

<MagnetTypeText
  mode="word"
  axes={{ wght: [300, 700] }}
  radius={150}
  falloff="quadratic"
  magnetMode="attract"
>
  Your paragraph text here...
</MagnetTypeText>
```

### React — block mode (`MagnetChar`)

Per-character cursor-proximity weight variation. Works with mixed content (inline elements, links, `<code>`, etc.) inside any block element. Characters are wrapped as React elements — no DOM mutation.

```tsx
import { MagnetChar } from '@liiift-studio/magnettype'

// Per-character spread — each character responds to cursor distance
<MagnetChar
  spreadRadius={200}
  minWeight={300}
  maxWeight={700}
>
  Typography that responds to presence.
</MagnetChar>

// Whole-element gate — the effect only activates when the cursor is within proximityRadius of the element edge
<MagnetChar
  proximityRadius={120}
  minWeight={300}
  maxWeight={700}
>
  Weight rises when the cursor enters.
</MagnetChar>

// Both combined — proximity gates the spread effect
<MagnetChar
  proximityRadius={200}
  spreadRadius={120}
  minWeight={300}
  maxWeight={700}
>
  Only spreads when the cursor is close.
</MagnetChar>
```

**`MagnetChar` props:**

| Prop | Default | Description |
|------|---------|-------------|
| `as` | `'p'` | HTML element to render — `'h1'`, `'div'`, `'span'`, etc. |
| `minWeight` | `300` | `wght` axis value at rest (cursor beyond any radius) |
| `maxWeight` | `600` | `wght` axis value at peak (cursor directly over the character) |
| `spreadRadius` | — | Pixel distance from the cursor within which each **character's** weight rises to `maxWeight`. When omitted, per-character splitting is skipped |
| `proximityRadius` | — | Pixel distance from the element **edge** that gates the effect. Without `spreadRadius`, drives a whole-element weight ramp. With `spreadRadius`, acts as an outer gate — the spread only fires while the cursor is within this distance |
| `fixedAxes` | `{}` | Additional axis values to hold constant in every `font-variation-settings` string (e.g. `{ opsz: 144 }`) |
| `stabilizeLayout` | `true` | Apply compensating letter-spacing to prevent text reflow as weight rises. Measures the element's width at rest and peak weight via an off-screen probe and applies proportional negative letter-spacing per character. Disable if you want natural bold spacing, or if your font expands glyphs very unevenly (compensation is a per-element average) |
| `cachePositions` | `true` | Cache character centre positions in page-relative coordinates, eliminating `getBoundingClientRect` calls on every `mousemove`. Rebuilt on resize and after fonts load. Disable if the element is inside a custom scroll container (`overflow: scroll` on a non-window element) |
| `rafThrottle` | `true` | Throttle proximity updates to one per animation frame (≈ 60 fps on most displays). Disable for lowest input latency on 120 Hz displays or very fast-moving effects |
| `className` | — | Forwarded to the root element |
| `style` | — | Merged with the root element's style; `fontVariationSettings` at `minWeight` is set as the base |

### React hook — field mode

```tsx
import { useMagnetType } from '@liiift-studio/magnettype'

const ref = useMagnetType({ mode: 'word', axes: { wght: [300, 700] }, radius: 150 })
return <p ref={ref}>{children}</p>
```

The hook starts the cursor-proximity rAF loop on mount and tears it down cleanly on unmount. After fonts load (`document.fonts.ready`), the hook re-runs to ensure measurements are taken on the loaded font. When `cachePositions` is true (the default), a `ResizeObserver` is attached to rebuild the position cache on resize.

### React — legibility mode

```tsx
import { MagnetTypeText } from '@liiift-studio/magnettype'

<MagnetTypeText mode="legibility" wdthBoost={8}>
  Visually confusable characters like il1I and 0O are subtly widened.
</MagnetTypeText>
```

### Vanilla JS — field mode

```ts
import { startMagnetType, removeMagnetType, getCleanHTML } from '@liiift-studio/magnettype'

const el = document.querySelector('p')
const original = getCleanHTML(el)
const opts = { mode: 'word', axes: { wght: [300, 700] }, radius: 150 }

let stop

function run() {
  if (stop) stop()
  stop = startMagnetType(el, original, opts)
}

document.fonts.ready.then(run)

// Later — cancel the loop and restore original markup:
// stop()
// removeMagnetType(el, original)
```

### Vanilla JS — legibility mode

```ts
import { applyMagnetType, removeMagnetType, getCleanHTML } from '@liiift-studio/magnettype'

const el = document.querySelector('p')
const original = getCleanHTML(el)
const opts = { mode: 'legibility', wdthBoost: 8 }

// applyMagnetType returns a stop function and manages its own ResizeObserver internally —
// no need to wrap it in an external ResizeObserver.
let stop = applyMagnetType(el, original, opts)
document.fonts.ready.then(() => {
  stop()
  stop = applyMagnetType(el, original, opts)
})

// Later — stop the effect and restore original markup:
// stop()
// removeMagnetType(el, original)
```

### TypeScript

```ts
import type { MagnetTypeOptions, FalloffType, MagnetModeType, MagnetCharProps } from '@liiift-studio/magnettype'

const fieldOpts: MagnetTypeOptions = {
  mode: 'word',
  axes: { wght: [300, 700], wdth: [90, 110] },
  radius: 120,
  falloff: 'quadratic' as FalloffType,
  magnetMode: 'attract' as MagnetModeType,
}

const legibilityOpts: MagnetTypeOptions = {
  mode: 'legibility',
  wdthBoost: 6,
}
```

---

## Field mode options (`MagnetTypeText` / `useMagnetType` / vanilla JS)

| Option | Default | Description |
|--------|---------|-------------|
| `mode` | `'word'` | `'word'` (alias: `'field'`) — cursor proximity drives per-word `font-variation-settings` via a continuous rAF loop. `'legibility'` — cursor-driven per-character `wdth` boost on visually confusable characters |
| `axes` | `{ wght: [300, 500] }` | *(field mode)* Map of axis tag → `[restValue, peakValue]` |
| `radius` | `120` | Pixel radius over which the field effect fades from each word's centre (field mode) or each character's centre (legibility mode) |
| `falloff` | `'quadratic'` | `'linear'` or `'quadratic'` falloff curve |
| `magnetMode` | `'attract'` | *(field mode)* `'attract'` — near words approach `peakValue`. `'repel'` — near words stay at `restValue`, far words approach `peakValue` |
| `scope` | `'document'` | `'document'` — cursor events listened on the document, enabling cross-element effects. `'element'` — events restricted to the target element |
| `props` | `undefined` | Additional CSS effects driven by cursor proximity. `{ opacity: [rest, peak] }` fades words/chars; `{ italic: true }` toggles italic at strength > 0.5 |
| `wdthBoost` | `6` | *(legibility mode)* `wdth` units added to confusable characters, scaled by risk: `il1I` (risk 3) get the full boost; `r 0 O` (risk 2) get ⅔; `n m o b d p q c e` (risk 1) get ⅓ |
| `stabilizeLayout` | `true` | Apply compensating letter-spacing to keep line lengths stable as font weight changes. Disable for natural bold spacing |
| `cachePositions` | `true` | Cache word/character centre positions to avoid `getBoundingClientRect` on every `mousemove`. Disable if the element is inside a custom scroll container |
| `transitionMs` | `0` | Duration in ms for CSS transition back to rest when cursor leaves. `0` = instant snap. Cleared on the next `mousemove` so live tracking is not delayed |
| `as` | `'p'` | HTML element to render. *(React component only)* |

---

## How it works

### Field mode

On activation, magnetType wraps each word in an `mt-word` span. A `mousemove` listener records cursor coordinates, and a `requestAnimationFrame` loop runs while the cursor is inside the element. Each frame, the loop batch-reads every word span's `getBoundingClientRect`, computes Euclidean distance from cursor to word centre, and maps it through the falloff formula:

```
normalised = max(0, 1 − distance / radius)
strength   = normalised² (quadratic) or normalised (linear)
```

Each word's `font-variation-settings` interpolates between `restValue` and `peakValue` at that strength. Reads are batched before writes on every frame to avoid layout thrashing. When the cursor leaves, one final frame resets all words to `restValue`.

### Block mode (`MagnetChar`)

`MagnetChar` splits string children into per-character `<span>` elements during the React render pass using `useMemo` — no DOM mutation. Callback refs collect each span element. On `mousemove` (and on `scroll`, using the stored last position), the component reads each span's `getBoundingClientRect`, computes cursor-to-character-centre distance, and sets `font-variation-settings` directly on the span's style. This is passive and batched per frame via the event handler.

`proximityRadius` measures cursor distance to the element **edge** (not its centre) — useful as an outer gate so the effect only fires when the cursor is actually near the block. `spreadRadius` measures cursor distance to each **character centre** — controls how wide the weight gradient spreads around the cursor within the block. Both are independent and combinable.

### Legibility mode

magnetType scans text nodes recursively and checks each character against a built-in confusable character table. Confusable characters are wrapped in `mt-char` spans with a `wdth` boost proportional to risk level. Non-confusable characters pass through as plain text nodes.

### No layout shift

Field mode and block mode drive only `font-variation-settings` on per-word or per-character spans. If you use only a `wght` axis, advance widths are unaffected and no reflow occurs. If you include a `wdth` axis, character advance widths change and lines may reflow — consider constraining axis ranges or pairing with a `scaleX` transform.

### `prefers-reduced-motion`

All three modes respect `prefers-reduced-motion: reduce`. If the media query matches at activation time, field mode (`startMagnetType`) and legibility mode (`applyMagnetType`) return immediately — restoring the original markup without wrapping words/characters or starting the rAF loop — and block mode (`MagnetChar`) skips attaching its `mousemove`/`scroll` listeners, so the text renders statically at `minWeight`. No cursor-driven motion runs for users who have requested reduced motion.

---

## Dev notes

### `next` in root devDependencies

`package.json` at the repo root lists `next` as a devDependency. This is a **Vercel detection workaround** — not a real dependency of the npm package. Vercel's build system inspects the root `package.json` to detect the framework; without `next` present it falls back to a static build and skips the Next.js pipeline, breaking the `/site` subdirectory deploy.

The package itself has zero runtime dependencies. Do not remove this entry.

### README visuals

The images in this README are generated by a reproducible Playwright harness in `scripts/`. From the repo root, with `playwright` and `ffmpeg` available:

```bash
node scripts/capture.mjs   # writes assets/hero.gif, hero.png, word.png, char.png
```

The harness loads the variable font and reproduces the package's falloff math at frozen cursor positions, then assembles the sweep into a GIF. The `assets/` directory is not part of the published package (`files` ships `dist` only), so these images add nothing to the install size.

---

## Future improvements

- **Custom confusable table** — allow callers to pass their own `Record<string, number>` to override or extend the built-in character risk map
- **Axis clamping** — optional per-axis min/max clamp to prevent values from exceeding a font's supported range
- **SSR hydration** — pre-render legibility mode markup on the server so boosted characters are present from first paint

---

See the npm badge at the top of this file for the current published version.
