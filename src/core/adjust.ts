// magnetType/src/core/adjust.ts — framework-agnostic magnetType algorithm
import { MAGNET_TYPE_CLASSES, CONFUSABLE, type MagnetTypeOptions, type MagnetTypeProps } from './types'

// ─── Resolved defaults ────────────────────────────────────────────────────────

const DEFAULTS = {
	mode: 'word' as const,
	axes: { wght: [300, 500] as [number, number] },
	radius: 120,
	falloff: 'quadratic' as const,
	magnetMode: 'attract' as const,
	wdthBoost: 6,
	scope: 'document' as const,
}

// ─── Shared utilities ─────────────────────────────────────────────────────────

/**
 * Collect all text nodes in a subtree using recursive childNodes traversal.
 * Intentionally avoids createTreeWalker — it skips inline elements in happy-dom 12.
 */
function collectTextNodes(node: Node, result: Text[] = []): Text[] {
	if (node.nodeType === Node.TEXT_NODE) {
		result.push(node as Text)
	} else {
		node.childNodes.forEach((child) => collectTextNodes(child, result))
	}
	return result
}

/** Per-axis RegExp cache — avoids re-compiling the same pattern on every rAF frame. */
const axisPatternCache = new Map<string, RegExp>()

/**
 * Maximum drift, in CSS pixels, tolerated in the target element's page geometry before
 * the cached span positions are rebuilt. Sub-pixel to absorb fractional rounding noise
 * from getBoundingClientRect without triggering spurious rebuilds.
 */
const DRIFT_TOLERANCE = 0.5

/** Page-relative geometry snapshot of the target element, captured when the cache was built. */
type AnchorRect = { left: number; top: number; width: number; height: number }

/**
 * Read the element's geometry in page coordinates (viewport rect plus scroll offset).
 * Page coordinates are used so the anchor stays comparable across scroll positions.
 */
function readAnchor(element: HTMLElement): AnchorRect {
	const r = element.getBoundingClientRect()
	return {
		left: r.left + window.scrollX,
		top: r.top + window.scrollY,
		width: r.width,
		height: r.height,
	}
}

/**
 * True when the element has moved or resized beyond DRIFT_TOLERANCE since the anchor was
 * captured. Costs a single getBoundingClientRect per frame — regardless of span count — and
 * catches layout shifts a ResizeObserver cannot see, notably an element repositioned without
 * any change to its own size (vertically centred hero, max-width container, zoom, mobile
 * URL-bar collapse, content reflowing above the element).
 */
function hasDrifted(element: HTMLElement, anchor: AnchorRect | null): boolean {
	if (!anchor) return true
	const now = readAnchor(element)
	return (
		Math.abs(now.left - anchor.left) > DRIFT_TOLERANCE ||
		Math.abs(now.top - anchor.top) > DRIFT_TOLERANCE ||
		Math.abs(now.width - anchor.width) > DRIFT_TOLERANCE ||
		Math.abs(now.height - anchor.height) > DRIFT_TOLERANCE
	)
}

/**
 * Override a single axis value inside a font-variation-settings string,
 * preserving all other axis values. Adds the axis if it is not already present.
 */
function overrideAxis(baseFVS: string, axis: string, value: number): string {
	if (!baseFVS || baseFVS === 'normal') return `"${axis}" ${value}`
	let pattern = axisPatternCache.get(axis)
	if (!pattern) {
		// Character class uses [-+] with - at the start to avoid range-operator ambiguity.
		// Leading -? allows negative axis values (e.g. "slnt" -12).
		pattern = new RegExp(`(["'])${axis}\\1\\s+-?[\\d.eE][\\d.eE+-]*`)
		axisPatternCache.set(axis, pattern)
	}
	const replacement = `"${axis}" ${value}`
	return pattern.test(baseFVS)
		? baseFVS.replace(pattern, replacement)
		: `${baseFVS}, ${replacement}`
}

/**
 * Override multiple axes at once in a font-variation-settings string.
 * Applies each axis in the provided map, preserving all others.
 */
function overrideAxes(baseFVS: string, axes: Record<string, number>): string {
	let fvs = baseFVS
	for (const [axis, value] of Object.entries(axes)) {
		fvs = overrideAxis(fvs, axis, value)
	}
	return fvs
}

/**
 * Apply additional CSS props (opacity, italic) to a span based on cursor proximity strength.
 * strength is a [0, 1] normalised proximity value.
 */
function applyProps(span: HTMLElement, props: MagnetTypeProps, strength: number): void {
	if (props.opacity !== undefined) {
		const [restOp, peakOp] = props.opacity
		span.style.opacity = String(restOp + (peakOp - restOp) * strength)
	}
	if (props.italic === true) {
		span.style.fontStyle = strength > 0.5 ? 'italic' : ''
	}
}

/**
 * Reset additional CSS props to their rest values on a span.
 */
function resetProps(span: HTMLElement, props: MagnetTypeProps): void {
	if (props.opacity !== undefined) {
		span.style.opacity = String(props.opacity[0])
	}
	if (props.italic === true) {
		span.style.fontStyle = ''
	}
}

// ─── getCleanHTML ─────────────────────────────────────────────────────────────

/**
 * Returns the innerHTML of an element with all magnetType injected markup removed,
 * unwrapping their children in place. Safe to call multiple times — idempotent.
 */
export function getCleanHTML(el: HTMLElement): string {
	const clone = el.cloneNode(true) as HTMLElement
	const injected = clone.querySelectorAll(
		`.${MAGNET_TYPE_CLASSES.word}, .${MAGNET_TYPE_CLASSES.char}`,
	)
	// Iterate in reverse order to safely handle nested spans.
	const nodes = Array.from(injected).reverse()
	nodes.forEach((node) => {
		const parent = node.parentNode
		if (!parent) return
		while (node.firstChild) parent.insertBefore(node.firstChild, node)
		parent.removeChild(node)
	})
	return clone.innerHTML
}

// ─── removeMagnetType ─────────────────────────────────────────────────────────

/**
 * Remove magnetType markup and restore the element to its original HTML.
 *
 * @param element      - The element that was previously modified
 * @param originalHTML - The snapshot passed to applyMagnetType / startMagnetType
 *
 * @security originalHTML is assigned to innerHTML without sanitization.
 * Always pass the value returned by getCleanHTML() — never pass attacker-controlled input.
 */
export function removeMagnetType(element: HTMLElement, originalHTML: string): void {
	element.innerHTML = originalHTML
}

// ─── applyMagnetType (legibility mode) ───────────────────────────────────────

/**
 * Start the legibility effect on an element.
 *
 * Wraps visually confusable characters in spans, then listens for mousemove events
 * to drive per-character wdth boost based on cursor distance. Characters near the
 * cursor receive a wdth boost proportional to their confusion risk level.
 * Resets to base wdth on mouseleave.
 *
 * Defaults to listening on document (scope: 'document'), enabling cross-paragraph
 * effects when multiple elements are independently targeted.
 *
 * @param element      - Target element (must be in the live DOM and visible)
 * @param originalHTML - Clean HTML snapshot from getCleanHTML()
 * @param options      - MagnetTypeOptions; wdthBoost, radius, falloff, scope, props used
 * @returns            - A stop function. Call it to cancel listeners and restore markup.
 *
 * @security originalHTML is assigned to innerHTML without sanitization.
 * Always pass the value returned by getCleanHTML() — never pass attacker-controlled input.
 */
export function applyMagnetType(
	element: HTMLElement,
	originalHTML: string,
	options: MagnetTypeOptions = {},
): () => void {
	if (typeof window === 'undefined') return () => {}

	// Check prefers-reduced-motion — skip interaction entirely if requested
	if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
		element.innerHTML = originalHTML
		return () => {}
	}

	const wdthBoost = options.wdthBoost ?? DEFAULTS.wdthBoost
	const radius = options.radius ?? DEFAULTS.radius
	const falloff = options.falloff ?? DEFAULTS.falloff
	const scope = options.scope ?? DEFAULTS.scope
	const props = options.props
	const transitionMs = options.transitionMs ?? 0
	const cachePositions = options.cachePositions ?? true

	// Save scroll position — iOS Safari does not support overflow-anchor: none
	const scrollY = window.scrollY

	// --- Pass 1: Reset (idempotent) ---
	element.innerHTML = originalHTML

	// --- Pass 2: Read base font-variation-settings ---
	const baseFVS = getComputedStyle(element).fontVariationSettings

	// Parse current wdth from baseFVS, defaulting to 100 if absent
	const wdthMatch = baseFVS.match(/"wdth"\s+([\d.eE+-]+)/)
	const baseWdth = wdthMatch ? parseFloat(wdthMatch[1]) : 100

	// --- Pass 3: Collect text nodes and wrap confusable chars ---
	const textNodes = collectTextNodes(element)

	/** Each entry tracks the span and the character's risk level (1–3). */
	const charSpans: { span: HTMLElement; riskLevel: number }[] = []

	for (const textNode of textNodes) {
		const text = textNode.textContent ?? ''
		if (!text) continue

		const hasConfusable = text.split('').some((ch) => ch in CONFUSABLE)
		if (!hasConfusable) continue

		const fragment = document.createDocumentFragment()

		for (const ch of text) {
			const riskLevel = CONFUSABLE[ch]
			if (riskLevel === undefined) {
				// Non-confusable: emit as plain text node
				const last = fragment.lastChild
				if (last && last.nodeType === Node.TEXT_NODE) {
					;(last as Text).textContent += ch
				} else {
					fragment.appendChild(document.createTextNode(ch))
				}
			} else {
				// Confusable: wrap in a char span, starting at base wdth (no boost yet).
				// aria-hidden="true" — screen readers use the parent element's text directly.
				const span = document.createElement('span')
				span.className = MAGNET_TYPE_CLASSES.char
				span.setAttribute('aria-hidden', 'true')
				span.style.fontVariationSettings = overrideAxis(baseFVS, 'wdth', baseWdth)
				span.textContent = ch
				fragment.appendChild(span)
				charSpans.push({ span, riskLevel })
			}
		}

		textNode.parentNode?.replaceChild(fragment, textNode)
	}

	// --- Pass 4: Restore scroll after DOM mutation ---
	requestAnimationFrame(() => {
		if (typeof window !== 'undefined' && Math.abs(window.scrollY - scrollY) > 2) {
			window.scrollTo({ top: scrollY, behavior: 'instant' })
		}
	})

	if (charSpans.length === 0) return () => {}

	// Apply initial props rest values
	if (props) {
		charSpans.forEach(({ span }) => resetProps(span, props))
	}

	// --- Position cache (page-relative char centres, avoids per-frame getBoundingClientRect) ---
	type CharPos = { cx: number; cy: number }
	let charPositions: CharPos[] = []
	let cacheValid = false
	/** Element geometry when the cache was last built — drives the per-frame drift check. */
	let anchor: AnchorRect | null = null

	function buildCharCache() {
		const sx = window.scrollX
		const sy = window.scrollY
		// Read the anchor before the span rects — all reads, no interleaved writes.
		anchor = readAnchor(element)
		charPositions = charSpans.map(({ span }) => {
			const r = span.getBoundingClientRect()
			return { cx: (r.left + r.right) / 2 + sx, cy: (r.top + r.bottom) / 2 + sy }
		})
		cacheValid = true
	}

	/** Mark the position cache stale; it is rebuilt lazily on the next frame. */
	function invalidateCache(): void {
		cacheValid = false
	}

	let ro: ResizeObserver | null = null
	if (cachePositions) {
		buildCharCache()
		ro = new ResizeObserver(invalidateCache)
		ro.observe(element)
		// ResizeObserver only fires when the element's own box changes size. A viewport
		// resize that merely repositions it leaves the cache stale, so listen for resize
		// directly as well.
		window.addEventListener('resize', invalidateCache)
		window.addEventListener('orientationchange', invalidateCache)
		document.fonts?.ready?.then(invalidateCache)
	}

	// --- rAF loop state ---
	let cursorX = -9999
	let cursorY = -9999
	let cursorInside = false
	// null = no pending frame; non-null = a frame is queued. Using null avoids the
	// ambiguity of 0 as a valid rAF handle on some runtimes.
	let rafId: number | null = null
	let active = true

	// Timer handle for removing the transition property after transitionMs
	let transitionTimer: ReturnType<typeof setTimeout> | null = null

	// frame() runs at most once per input event — it does NOT re-schedule itself.
	// This means the loop is idle when the cursor is stationary, saving the full
	// per-frame work budget (distance math, overrideAxis calls, style writes).
	function frame(): void {
		rafId = null
		if (!active) return

		if (!cursorInside) {
			// Cursor left — reset all chars to base wdth, optionally with a CSS transition
			charSpans.forEach(({ span }) => {
				if (transitionMs > 0) {
					span.style.transition = `font-variation-settings ${transitionMs}ms ease`
				}
				span.style.fontVariationSettings = overrideAxis(baseFVS, 'wdth', baseWdth)
				if (props) resetProps(span, props)
			})
			if (transitionMs > 0) {
				if (transitionTimer !== null) clearTimeout(transitionTimer)
				transitionTimer = setTimeout(() => {
					charSpans.forEach(({ span }) => { span.style.transition = '' })
					transitionTimer = null
				}, transitionMs)
			}
			return
		}

		// Resolve cursor and char centres in a common coordinate space
		if (cachePositions && (!cacheValid || hasDrifted(element, anchor))) buildCharCache()
		const pageCursorX = cachePositions ? cursorX + window.scrollX : cursorX
		const pageCursorY = cachePositions ? cursorY + window.scrollY : cursorY

		// Batch-read live rects only when not caching (avoids layout thrash)
		const rects = cachePositions ? null : charSpans.map(({ span }) => span.getBoundingClientRect())

		charSpans.forEach(({ span, riskLevel }, i) => {
			// Clear any outgoing transition so live tracking is not delayed
			span.style.transition = ''
			let cx: number, cy: number
			if (cachePositions) {
				;({ cx, cy } = charPositions[i])
			} else {
				const r = rects![i]
				cx = r.left + r.width / 2
				cy = r.top + r.height / 2
			}

			const dist = Math.sqrt((pageCursorX - cx) ** 2 + (pageCursorY - cy) ** 2)
			const normalised = Math.max(0, 1 - dist / radius)
			const strength = falloff === 'quadratic' ? normalised * normalised : normalised

			const boost = wdthBoost * (riskLevel / 3) * strength
			span.style.fontVariationSettings = overrideAxis(baseFVS, 'wdth', baseWdth + boost)
			if (props) applyProps(span, props, strength)
		})
	}

	function onMouseMove(e: MouseEvent): void {
		cursorX = e.clientX
		cursorY = e.clientY
		if (!cursorInside) cursorInside = true
		if (rafId === null) rafId = requestAnimationFrame(frame)
	}

	function onMouseLeave(): void {
		cursorInside = false
		if (rafId === null) rafId = requestAnimationFrame(frame)
	}

	function onTouchMove(e: TouchEvent): void {
		if (e.touches.length === 0) return
		cursorX = e.touches[0].clientX
		cursorY = e.touches[0].clientY
		if (!cursorInside) cursorInside = true
		if (rafId === null) rafId = requestAnimationFrame(frame)
	}

	function onTouchEnd(): void {
		cursorInside = false
		if (rafId === null) rafId = requestAnimationFrame(frame)
	}

	const eventTarget = scope === 'document' ? document : element
	eventTarget.addEventListener('mousemove', onMouseMove as EventListener)
	eventTarget.addEventListener('mouseleave', onMouseLeave as EventListener)
	eventTarget.addEventListener('touchmove', onTouchMove as EventListener, { passive: true })
	eventTarget.addEventListener('touchend', onTouchEnd as EventListener)

	return () => {
		active = false
		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
		if (transitionTimer !== null) clearTimeout(transitionTimer)
		if (ro) ro.disconnect()
		window.removeEventListener('resize', invalidateCache)
		window.removeEventListener('orientationchange', invalidateCache)
		eventTarget.removeEventListener('mousemove', onMouseMove as EventListener)
		eventTarget.removeEventListener('mouseleave', onMouseLeave as EventListener)
		eventTarget.removeEventListener('touchmove', onTouchMove as EventListener)
		eventTarget.removeEventListener('touchend', onTouchEnd as EventListener)
		element.innerHTML = originalHTML
	}
}

// ─── startMagnetType (word mode) ─────────────────────────────────────────────

/**
 * Start the cursor-field effect on an element.
 *
 * Wraps each word in a span, then listens for mousemove events to drive per-word
 * font-variation-settings based on cursor distance. Uses a requestAnimationFrame
 * loop for smooth axis interpolation. Resets all words to restValue on mouseleave.
 *
 * Defaults to listening on document (scope: 'document'), enabling cross-paragraph
 * effects when multiple elements are independently targeted.
 *
 * @param element      - Target element (must be in the live DOM and visible)
 * @param originalHTML - Clean HTML snapshot from getCleanHTML()
 * @param options      - MagnetTypeOptions; axes, radius, falloff, magnetMode, scope, props used
 * @returns            - A stop function. Call it to cancel the rAF loop and restore markup.
 *
 * @security originalHTML is assigned to innerHTML without sanitization.
 * Always pass the value returned by getCleanHTML() — never pass attacker-controlled input.
 */
export function startMagnetType(
	element: HTMLElement,
	originalHTML: string,
	options: MagnetTypeOptions = {},
): () => void {
	if (typeof window === 'undefined') return () => {}

	// Check prefers-reduced-motion — skip animation entirely if requested
	if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
		element.innerHTML = originalHTML
		return () => {}
	}

	const axes: Record<string, [number, number]> = options.axes ?? DEFAULTS.axes
	const radius = options.radius ?? DEFAULTS.radius
	const falloff = options.falloff ?? DEFAULTS.falloff
	const magnetMode = options.magnetMode ?? DEFAULTS.magnetMode
	const scope = options.scope ?? DEFAULTS.scope
	const props = options.props
	const transitionMs = options.transitionMs ?? 0
	const cachePositions = options.cachePositions ?? true
	const stabilizeLayout = options.stabilizeLayout ?? true

	// Save scroll — iOS Safari does not support overflow-anchor: none
	const scrollY = window.scrollY

	// --- Pass 1: Reset (idempotent) ---
	element.innerHTML = originalHTML

	// --- Pass 2: Read base font-variation-settings before any span injection ---
	// Must be read here (before DOM mutation) to avoid picking up inline FVS from child spans.
	const baseFVS = getComputedStyle(element).fontVariationSettings

	// --- Pass 3: Wrap each word in a span ---
	const textNodes = collectTextNodes(element)
	const wordSpans: HTMLElement[] = []

	for (const textNode of textNodes) {
		const text = textNode.textContent ?? ''
		if (!text.trim()) continue

		// Split into alternating [whitespace, word, whitespace, word, …] tokens
		const tokens = text.split(/(\S+)/)
		const fragment = document.createDocumentFragment()

		for (let i = 0; i < tokens.length; i += 2) {
			const space = tokens[i]
			const word = tokens[i + 1]
			if (!word) continue

			// Include trailing whitespace in the last word of this text node
			const isLastWord = tokens[i + 3] === undefined
			const trailingSpace = isLastWord ? (tokens[i + 2] ?? '') : ''

			// aria-hidden="true" — screen readers use the parent element's text directly.
			const span = document.createElement('span')
			span.className = MAGNET_TYPE_CLASSES.word
			span.setAttribute('aria-hidden', 'true')
			span.textContent = space + word + trailingSpace
			fragment.appendChild(span)
			wordSpans.push(span)
		}

		textNode.parentNode?.replaceChild(fragment, textNode)
	}

	// --- Pass 4: Restore scroll after DOM mutation ---
	requestAnimationFrame(() => {
		if (typeof window !== 'undefined' && Math.abs(window.scrollY - scrollY) > 2) {
			window.scrollTo({ top: scrollY, behavior: 'instant' })
		}
	})

	if (wordSpans.length === 0) return () => {}

	// Compute the rest FVS (applied when cursor is beyond radius or not present)
	const restFVS = overrideAxes(
		baseFVS,
		Object.fromEntries(Object.entries(axes).map(([tag, [rest]]) => [tag, rest])),
	)

	// --- stabilizeLayout: measure text width delta at peak vs rest weight ---
	// Done synchronously before first paint of the interaction. Temporarily sets
	// white-space: nowrap to get unconstrained text width for accurate delta measurement.
	// try/finally guarantees saved styles are always restored even if an exception is thrown.
	let perCharDelta = 0
	if (stabilizeLayout) {
		const peakFVS = overrideAxes(
			baseFVS,
			Object.fromEntries(Object.entries(axes).map(([tag, [, peak]]) => [tag, peak])),
		)
		const savedFVS = element.style.fontVariationSettings
		const savedWS = element.style.whiteSpace
		const savedOF = element.style.overflow

		element.style.whiteSpace = 'nowrap'
		element.style.overflow = 'visible'

		try {
			element.style.fontVariationSettings = peakFVS
			const widthAtPeak = element.scrollWidth

			element.style.fontVariationSettings = restFVS
			const widthAtRest = element.scrollWidth

			const nonSpaceCount = wordSpans.reduce(
				(n, s) => n + (s.textContent?.replace(/\s+/g, '').length ?? 0), 0
			)
			if (nonSpaceCount > 0 && widthAtPeak > widthAtRest) {
				perCharDelta = (widthAtPeak - widthAtRest) / nonSpaceCount
			}
		} finally {
			element.style.fontVariationSettings = savedFVS
			element.style.whiteSpace = savedWS
			element.style.overflow = savedOF
		}
	}

	// Apply restValues and initial props immediately (before any cursor interaction)
	wordSpans.forEach((span) => {
		span.style.fontVariationSettings = restFVS
		if (props) resetProps(span, props)
	})

	// --- Position cache (page-relative word centres, avoids per-frame getBoundingClientRect) ---
	type WordPos = { cx: number; cy: number }
	let wordPositions: WordPos[] = []
	let cacheValid = false
	/** Element geometry when the cache was last built — drives the per-frame drift check. */
	let anchor: AnchorRect | null = null

	function buildWordCache() {
		const sx = window.scrollX
		const sy = window.scrollY
		// Read the anchor before the span rects — all reads, no interleaved writes.
		anchor = readAnchor(element)
		wordPositions = wordSpans.map((span) => {
			const r = span.getBoundingClientRect()
			return { cx: (r.left + r.right) / 2 + sx, cy: (r.top + r.bottom) / 2 + sy }
		})
		cacheValid = true
	}

	/** Mark the position cache stale; it is rebuilt lazily on the next frame. */
	function invalidateCache(): void {
		cacheValid = false
	}

	let ro: ResizeObserver | null = null
	if (cachePositions) {
		buildWordCache()
		ro = new ResizeObserver(invalidateCache)
		ro.observe(element)
		// ResizeObserver only fires when the element's own box changes size. A viewport
		// resize that merely repositions it leaves the cache stale, so listen for resize
		// directly as well.
		window.addEventListener('resize', invalidateCache)
		window.addEventListener('orientationchange', invalidateCache)
		document.fonts?.ready?.then(invalidateCache)
	}

	// --- rAF loop state ---
	let cursorX = -9999
	let cursorY = -9999
	let cursorInside = false
	// null = no pending frame; non-null = a frame is queued. Using null avoids the
	// ambiguity of 0 as a valid rAF handle on some runtimes.
	let rafId: number | null = null
	let active = true

	// Timer handle for removing the transition property after transitionMs
	let transitionTimer: ReturnType<typeof setTimeout> | null = null

	// frame() runs at most once per input event — it does NOT re-schedule itself.
	// This means the loop is idle when the cursor is stationary, saving the full
	// per-frame work budget (distance math, overrideAxes calls, style writes).
	function frame(): void {
		rafId = null
		if (!active) return

		if (!cursorInside) {
			// Cursor left — reset to restValues, optionally with a CSS transition
			wordSpans.forEach((span) => {
				if (transitionMs > 0) {
					span.style.transition = `font-variation-settings ${transitionMs}ms ease`
				}
				span.style.fontVariationSettings = restFVS
				if (stabilizeLayout) span.style.letterSpacing = ''
				if (props) resetProps(span, props)
			})
			if (transitionMs > 0) {
				if (transitionTimer !== null) clearTimeout(transitionTimer)
				transitionTimer = setTimeout(() => {
					wordSpans.forEach((span) => { span.style.transition = '' })
					transitionTimer = null
				}, transitionMs)
			}
			return
		}

		// Resolve cursor and word centres in a common coordinate space
		if (cachePositions && (!cacheValid || hasDrifted(element, anchor))) buildWordCache()
		const pageCursorX = cachePositions ? cursorX + window.scrollX : cursorX
		const pageCursorY = cachePositions ? cursorY + window.scrollY : cursorY

		// Batch-read live rects only when not caching (avoids layout thrash)
		const rects = cachePositions ? null : wordSpans.map((span) => span.getBoundingClientRect())

		wordSpans.forEach((span, i) => {
			// Clear any outgoing transition so live tracking is not delayed
			span.style.transition = ''
			let cx: number, cy: number
			if (cachePositions) {
				;({ cx, cy } = wordPositions[i])
			} else {
				const r = rects![i]
				cx = r.left + r.width / 2
				cy = r.top + r.height / 2
			}

			const dist = Math.sqrt((pageCursorX - cx) ** 2 + (pageCursorY - cy) ** 2)
			const normalised = Math.max(0, 1 - dist / radius)
			const strength = falloff === 'quadratic' ? normalised * normalised : normalised
			const t = magnetMode === 'repel' ? 1 - strength : strength

			const perAxisValues: Record<string, number> = {}
			for (const tag of Object.keys(axes)) {
				const [rest, peak] = axes[tag] ?? [300, 500]
				perAxisValues[tag] = rest + (peak - rest) * t
			}

			span.style.fontVariationSettings = overrideAxes(baseFVS, perAxisValues)

			// Compensate for the advance-width increase by tightening letter-spacing proportionally
			if (stabilizeLayout && perCharDelta !== 0) {
				span.style.letterSpacing = `${(-perCharDelta * t).toFixed(3)}px`
			}

			if (props) applyProps(span, props, strength)
		})
	}

	function onMouseMove(e: MouseEvent): void {
		cursorX = e.clientX
		cursorY = e.clientY
		if (!cursorInside) cursorInside = true
		if (rafId === null) rafId = requestAnimationFrame(frame)
	}

	function onMouseLeave(): void {
		cursorInside = false
		if (rafId === null) rafId = requestAnimationFrame(frame)
	}

	function onTouchMove(e: TouchEvent): void {
		if (e.touches.length === 0) return
		cursorX = e.touches[0].clientX
		cursorY = e.touches[0].clientY
		if (!cursorInside) cursorInside = true
		if (rafId === null) rafId = requestAnimationFrame(frame)
	}

	function onTouchEnd(): void {
		cursorInside = false
		if (rafId === null) rafId = requestAnimationFrame(frame)
	}

	const eventTarget = scope === 'document' ? document : element
	eventTarget.addEventListener('mousemove', onMouseMove as EventListener)
	eventTarget.addEventListener('mouseleave', onMouseLeave as EventListener)
	eventTarget.addEventListener('touchmove', onTouchMove as EventListener, { passive: true })
	eventTarget.addEventListener('touchend', onTouchEnd as EventListener)

	return () => {
		active = false
		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
		if (transitionTimer !== null) clearTimeout(transitionTimer)
		if (ro) ro.disconnect()
		window.removeEventListener('resize', invalidateCache)
		window.removeEventListener('orientationchange', invalidateCache)
		eventTarget.removeEventListener('mousemove', onMouseMove as EventListener)
		eventTarget.removeEventListener('mouseleave', onMouseLeave as EventListener)
		eventTarget.removeEventListener('touchmove', onTouchMove as EventListener)
		eventTarget.removeEventListener('touchend', onTouchEnd as EventListener)
		element.innerHTML = originalHTML
	}
}
