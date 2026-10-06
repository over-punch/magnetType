// magnetType/src/core/types.ts — types and CSS class constants

/**
 * Known visually confusable characters with their risk level.
 * Risk 3 = high confusion (e.g. il1I), risk 1 = low confusion.
 */
export const CONFUSABLE: Record<string, number> = {
	'i': 3, 'l': 3, '1': 3, 'I': 3,  // il1I confusion
	'r': 2, 'n': 1, 'm': 1,           // rn/m similarity
	'0': 2, 'O': 2, 'o': 1,           // 0/O similarity
	'b': 1, 'd': 1, 'p': 1, 'q': 1,  // mirrored pairs
	'c': 1, 'e': 1,                    // similar bowls
}

/**
 * How legibility mode tells confusable characters apart at full cursor strength. Each value is a fraction
 * of an option: `wdth` of `wdthBoost` (negative narrows), `wght` of `wghtBoost`, `track` of `trackBoost`
 * (extra space after the character, used for `r` only when an `n` or `m` follows, so "rn" can't read as "m").
 * Members of the same confusion group get different treatments, so they stop looking alike:
 * `I` widens, `l` gets heavier, `1` gets heavier and a little wider, `i` slightly heavier; `0` narrows and
 * `O` widens. Characters not listed here are left alone.
 */
export const LEGIBILITY_TREATMENTS: Record<string, { wdth?: number; wght?: number; track?: number }> = {
	'I': { wdth: 1 },
	'l': { wght: 1 },
	'1': { wght: 1, wdth: 0.5 },
	'i': { wght: 0.5 },
	'0': { wdth: -1 },
	'O': { wdth: 1 },
	'r': { track: 1 },
}

/** Falloff curve for the cursor proximity field */
export type FalloffType = 'linear' | 'quadratic'

/** Whether cursor proximity attracts toward peak or repels toward rest */
export type MagnetModeType = 'attract' | 'repel'

/**
 * Which mode magnetType operates in.
 * 'field' is an alias for 'word' (both are accepted).
 */
export type MagnetTypeModeType = 'word' | 'field' | 'legibility'

/**
 * Scope for cursor event listeners.
 * 'document' enables cross-element / cross-paragraph effects (default).
 * 'element' restricts the field to the target element only.
 */
export type ScopeType = 'element' | 'document'

/**
 * Additional CSS property effects driven by cursor proximity.
 * Applied to word spans in field mode, or char spans in legibility mode.
 */
export interface MagnetTypeProps {
	/**
	 * Opacity range [restValue, peakValue].
	 * e.g. [1, 0.6] fades words/chars near the cursor.
	 */
	opacity?: [number, number]

	/**
	 * When true, applies font-style:italic to spans where cursor strength > 0.5.
	 * For variable fonts with an 'ital' axis, use axes: { ital: [0, 1] } instead.
	 */
	italic?: boolean
}

/**
 * Options for the magnetType effect.
 *
 * Two modes share this options type:
 * - 'field'      — cursor proximity drives per-word variable font axis values
 * - 'legibility' — cursor proximity drives per-character wdth boost for confusable characters
 */
export interface MagnetTypeOptions {
	/**
	 * Operating mode. Default: 'word'
	 *
	 * - **'word'** (alias: **'field'**) — cursor proximity drives per-word font-variation-settings via a continuous rAF loop.
	 * - **'legibility'** — cursor-driven wdth boost for confusable characters; returns a stop function.
	 */
	mode?: MagnetTypeModeType

	// ── shared options ──────────────────────────────────────────────────────────

	/**
	 * Scope for cursor event listeners. Default: 'document'
	 *
	 * - **'document'** — listens on document; works across multiple elements and paragraphs.
	 * - **'element'** — listens only on the target element.
	 */
	scope?: ScopeType

	/**
	 * Pixel radius over which the field effect fades.
	 * Words/chars beyond this distance receive restValue. Default: 120
	 */
	radius?: number

	/**
	 * Falloff curve. Default: 'quadratic'
	 *
	 * - **'linear'** — strength decreases linearly with distance
	 * - **'quadratic'** — strength decreases as distance², giving a tighter hot zone
	 */
	falloff?: FalloffType

	/**
	 * Additional CSS property effects driven by cursor proximity.
	 * Supports opacity [rest, peak] and italic toggle.
	 */
	props?: MagnetTypeProps

	// ── field mode options ──────────────────────────────────────────────────────

	/**
	 * Map of axis tag → [restValue, peakValue].
	 * restValue is applied at full distance; peakValue when cursor is directly over the word.
	 * Default: { wght: [300, 500] }
	 */
	axes?: Record<string, [number, number]>

	/**
	 * Attraction or repulsion mode. Default: 'attract'
	 *
	 * - **'attract'** — words near cursor approach peakValue
	 * - **'repel'** — words near cursor stay at restValue; far words approach peakValue
	 */
	magnetMode?: MagnetModeType

	// ── legibility mode options ─────────────────────────────────────────────────

	/**
	 * wdth axis units for the characters that widen or narrow (see LEGIBILITY_TREATMENTS) at full cursor
	 * strength, around the text's own width. Needs a font with a `wdth` axis. Default: 30
	 */
	wdthBoost?: number

	/**
	 * wght axis units for the characters that get heavier (see LEGIBILITY_TREATMENTS) at full cursor
	 * strength, around the text's own weight. Needs a variable weight. Default: 200
	 */
	wghtBoost?: number

	/**
	 * Extra space, in em, after an `r` followed by `n` or `m` at full cursor strength (taken back after the
	 * `n`/`m`, so the line keeps its length). Works in any font. Default: 0.08
	 */
	trackBoost?: number

	// ── performance options ─────────────────────────────────────────────────────

	/**
	 * Cache word/character centre positions in page-relative coordinates after setup,
	 * eliminating getBoundingClientRect calls during the active interaction loop.
	 * The cache is rebuilt when the element resizes, when the viewport resizes, after fonts
	 * load, and whenever a per-frame check detects the element has moved or changed size
	 * since the cache was built (one getBoundingClientRect per frame, not one per span).
	 * Disable if the element lives inside a custom scroll container
	 * (overflow: scroll on a non-window element) —
	 * page coordinates are computed using window.scrollX/Y and will be incorrect when
	 * a nested element is the scroll parent.
	 * @default true
	 */
	cachePositions?: boolean

	// ── layout options ───────────────────────────────────────────────────────────

	/**
	 * Apply compensating letter-spacing to keep line lengths stable as font weight
	 * changes. Measures the element's text width at rest and peak weight, then applies
	 * proportional negative letter-spacing per word/character as weight rises, cancelling
	 * the advance-width increase that would otherwise cause text to reflow.
	 *
	 * Disable if you prefer natural bold letter-spacing, or if the font expands characters
	 * very unevenly across the weight axis (the compensation is a per-element average and
	 * may not perfectly cancel highly variable per-character expansion).
	 * @default true
	 */
	stabilizeLayout?: boolean

	// ── transition options ──────────────────────────────────────────────────────

	/**
	 * Duration in milliseconds for the CSS transition back to rest values when the
	 * cursor leaves (mouseleave / touchend). Default: 0 (instant snap, no transition).
	 *
	 * When > 0, sets `transition: font-variation-settings <transitionMs>ms ease` on
	 * each span at leave time, then removes the transition property after the duration.
	 * On mousemove / touchmove the transition is cleared so live tracking is not delayed.
	 */
	transitionMs?: number
}

/** CSS class names injected by magnetType — use these to target generated markup */
export const MAGNET_TYPE_CLASSES = {
	/** Applied to each word span in field mode */
	word: 'mt-word',
	/** Applied to each character span in legibility mode */
	char: 'mt-char',
	/** Applied to measurement probe spans (never in final output) */
	probe: 'mt-probe',
} as const
