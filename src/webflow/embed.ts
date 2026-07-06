// magnetType/src/webflow/embed.ts — zero-config browser bundle for Webflow Custom Code Embed.
// Auto-initialises magnetType on any element marked with [data-magnettype], reading options
// from data-* attributes, and exposes a small window.MagnetType API for manual control.
import { startMagnetType, applyMagnetType } from '../core/adjust'
import type { MagnetTypeOptions, MagnetTypeModeType, ScopeType, FalloffType, MagnetModeType } from '../core/types'

/** Attribute that opts an element in to the magnetType effect. */
const OPT_IN_ATTR = 'data-magnettype'

/** Per-element teardown record so destroy() can stop the loop and restore markup. */
interface Instance {
	/** Stop function returned by startMagnetType / applyMagnetType — cancels listeners and restores markup. */
	stop: () => void
}

/** Tracks live instances keyed by their element — WeakMap so removed nodes are GC'd. */
const INSTANCES = new WeakMap<HTMLElement, Instance>()

/** Valid operating modes for data-mt-mode. */
const VALID_MODES: readonly MagnetTypeModeType[] = ['word', 'field', 'legibility']

/** Valid cursor-listener scopes for data-mt-scope. */
const VALID_SCOPES: readonly ScopeType[] = ['element', 'document']

/** Valid falloff curves for data-mt-falloff. */
const VALID_FALLOFFS: readonly FalloffType[] = ['linear', 'quadratic']

/** Valid attract/repel behaviours for data-mt-magnet-mode. */
const VALID_MAGNET_MODES: readonly MagnetModeType[] = ['attract', 'repel']

/**
 * Parse an axes spec string into a { tag: [rest, peak] } map.
 * Format: "wght:300,500;wdth:80,120" — semicolon-separated axis groups, each
 * "tag:rest,peak". Malformed groups are skipped. Returns undefined if nothing valid parsed.
 *
 * @param raw - The data-mt-axes attribute value
 */
function parseAxes(raw: string): Record<string, [number, number]> | undefined {
	const out: Record<string, [number, number]> = {}
	let any = false
	for (const group of raw.split(';')) {
		const [tagPart, valuePart] = group.split(':')
		if (!tagPart || !valuePart) continue
		const tag = tagPart.trim()
		if (!tag) continue
		const nums = valuePart.split(',').map((s) => parseFloat(s.trim()))
		if (nums.length !== 2 || isNaN(nums[0]) || isNaN(nums[1])) continue
		out[tag] = [nums[0], nums[1]]
		any = true
	}
	return any ? out : undefined
}

/**
 * Read magnetType options from an element's data-* attributes.
 * Unset attributes fall through to the library defaults.
 *
 * Supported attributes:
 *   data-mt-mode              — word | field | legibility (default word)
 *   data-mt-scope             — element | document
 *   data-mt-radius            — pixel radius of the proximity field
 *   data-mt-falloff           — linear | quadratic
 *   data-mt-axes              — field-mode axis map, e.g. "wght:300,500;wdth:80,120"
 *   data-mt-magnet-mode       — attract | repel (field mode)
 *   data-mt-wdth-boost        — wdth units added to confusable chars (legibility mode)
 *   data-mt-opacity           — "rest,peak" opacity pair, e.g. "1,0.6"
 *   data-mt-italic            — "true" to italicise spans past half strength
 *   data-mt-cache-positions   — "false" to disable page-relative position caching
 *   data-mt-stabilize-layout  — "false" to disable width-stabilising letter-spacing (field mode)
 *   data-mt-transition-ms     — ms of ease-back transition when the cursor leaves
 *
 * @param el - The opted-in element
 */
function readOptions(el: HTMLElement): MagnetTypeOptions {
	const opts: MagnetTypeOptions = {}
	const d = el.dataset

	if (d.mtMode && (VALID_MODES as readonly string[]).includes(d.mtMode)) {
		opts.mode = d.mtMode as MagnetTypeModeType
	}
	if (d.mtScope && (VALID_SCOPES as readonly string[]).includes(d.mtScope)) {
		opts.scope = d.mtScope as ScopeType
	}
	if (d.mtRadius !== undefined) {
		const n = parseFloat(d.mtRadius)
		if (!isNaN(n)) opts.radius = n
	}
	if (d.mtFalloff && (VALID_FALLOFFS as readonly string[]).includes(d.mtFalloff)) {
		opts.falloff = d.mtFalloff as FalloffType
	}
	if (d.mtAxes) {
		const axes = parseAxes(d.mtAxes)
		if (axes) opts.axes = axes
	}
	if (d.mtMagnetMode && (VALID_MAGNET_MODES as readonly string[]).includes(d.mtMagnetMode)) {
		opts.magnetMode = d.mtMagnetMode as MagnetModeType
	}
	if (d.mtWdthBoost !== undefined) {
		const n = parseFloat(d.mtWdthBoost)
		if (!isNaN(n)) opts.wdthBoost = n
	}

	// props (opacity, italic) — only construct the object when at least one is set
	const opacityRaw = d.mtOpacity
	const wantItalic = d.mtItalic === 'true'
	if (opacityRaw || wantItalic) {
		opts.props = {}
		if (opacityRaw) {
			const nums = opacityRaw.split(',').map((s) => parseFloat(s.trim()))
			if (nums.length === 2 && !isNaN(nums[0]) && !isNaN(nums[1])) {
				opts.props.opacity = [nums[0], nums[1]]
			}
		}
		if (wantItalic) opts.props.italic = true
	}

	if (d.mtCachePositions === 'false') opts.cachePositions = false
	if (d.mtStabilizeLayout === 'false') opts.stabilizeLayout = false
	if (d.mtTransitionMs !== undefined) {
		const n = parseFloat(d.mtTransitionMs)
		if (!isNaN(n)) opts.transitionMs = n
	}

	return opts
}

/**
 * Initialise a single element: snapshot its markup and start the effect for the
 * chosen mode. Idempotent — re-initialising an element tears down the previous
 * instance first so markup is never double-wrapped.
 *
 * The core reads prefers-reduced-motion itself and, when set, restores the markup
 * and returns a no-op stop function — so no reduced-motion handling is needed here.
 *
 * @param el - Element to animate
 */
function initElement(el: HTMLElement): void {
	// Tear down any previous run so re-init doesn't double-wrap.
	destroy(el)

	const originalHTML = el.innerHTML
	const options = readOptions(el)

	// 'legibility' uses applyMagnetType (per-character wdth boost); 'word' and its
	// alias 'field' use startMagnetType (per-word axis field). Both return a stop fn.
	const stop = options.mode === 'legibility'
		? applyMagnetType(el, originalHTML, options)
		: startMagnetType(el, originalHTML, options)

	INSTANCES.set(el, { stop })
}

/**
 * Stop and restore a single element if it has a live instance.
 * The stop function restores the element's original markup as part of teardown.
 *
 * @param el - Element previously initialised
 */
function destroy(el: HTMLElement): void {
	const inst = INSTANCES.get(el)
	if (!inst) return
	inst.stop()
	INSTANCES.delete(el)
}

/**
 * Scan a root for opted-in elements and initialise each one.
 *
 * @param root - Element or document to search (default: document)
 */
function init(root: ParentNode = document): void {
	root.querySelectorAll<HTMLElement>(`[${OPT_IN_ATTR}]`).forEach(initElement)
}

/**
 * Re-initialise a single element, re-reading its current data-* attributes.
 * Useful after mutating attributes at runtime. Tears down then rebuilds.
 *
 * @param el - Element to restart
 */
function restart(el: HTMLElement): void {
	initElement(el)
}

/**
 * Auto-initialise once the DOM is parsed and web fonts have loaded.
 * Fonts must settle first: variable-axis effects and cached glyph centres both
 * depend on final metrics, which shift when a web font swaps in.
 */
function autoInit(): void {
	const run = () => {
		if (document.fonts?.ready) {
			document.fonts.ready.then(() => init()).catch(() => init())
		} else {
			init()
		}
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', run, { once: true })
	} else {
		run()
	}
}

autoInit()

// Public browser API — assigned to window.MagnetType via the IIFE global name.
export { init, destroy, restart }
