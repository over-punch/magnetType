// magnetType/src/core/adjust.ts — framework-agnostic magnetType: wraps words (word mode) or confusable
// characters (legibility mode) in place, keeping the text, markup and listeners, and varies their axes
// with cursor proximity around the author's own values.
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

/**
 * Maximum drift, in CSS pixels, tolerated in the target element's page geometry before
 * the cached span positions are rebuilt. Sub-pixel to absorb fractional rounding noise.
 */
const DRIFT_TOLERANCE = 0.5

/** Proximity points at which stabilizeLayout measures each word's width (interpolated between). */
const STABILIZE_SAMPLES = 9

/** Mouse events this long after a touch are the browser's compatibility events for that touch (ms). */
const TOUCH_MOUSE_GRACE_MS = 1000

/** Elements whose text is never wrapped: scripts, styles, form fields, SVG and other replaced content. */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'SELECT', 'OPTION', 'CANVAS', 'IFRAME', 'OBJECT', 'VIDEO', 'AUDIO', 'INPUT'])

/** Scripts written without spaces between words: split into words with Intl.Segmenter. */
const UNSPACED_SCRIPT = /[฀-໿က-႟ក-៿぀-ヿ㐀-䶿一-鿿豈-﫿]/

type Segmenter = { segment: (text: string) => Iterable<{ segment: string }> }
type SegmenterCtor = new (locale: undefined, opts: { granularity: 'grapheme' | 'word' }) => Segmenter
const SegmenterImpl: SegmenterCtor | null =
	typeof Intl !== 'undefined' && 'Segmenter' in Intl ? (Intl as unknown as { Segmenter: SegmenterCtor }).Segmenter : null
const graphemeSegmenter = SegmenterImpl ? new SegmenterImpl(undefined, { granularity: 'grapheme' }) : null
const wordSegmenter = SegmenterImpl ? new SegmenterImpl(undefined, { granularity: 'word' }) : null

/** Split text into graphemes (code points when Intl.Segmenter is unavailable). */
function graphemes(text: string): string[] {
	return graphemeSegmenter ? Array.from(graphemeSegmenter.segment(text), (s) => s.segment) : Array.from(text)
}

// ─── Warnings and validation ──────────────────────────────────────────────────

/** Warnings already printed, so a re-run warns once. */
const warned = new Set<string>()

/** Prints a console warning the first time it is seen. */
function warnOnce(message: string): void {
	if (warned.has(message)) return
	warned.add(message)
	console.warn(message)
}

/** A finite number, or the fallback (with a warning naming the option) when the value is not one. */
function finiteOr(value: unknown, fallback: number, name: string): number {
	if (value === undefined) return fallback
	if (typeof value === 'number' && Number.isFinite(value)) return value
	warnOnce(`[magnetType] ${name} must be a finite number; got ${String(value)}, using ${fallback}`)
	return fallback
}

/** A valid axes map: four-character tags with finite [rest, peak] values; anything else is dropped with a warning. */
function validAxes(axes: unknown): Record<string, [number, number]> {
	if (axes === undefined) return DEFAULTS.axes
	const out: Record<string, [number, number]> = {}
	if (axes && typeof axes === 'object') {
		for (const [tag, range] of Object.entries(axes as Record<string, unknown>)) {
			if (!/^[A-Za-z0-9]{4}$/.test(tag)) {
				warnOnce(`[magnetType] axis tags are four letters or digits; ignoring ${JSON.stringify(tag)}`)
				continue
			}
			if (!Array.isArray(range) || range.length !== 2 || !range.every((v) => typeof v === 'number' && Number.isFinite(v))) {
				warnOnce(`[magnetType] axes.${tag} must be [rest, peak] numbers; ignoring it`)
				continue
			}
			out[tag] = [range[0], range[1]]
		}
	}
	if (Object.keys(out).length === 0) {
		warnOnce('[magnetType] no valid axes; using wght [300, 500]')
		return DEFAULTS.axes
	}
	return out
}

/** Validated opacity/italic props (opacity values clamped to [0, 1]). */
function validProps(props: MagnetTypeProps | undefined): MagnetTypeProps | undefined {
	if (!props) return undefined
	const out: MagnetTypeProps = {}
	if (props.opacity !== undefined) {
		const [a, b] = props.opacity
		if (Number.isFinite(a) && Number.isFinite(b)) out.opacity = [Math.max(0, Math.min(1, a)), Math.max(0, Math.min(1, b))]
		else warnOnce('[magnetType] props.opacity must be two finite numbers; ignoring it')
	}
	if (props.italic === true) out.italic = true
	return out
}

/** Whether the reader asked for reduced motion. */
function reducedMotion(): boolean {
	return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
}

// ─── Font values ──────────────────────────────────────────────────────────────

/** Parse a computed font-variation-settings value into [tag, value] pairs. */
function parseAxes(fvs: string): [string, number][] {
	if (!fvs || fvs === 'normal') return []
	const out: [string, number][] = []
	for (const m of fvs.matchAll(/["']([^"']{4})["']\s+(-?[\d.]+(?:e[+-]?\d+)?)/gi)) out.push([m[1], parseFloat(m[2])])
	return out
}

/** The author's own font values for the text inside one element. */
interface FontBase {
	/** The element's font-variation-settings axes */
	axes: [string, number][]
	/** Axis value as rendered: from font-variation-settings, else font-weight (wght) or font-stretch (wdth) */
	value: (tag: string) => number | undefined
	/** Computed letter-spacing in px */
	letterSpacing: number
}

/** Read an element's font values. */
function readBase(el: Element): FontBase {
	const cs = getComputedStyle(el)
	const axes = parseAxes(cs.getPropertyValue?.('font-variation-settings') || cs.fontVariationSettings || '')
	const weight = parseFloat(cs.fontWeight)
	const stretch = parseFloat(cs.fontStretch)
	return {
		axes,
		value: (tag) => {
			const own = axes.find(([t]) => t === tag)?.[1]
			if (own !== undefined) return own
			if (tag === 'wght') return Number.isFinite(weight) ? weight : 400
			if (tag === 'wdth') return Number.isFinite(stretch) ? stretch : 100
			return undefined
		},
		letterSpacing: parseFloat(cs.letterSpacing) || 0,
	}
}

/** font-variation-settings for a span: its parent's axes with the given axes replaced or added. */
function mergeAxes(base: FontBase, values: Record<string, number>): string {
	const parts = base.axes.filter(([t]) => !(t in values)).map(([t, v]) => `"${t}" ${v}`)
	for (const [t, v] of Object.entries(values)) parts.push(`"${t}" ${+v.toFixed(2)}`)
	return parts.join(', ')
}

// ─── Per-element state ────────────────────────────────────────────────────────

/** One original text node and the nodes that replaced it. */
interface Wrapped {
	original: Text
	produced: Node[]
}

/** What a run changed on an element, so it can be undone exactly. */
interface ElementState {
	wrapped: Wrapped[]
	/** The element's markup before wrapping (what getCleanHTML returns) */
	cleanHTML: string
}

/** Per-element wrapping state. */
const states = new WeakMap<HTMLElement, ElementState>()

/** The stop function of the effect running on each element. */
const instances = new WeakMap<HTMLElement, () => void>()

/** Put the original text nodes back (keeping every element, its listeners and form values). */
function restore(element: HTMLElement): void {
	const state = states.get(element)
	if (!state) return
	for (const w of state.wrapped) {
		const first = w.produced.find((n) => n.parentNode)
		if (first?.parentNode) first.parentNode.insertBefore(w.original, first)
		w.produced.forEach((n) => n.parentNode?.removeChild(n))
	}
	states.delete(element)
}

/**
 * Returns the innerHTML of an element without magnetType markup. Exact for an element magnetType is
 * running on; for any other element, unwraps .mt-word and .mt-char spans. Idempotent.
 */
export function getCleanHTML(el: HTMLElement): string {
	const state = states.get(el)
	if (state) return state.cleanHTML
	const clone = el.cloneNode(true) as HTMLElement
	Array.from(clone.querySelectorAll(`.${MAGNET_TYPE_CLASSES.word}, .${MAGNET_TYPE_CLASSES.char}`)).reverse().forEach((node) => {
		const parent = node.parentNode
		if (!parent) return
		while (node.firstChild) parent.insertBefore(node.firstChild, node)
		parent.removeChild(node)
	})
	clone.normalize()
	return clone.innerHTML
}

/**
 * Stop magnetType on an element and restore it: the original text nodes come back, so elements keep
 * their listeners and form fields their values. If `originalHTML` is given and differs from the
 * restored markup, the element is reset to it.
 *
 * @security originalHTML is assigned to innerHTML without sanitization. Pass the value returned by
 * getCleanHTML() — never attacker-controlled input.
 */
export function removeMagnetType(element: HTMLElement, originalHTML?: string): void {
	if (!element) return
	instances.get(element)?.()
	restore(element)
	if (typeof originalHTML === 'string' && element.innerHTML !== originalHTML) element.innerHTML = originalHTML
}

/** Collect the text nodes under a root (recursive childNodes, not TreeWalker), skipping scripts, styles, fields and SVG. */
function collectTextNodes(root: Node, collected: Text[] = []): Text[] {
	root.childNodes.forEach((child) => {
		if (child.nodeType === Node.TEXT_NODE) collected.push(child as Text)
		else if (child.nodeType === Node.ELEMENT_NODE) {
			const el = child as HTMLElement
			if (SKIP_TAGS.has(el.nodeName.toUpperCase()) || el.isContentEditable) return
			collectTextNodes(el, collected)
		}
	})
	return collected
}

/** A piece of a text node: wrapped in a span (with a risk level in legibility mode) or left as text. */
type Piece = { text: string; wrap: boolean; risk?: number }

/** Word mode pieces: each word wrapped; spaces stay as text. Unspaced scripts are split into words. */
function wordPieces(text: string): Piece[] {
	const out: Piece[] = []
	for (const token of text.split(/(\s+)/)) {
		if (!token) continue
		if (/^\s+$/.test(token)) { out.push({ text: token, wrap: false }); continue }
		if (wordSegmenter && UNSPACED_SCRIPT.test(token)) {
			for (const s of wordSegmenter.segment(token)) out.push({ text: s.segment, wrap: true })
		} else {
			out.push({ text: token, wrap: true })
		}
	}
	return out
}

/** Legibility mode pieces: confusable graphemes wrapped (with their risk level); runs of other text left alone. */
function confusablePieces(text: string): Piece[] {
	const out: Piece[] = []
	for (const g of graphemes(text)) {
		const risk = CONFUSABLE[g[0]]
		if (risk !== undefined) out.push({ text: g, wrap: true, risk })
		else if (out.length && !out[out.length - 1].wrap) out[out.length - 1].text += g
		else out.push({ text: g, wrap: false })
	}
	return out
}

/** Wrap an element's text in place; returns the spans with their risk levels. */
function wrap(element: HTMLElement, split: (text: string) => Piece[], className: string): { span: HTMLElement; risk: number }[] {
	const cleanHTML = element.innerHTML
	const wrapped: Wrapped[] = []
	const spans: { span: HTMLElement; risk: number }[] = []
	for (const textNode of collectTextNodes(element)) {
		const text = textNode.data
		if (!text || !/\S/.test(text) || !textNode.parentNode) continue
		const pieces = split(text)
		if (!pieces.some((p) => p.wrap)) continue
		const produced: Node[] = pieces.map((p) => {
			if (!p.wrap) return document.createTextNode(p.text)
			const span = document.createElement('span')
			span.className = className
			span.textContent = p.text
			spans.push({ span, risk: p.risk ?? 0 })
			return span
		})
		const fragment = document.createDocumentFragment()
		produced.forEach((n) => fragment.appendChild(n))
		textNode.parentNode.replaceChild(fragment, textNode)
		wrapped.push({ original: textNode, produced })
	}
	states.set(element, { wrapped, cleanHTML })
	return spans
}

// ─── The shared effect ────────────────────────────────────────────────────────

/** Apply opacity/italic props for a proximity strength in [0, 1]. */
function applyProps(span: HTMLElement, props: MagnetTypeProps, strength: number): void {
	if (props.opacity !== undefined) {
		const [restOp, peakOp] = props.opacity
		span.style.opacity = (restOp + (peakOp - restOp) * strength).toFixed(3)
	}
	if (props.italic === true) span.style.fontStyle = strength > 0.5 ? 'italic' : ''
}

/** Page-relative geometry snapshot of an element. */
type AnchorRect = { left: number; top: number; width: number; height: number }

/** Read an element's geometry in page coordinates (viewport rect plus scroll offset). */
function readAnchor(element: HTMLElement): AnchorRect {
	const r = element.getBoundingClientRect()
	return { left: r.left + window.scrollX, top: r.top + window.scrollY, width: r.width, height: r.height }
}

/** True when the element has moved or resized beyond DRIFT_TOLERANCE since the anchor was captured. */
function hasDrifted(element: HTMLElement, anchor: AnchorRect | null): boolean {
	if (!anchor) return true
	const now = readAnchor(element)
	return Math.abs(now.left - anchor.left) > DRIFT_TOLERANCE || Math.abs(now.top - anchor.top) > DRIFT_TOLERANCE
		|| Math.abs(now.width - anchor.width) > DRIFT_TOLERANCE || Math.abs(now.height - anchor.height) > DRIFT_TOLERANCE
}

/** Runs one mode on an element; returns its stop function. */
function runEffect(element: HTMLElement, originalHTML: string, options: MagnetTypeOptions, kind: 'word' | 'legibility'): () => void {
	if (typeof window === 'undefined' || !element) return () => {}

	// One effect per element: stop and restore an earlier one. The element's current (wrapped) markup
	// passed back in means "the same content": keep it.
	const wrappedHTML = states.has(element) ? element.innerHTML : null
	instances.get(element)?.()
	restore(element)
	if (typeof originalHTML === 'string' && originalHTML !== wrappedHTML && element.innerHTML !== originalHTML) element.innerHTML = originalHTML

	// Under reduced motion the element is left untouched.
	if (reducedMotion()) return () => {}

	// --- Options ---
	let radius = finiteOr(options.radius, DEFAULTS.radius, 'radius')
	if (radius <= 0) {
		warnOnce(`[magnetType] radius must be greater than 0; using ${DEFAULTS.radius}`)
		radius = DEFAULTS.radius
	}
	const falloff = options.falloff === 'linear' ? 'linear' : 'quadratic'
	const repel = options.magnetMode === 'repel'
	const scope = options.scope === 'element' ? 'element' : 'document'
	const props = validProps(options.props)
	const transitionMs = Math.max(0, finiteOr(options.transitionMs, 0, 'transitionMs'))
	const cachePositions = options.cachePositions ?? true
	const axes = kind === 'word' ? validAxes(options.axes) : {}
	const wdthBoost = finiteOr(options.wdthBoost, DEFAULTS.wdthBoost, 'wdthBoost')
	const stabilize = kind === 'word' && (options.stabilizeLayout ?? true)

	const scrollY = window.scrollY

	// --- Wrap ---
	const items = kind === 'word'
		? wrap(element, wordPieces, MAGNET_TYPE_CLASSES.word)
		: wrap(element, confusablePieces, MAGNET_TYPE_CLASSES.char)
	const spans = items.map((i) => i.span)

	requestAnimationFrame(() => {
		if (Math.abs(window.scrollY - scrollY) > 2) window.scrollTo({ top: scrollY, behavior: 'instant' as ScrollBehavior })
	})

	if (spans.length === 0) {
		const stopEmpty = () => { if (instances.get(element) === stopEmpty) instances.delete(element); restore(element) }
		instances.set(element, stopEmpty)
		return stopEmpty
	}

	// --- The author's own values, read once per parent element ---
	const elementBase = readBase(element)
	const bases = new Map<Element, FontBase>()
	const spanBase = spans.map((s) => {
		const parent = s.parentElement ?? element
		let b = bases.get(parent)
		if (!b) { b = parent === element ? elementBase : readBase(parent); bases.set(parent, b) }
		return b
	})
	const graphemeCount = spans.map((s) => Math.max(1, graphemes(s.textContent ?? '').length))

	/** Axis values for a span at proximity t: the axes describe the element's own text; text with its own
	 *  weight (bold, light) or axes keeps its difference from the element. */
	const wordValues = (i: number, t: number): Record<string, number> => {
		const out: Record<string, number> = {}
		for (const [tag, [rest, peak]] of Object.entries(axes)) {
			const own = spanBase[i].value(tag)
			const ref = elementBase.value(tag)
			const offset = own !== undefined && ref !== undefined ? own - ref : 0
			let v = rest + (peak - rest) * t + offset
			if (tag === 'wght') v = Math.max(1, Math.min(1000, v))
			else if (tag === 'wdth') v = Math.max(1, v)
			out[tag] = v
		}
		return out
	}
	/** font-variation-settings for a span at proximity t. */
	const fvsAt = (i: number, t: number): string => {
		if (kind === 'word') return mergeAxes(spanBase[i], wordValues(i, t))
		const own = spanBase[i].value('wdth') ?? 100
		return mergeAxes(spanBase[i], { wdth: own + wdthBoost * (items[i].risk / 3) * t })
	}

	// --- stabilizeLayout: each word's own width change from rest, cancelled with letter-spacing. Width is
	// not linear in an axis value, so each word is measured at STABILIZE_SAMPLES points from rest to peak
	// (one layout each) and interpolated. ---
	/** widthGain[k][i]: word i's width at t = k / (STABILIZE_SAMPLES - 1), minus its width at rest. */
	let widthGain: Float64Array[] | null = null
	const measureWidths = (): boolean => {
		if (!stabilize) return true
		const saved = spans.map((s) => [s.style.fontVariationSettings, s.style.letterSpacing, s.style.transition])
		spans.forEach((s) => { s.style.transition = 'none'; s.style.letterSpacing = '' })
		const widths: number[][] = []
		for (let k = 0; k < STABILIZE_SAMPLES; k++) {
			const t = k / (STABILIZE_SAMPLES - 1)
			spans.forEach((s, i) => { s.style.fontVariationSettings = fvsAt(i, t) })
			widths.push(spans.map((s) => s.getBoundingClientRect().width))
		}
		spans.forEach((s, i) => {
			s.style.fontVariationSettings = saved[i][0]
			s.style.letterSpacing = saved[i][1]
			s.style.transition = saved[i][2]
		})
		if (!widths[0].some((w) => w > 0)) return false
		widthGain = widths.map((row) => Float64Array.from(row, (w, i) => w - widths[0][i]))
		return true
	}
	/** Word i's width gain at proximity t, interpolated between the measured samples. */
	const gainAt = (i: number, t: number): number => {
		const x = Math.max(0, Math.min(1, t)) * (STABILIZE_SAMPLES - 1)
		const k = Math.min(STABILIZE_SAMPLES - 2, Math.floor(x))
		const f = x - k
		return widthGain![k][i] * (1 - f) + widthGain![k + 1][i] * f
	}

	/** Last proximity written per span (-1 = not written), so unchanged spans are not rewritten. */
	const lastT = new Float64Array(spans.length).fill(-1)
	const lastStrength = new Float64Array(spans.length).fill(-1)

	/** Write one span's state for proximity strength s (rest: the cursor is gone — rest values in either mode). */
	const writeSpan = (i: number, strength: number, rest = false) => {
		const t = rest ? 0 : repel ? 1 - strength : strength
		const tq = Math.round(t * 1000) / 1000
		const sq = Math.round(strength * 1000) / 1000
		if (tq === lastT[i] && sq === lastStrength[i]) return
		const span = spans[i]
		if (kind === 'legibility' && tq === 0) {
			// At rest the character carries no styles of its own, so it shapes with its neighbours.
			span.style.removeProperty('font-variation-settings')
		} else {
			span.style.fontVariationSettings = fvsAt(i, tq)
		}
		if (stabilize && widthGain) {
			const comp = gainAt(i, tq) / graphemeCount[i]
			if (Math.abs(comp) < 0.0005) span.style.removeProperty('letter-spacing')
			else span.style.letterSpacing = `${(spanBase[i].letterSpacing - comp).toFixed(3)}px`
		}
		if (props) applyProps(span, props, sq)
		lastT[i] = tq
		lastStrength[i] = sq
	}

	// Rest state: words at their rest axes, confusable characters untouched.
	if (stabilize) measureWidths()
	for (let i = 0; i < spans.length; i++) writeSpan(i, 0, true)

	// --- Position cache (page-relative centres) ---
	let positions: { cx: number; cy: number }[] = []
	let cacheValid = false
	let anchor: AnchorRect | null = null
	const buildCache = () => {
		if (stabilize && !widthGain) measureWidths()
		const sx = window.scrollX
		const sy = window.scrollY
		anchor = readAnchor(element)
		positions = spans.map((span) => {
			const r = span.getBoundingClientRect()
			return { cx: (r.left + r.right) / 2 + sx, cy: (r.top + r.bottom) / 2 + sy }
		})
		cacheValid = anchor.width > 0 || anchor.height > 0
	}
	const invalidate = () => { cacheValid = false }
	let ro: ResizeObserver | null = null
	if (cachePositions) {
		buildCache()
		if (typeof ResizeObserver !== 'undefined') {
			ro = new ResizeObserver(invalidate)
			ro.observe(element)
		}
		window.addEventListener('resize', invalidate)
		window.addEventListener('orientationchange', invalidate)
	}
	const onFonts = () => { invalidate(); widthGain = null; if (cursorInside) schedule() }
	document.fonts?.addEventListener?.('loadingdone', onFonts)

	// --- Input ---
	let cursorX = 0
	let cursorY = 0
	let cursorInside = false
	let rafId: number | null = null
	let active = true
	let lastTouch = -Infinity
	let allRestLast = !repel
	let transitionTimer: ReturnType<typeof setTimeout> | null = null

	function frame(): void {
		rafId = null
		if (!active) return
		if (!element.isConnected) { stop(); return }

		if (!cursorInside) {
			// Cursor gone — back to rest, optionally with a transition.
			spans.forEach((span, i) => {
				if (transitionMs > 0) span.style.transition = `font-variation-settings ${transitionMs}ms ease, letter-spacing ${transitionMs}ms ease`
				writeSpan(i, 0, true)
			})
			// In repel mode a cursor far away means peak values, not rest, so the next frame must write.
			allRestLast = !repel
			if (transitionMs > 0) {
				if (transitionTimer !== null) clearTimeout(transitionTimer)
				transitionTimer = setTimeout(() => {
					spans.forEach((span) => span.style.removeProperty('transition'))
					transitionTimer = null
				}, transitionMs)
			}
			return
		}

		if (cachePositions && (!cacheValid || hasDrifted(element, anchor))) buildCache()
		const px = cachePositions ? cursorX + window.scrollX : cursorX
		const py = cachePositions ? cursorY + window.scrollY : cursorY

		// Far from the element and already at rest: nothing to do.
		const box = cachePositions ? anchor : null
		if (box && allRestLast) {
			const dx = Math.max(box.left - px, 0, px - (box.left + box.width))
			const dy = Math.max(box.top - py, 0, py - (box.top + box.height))
			if (dx * dx + dy * dy > radius * radius) return
		}

		const rects = cachePositions ? null : spans.map((span) => span.getBoundingClientRect())
		let allRest = true
		spans.forEach((span, i) => {
			if (span.style.transition) span.style.removeProperty('transition')
			let cx: number, cy: number
			if (cachePositions) ({ cx, cy } = positions[i])
			else { const r = rects![i]; cx = r.left + r.width / 2; cy = r.top + r.height / 2 }
			const dist = Math.hypot(px - cx, py - cy)
			const n = Math.max(0, 1 - dist / radius)
			const strength = falloff === 'quadratic' ? n * n : n
			if (strength > 0) allRest = false
			writeSpan(i, strength)
		})
		allRestLast = allRest
	}

	function schedule(): void {
		if (rafId === null) rafId = requestAnimationFrame(frame)
	}
	function onMouseMove(e: MouseEvent): void {
		// The browser's compatibility mouse events after a tap would leave the tapped word lit.
		if (performance.now() - lastTouch < TOUCH_MOUSE_GRACE_MS) return
		cursorX = e.clientX
		cursorY = e.clientY
		cursorInside = true
		schedule()
	}
	function onMouseLeave(): void {
		cursorInside = false
		schedule()
	}
	function onTouchMove(e: TouchEvent): void {
		lastTouch = performance.now()
		if (e.touches.length === 0) return
		cursorX = e.touches[0].clientX
		cursorY = e.touches[0].clientY
		cursorInside = true
		schedule()
	}
	function onTouchEnd(): void {
		lastTouch = performance.now()
		cursorInside = false
		schedule()
	}
	/** Scrolling under a still cursor moves the text: re-evaluate at the same cursor position. */
	function onScroll(): void {
		if (cursorInside) schedule()
	}

	const eventTarget: EventTarget = scope === 'document' ? document : element
	eventTarget.addEventListener('mousemove', onMouseMove as EventListener, { passive: true })
	eventTarget.addEventListener('mouseleave', onMouseLeave as EventListener)
	eventTarget.addEventListener('touchmove', onTouchMove as EventListener, { passive: true })
	eventTarget.addEventListener('touchend', onTouchEnd as EventListener, { passive: true })
	eventTarget.addEventListener('touchcancel', onTouchEnd as EventListener, { passive: true })
	window.addEventListener('scroll', onScroll, { passive: true, capture: true })

	// Stop (and restore) if the reader turns on reduced motion.
	const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
	const onMotion = () => { if (motionQuery?.matches) stop() }
	motionQuery?.addEventListener?.('change', onMotion)

	function stop(): void {
		if (!active) return
		active = false
		if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
		if (transitionTimer !== null) clearTimeout(transitionTimer)
		ro?.disconnect()
		window.removeEventListener('resize', invalidate)
		window.removeEventListener('orientationchange', invalidate)
		document.fonts?.removeEventListener?.('loadingdone', onFonts)
		eventTarget.removeEventListener('mousemove', onMouseMove as EventListener)
		eventTarget.removeEventListener('mouseleave', onMouseLeave as EventListener)
		eventTarget.removeEventListener('touchmove', onTouchMove as EventListener)
		eventTarget.removeEventListener('touchend', onTouchEnd as EventListener)
		eventTarget.removeEventListener('touchcancel', onTouchEnd as EventListener)
		window.removeEventListener('scroll', onScroll, { capture: true })
		motionQuery?.removeEventListener?.('change', onMotion)
		if (instances.get(element) === stop) instances.delete(element)
		restore(element)
	}
	instances.set(element, stop)
	return stop
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the legibility effect on an element: visually confusable characters (il1I, rn/m, 0O…) near
 * the cursor get a wdth boost proportional to their confusion risk, around the text's own width.
 * At rest the characters carry no styles of their own, so kerning and ligatures are kept. Needs a
 * font with a wdth axis.
 *
 * @param element      - Target element (in the live DOM and visible)
 * @param originalHTML - Clean HTML snapshot from getCleanHTML()
 * @param options      - MagnetTypeOptions; wdthBoost, radius, falloff, scope, props, transitionMs used
 * @returns            - A stop function. Call it to remove the listeners and restore the element.
 *
 * @security originalHTML is assigned to innerHTML (when it differs from the element) without
 * sanitization. Pass the value returned by getCleanHTML() — never attacker-controlled input.
 */
export function applyMagnetType(
	element: HTMLElement,
	originalHTML: string,
	options: MagnetTypeOptions = {},
): () => void {
	return runEffect(element, originalHTML, options, 'legibility')
}

/**
 * Start the cursor-field effect on an element: each word's axes move from their rest to their peak
 * values as the cursor approaches. The axes describe the element's own text; bold or light text inside
 * it keeps its difference, and other axes are kept. With stabilizeLayout (default), each word's width
 * change is cancelled with letter-spacing, so lines don't reflow. The text stays readable to screen
 * readers, and the element's markup and listeners are kept.
 *
 * @param element      - Target element (in the live DOM and visible)
 * @param originalHTML - Clean HTML snapshot from getCleanHTML()
 * @param options      - MagnetTypeOptions; axes, radius, falloff, magnetMode, scope, props used
 * @returns            - A stop function. Call it to remove the listeners and restore the element.
 *
 * @security originalHTML is assigned to innerHTML (when it differs from the element) without
 * sanitization. Pass the value returned by getCleanHTML() — never attacker-controlled input.
 */
export function startMagnetType(
	element: HTMLElement,
	originalHTML: string,
	options: MagnetTypeOptions = {},
): () => void {
	return runEffect(element, originalHTML, options, 'word')
}
