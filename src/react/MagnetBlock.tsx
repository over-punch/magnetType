// magnetType/src/react/MagnetChar.tsx — per-character cursor-proximity weight variation
'use client'

import React, { useRef, useCallback, useEffect, forwardRef, useMemo } from 'react'

export interface MagnetCharProps {
	children: React.ReactNode
	/** HTML element to render. Default: 'p' */
	as?: React.ElementType
	className?: string
	style?: React.CSSProperties
	minWeight?: number
	maxWeight?: number
	/** Pixel distance from the element edge within which the whole-element effect activates */
	proximityRadius?: number
	/** Pixel distance from the cursor within which each character's weight rises to max */
	spreadRadius?: number
	fixedAxes?: Record<string, number>
	/**
	 * Cache character centre positions in page-relative coordinates after first render,
	 * eliminating getBoundingClientRect calls on every mousemove. The cache is rebuilt when the
	 * element resizes, when the viewport resizes, after fonts load, and whenever a per-frame
	 * check detects the element has moved or changed size since the cache was built (one
	 * getBoundingClientRect per frame, not one per character).
	 * Disable if the block lives inside a custom scroll
	 * container (overflow: scroll on a non-window element) — page coordinates are derived
	 * from window.scrollX/Y and will be incorrect when a nested element is the scroll parent.
	 * @default true
	 */
	cachePositions?: boolean
	/**
	 * Throttle proximity updates to one per animation frame via requestAnimationFrame,
	 * capping the update rate at the display refresh rate. Disable if the ~16 ms rAF delay
	 * is perceptible — for example on 120 Hz displays or very tight, fast-moving effects.
	 * @default true
	 */
	rafThrottle?: boolean
	/**
	 * Apply compensating letter-spacing to keep line lengths stable as font weight changes.
	 * Measures the element's text width at rest and peak weight via an off-screen probe span,
	 * then applies proportional negative letter-spacing per character as weight rises,
	 * cancelling the advance-width increase that would otherwise cause text to reflow.
	 *
	 * Disable if you prefer natural bold letter-spacing, or if the font expands characters
	 * very unevenly across the weight axis (the compensation is a per-element average and
	 * may not perfectly cancel highly variable per-character expansion).
	 * @default true
	 */
	stabilizeLayout?: boolean
}

type CharPos = { cx: number; cy: number }
type ElemRect = { top: number; left: number; right: number; bottom: number }

/**
 * Maximum drift, in CSS pixels, tolerated in the element's page geometry before the cached
 * positions are rebuilt. Sub-pixel to absorb fractional rounding noise from
 * getBoundingClientRect without triggering spurious rebuilds.
 */
const DRIFT_TOLERANCE = 0.5

export const MagnetChar = forwardRef<HTMLElement, MagnetCharProps>(
	function MagnetChar(
		{
			children,
			as: Tag = 'p',
			className,
			style,
			minWeight = 300,
			maxWeight = 600,
			proximityRadius,
			spreadRadius,
			fixedAxes = {},
			cachePositions = true,
			rafThrottle = true,
			stabilizeLayout = true,
		},
		forwardedRef,
	) {
		const innerRef = useRef<HTMLElement>(null)
		const lastPos = useRef<{ x: number; y: number } | null>(null)
		const charSpansRef = useRef<(HTMLSpanElement | null)[]>([])

		// Position cache — page-relative centres, invalidated on resize/font-load/content change
		const charCacheRef = useRef<CharPos[]>([])
		const elemCacheRef = useRef<ElemRect | null>(null)
		const cacheValidRef = useRef(false)

		// rAF handle — one pending frame at a time
		const rafIdRef = useRef<number | null>(null)

		// Per-character advance-width delta between minWeight and maxWeight (px)
		const perCharDeltaRef = useRef(0)

		const mergedRef = useCallback(
			(node: HTMLElement | null) => {
				// innerRef is typed as RefObject but is a MutableRefObject at runtime — write via minimal cast
				;(innerRef as { current: HTMLElement | null }).current = node
				if (typeof forwardedRef === 'function') forwardedRef(node)
				else if (forwardedRef) forwardedRef.current = node
			},
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[forwardedRef],
		)

		function buildVS(weight: number) {
			const parts = [`'wght' ${weight.toFixed(0)}`]
			for (const [tag, val] of Object.entries(fixedAxes)) parts.push(`'${tag}' ${val}`)
			return parts.join(', ')
		}

		function buildCache() {
			const el = innerRef.current
			if (!el) return
			const sx = window.scrollX
			const sy = window.scrollY
			const er = el.getBoundingClientRect()
			elemCacheRef.current = {
				top:    er.top    + sy,
				left:   er.left   + sx,
				right:  er.right  + sx,
				bottom: er.bottom + sy,
			}
			charCacheRef.current = charSpansRef.current.map(span => {
				if (!span) return { cx: 0, cy: 0 }
				const r = span.getBoundingClientRect()
				return {
					cx: (r.left + r.right) / 2 + sx,
					cy: (r.top  + r.bottom) / 2 + sy,
				}
			})
			cacheValidRef.current = true
		}

		/**
		 * True when the element has moved or resized beyond DRIFT_TOLERANCE since the cache was
		 * built. Costs a single getBoundingClientRect per frame — regardless of character count —
		 * and catches layout shifts a ResizeObserver cannot see, notably an element repositioned
		 * without any change to its own size (vertically centred hero, max-width container, zoom,
		 * mobile URL-bar collapse, content reflowing above the element).
		 */
		function hasDrifted() {
			const el = innerRef.current
			const cached = elemCacheRef.current
			if (!el || !cached) return true
			const r = el.getBoundingClientRect()
			const sx = window.scrollX
			const sy = window.scrollY
			return (
				Math.abs(r.left   + sx - cached.left)   > DRIFT_TOLERANCE ||
				Math.abs(r.top    + sy - cached.top)    > DRIFT_TOLERANCE ||
				Math.abs(r.right  + sx - cached.right)  > DRIFT_TOLERANCE ||
				Math.abs(r.bottom + sy - cached.bottom) > DRIFT_TOLERANCE
			)
		}

		function applyProximity(clientX: number, clientY: number) {
			const el = innerRef.current
			if (!el) return

			if (cachePositions && (!cacheValidRef.current || hasDrifted())) buildCache()

			// Resolve cursor and element bounds in a common coordinate space.
			// With cache: page-relative (cursor adjusted by scroll). Without: viewport-relative.
			let elTop: number, elLeft: number, elRight: number, elBottom: number
			let curX: number, curY: number

			if (cachePositions && elemCacheRef.current) {
				curX = clientX + window.scrollX
				curY = clientY + window.scrollY
				;({ top: elTop, left: elLeft, right: elRight, bottom: elBottom } = elemCacheRef.current)
			} else {
				const rect = el.getBoundingClientRect()
				curX = clientX; curY = clientY
				elTop = rect.top; elLeft = rect.left; elRight = rect.right; elBottom = rect.bottom
			}

			const dx = Math.max(elLeft - curX, 0, curX - elRight)
			const dy = Math.max(elTop  - curY, 0, curY - elBottom)
			const distToEdge = Math.sqrt(dx * dx + dy * dy)

			// Whole-element effect only (no spreadRadius)
			if (proximityRadius !== undefined && !spreadRadius) {
				const proximity = Math.max(0, 1 - distToEdge / proximityRadius)
				const eased = 1 - (1 - proximity) ** 2
				el.style.fontVariationSettings = buildVS(minWeight + (maxWeight - minWeight) * eased)
				return
			}

			if (spreadRadius) {
				// proximityRadius gate
				if (proximityRadius !== undefined && distToEdge > proximityRadius) {
					el.style.fontVariationSettings = buildVS(minWeight)
					for (const span of charSpansRef.current) {
						if (!span) continue
						span.style.fontVariationSettings = buildVS(minWeight)
						if (stabilizeLayout) span.style.letterSpacing = ''
					}
					return
				}

				// Element-level pre-filter: when the cursor is farther than spreadRadius from
				// the element edge, every character is guaranteed to be out of range too —
				// skip all per-character work.
				if (distToEdge > spreadRadius) {
					for (const span of charSpansRef.current) {
						if (!span) continue
						span.style.fontVariationSettings = buildVS(minWeight)
						if (stabilizeLayout) span.style.letterSpacing = ''
					}
					return
				}

				const spans = charSpansRef.current
				if (cachePositions && charCacheRef.current.length === spans.length) {
					// Fast path: zero getBoundingClientRect calls, pure array math
					for (let i = 0; i < spans.length; i++) {
						const span = spans[i]
						if (!span) continue
						const { cx, cy } = charCacheRef.current[i]
						const dist = Math.sqrt((curX - cx) ** 2 + (curY - cy) ** 2)
						const proximity = Math.max(0, 1 - dist / spreadRadius)
						const eased = 1 - (1 - proximity) ** 2
						span.style.fontVariationSettings = buildVS(minWeight + (maxWeight - minWeight) * eased)
						if (stabilizeLayout && perCharDeltaRef.current !== 0) {
							span.style.letterSpacing = `${(-perCharDeltaRef.current * eased).toFixed(3)}px`
						}
					}
				} else {
					// Fallback: live getBoundingClientRect per span (cachePositions=false or cache length mismatch).
					// Batch-read all rects first, then write all styles — avoids read-write interleaving
					// that forces one layout flush per character.
					const liveCentres = spans.map(span => {
						if (!span) return { cx: 0, cy: 0 }
						const sr = span.getBoundingClientRect()
						return { cx: (sr.left + sr.right) / 2, cy: (sr.top + sr.bottom) / 2 }
					})
					for (let i = 0; i < spans.length; i++) {
						const span = spans[i]
						if (!span) continue
						const { cx, cy } = liveCentres[i]
						const dist = Math.sqrt((clientX - cx) ** 2 + (clientY - cy) ** 2)
						const proximity = Math.max(0, 1 - dist / spreadRadius)
						const eased = 1 - (1 - proximity) ** 2
						span.style.fontVariationSettings = buildVS(minWeight + (maxWeight - minWeight) * eased)
						if (stabilizeLayout && perCharDeltaRef.current !== 0) {
							span.style.letterSpacing = `${(-perCharDeltaRef.current * eased).toFixed(3)}px`
						}
					}
				}
			}
		}

		const handleMouseMove = useCallback(
			(e: MouseEvent) => {
				lastPos.current = { x: e.clientX, y: e.clientY }
				if (rafThrottle) {
					// Only schedule one frame at a time; use lastPos so we always get the newest coords
					if (rafIdRef.current === null) {
						rafIdRef.current = requestAnimationFrame(() => {
							rafIdRef.current = null
							if (lastPos.current) applyProximity(lastPos.current.x, lastPos.current.y)
						})
					}
				} else {
					applyProximity(e.clientX, e.clientY)
				}
			},
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[minWeight, maxWeight, proximityRadius, spreadRadius, cachePositions, rafThrottle, stabilizeLayout, JSON.stringify(fixedAxes)],
		)

		const handleScroll = useCallback(
			() => {
				if (!lastPos.current) return
				// Invalidate the cache so the next applyProximity call re-reads positions at new scroll offsets
				cacheValidRef.current = false
				// Apply rAF throttle (same as handleMouseMove) to avoid layout thrash on fast scroll
				if (rafThrottle) {
					if (rafIdRef.current === null) {
						rafIdRef.current = requestAnimationFrame(() => {
							rafIdRef.current = null
							if (lastPos.current) applyProximity(lastPos.current.x, lastPos.current.y)
						})
					}
				} else {
					applyProximity(lastPos.current.x, lastPos.current.y)
				}
			},
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[minWeight, maxWeight, proximityRadius, spreadRadius, cachePositions, rafThrottle, stabilizeLayout, JSON.stringify(fixedAxes)],
		)

		const handleMouseLeave = useCallback(
			() => {
				lastPos.current = null
				if (rafIdRef.current !== null) {
					cancelAnimationFrame(rafIdRef.current)
					rafIdRef.current = null
				}
				const el = innerRef.current
				if (el) el.style.fontVariationSettings = buildVS(minWeight)
				for (const span of charSpansRef.current) {
					if (!span) continue
					span.style.fontVariationSettings = buildVS(minWeight)
					if (stabilizeLayout) span.style.letterSpacing = ''
				}
			},
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[minWeight, stabilizeLayout, JSON.stringify(fixedAxes)],
		)

		/** Mirror of handleMouseMove for touch — uses first touch point coordinates */
		const handleTouchMove = useCallback(
			(e: TouchEvent) => {
				if (e.touches.length === 0) return
				const touch = e.touches[0]
				lastPos.current = { x: touch.clientX, y: touch.clientY }
				if (rafThrottle) {
					if (rafIdRef.current === null) {
						rafIdRef.current = requestAnimationFrame(() => {
							rafIdRef.current = null
							if (lastPos.current) applyProximity(lastPos.current.x, lastPos.current.y)
						})
					}
				} else {
					applyProximity(touch.clientX, touch.clientY)
				}
			},
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[minWeight, maxWeight, proximityRadius, spreadRadius, cachePositions, rafThrottle, stabilizeLayout, JSON.stringify(fixedAxes)],
		)

		/** Reset weights to minimum when touch ends (mirrors mouseleave behaviour) */
		const handleTouchEnd = useCallback(
			() => {
				lastPos.current = null
				if (rafIdRef.current !== null) {
					cancelAnimationFrame(rafIdRef.current)
					rafIdRef.current = null
				}
				const el = innerRef.current
				if (el) el.style.fontVariationSettings = buildVS(minWeight)
				for (const span of charSpansRef.current) {
					if (!span) continue
					span.style.fontVariationSettings = buildVS(minWeight)
					if (stabilizeLayout) span.style.letterSpacing = ''
				}
			},
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[minWeight, stabilizeLayout, JSON.stringify(fixedAxes)],
		)

		useEffect(() => {
			// Respect prefers-reduced-motion — skip all interaction if the user prefers reduced motion
			if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return

			const el = innerRef.current
			window.addEventListener('mousemove', handleMouseMove, { passive: true })
			window.addEventListener('scroll', handleScroll, { passive: true, capture: true })
			window.addEventListener('touchmove', handleTouchMove, { passive: true })
			window.addEventListener('touchend', handleTouchEnd)
			// Attach mouseleave to the element itself so weights reset when the cursor
			// leaves the block (not just when it exits the viewport).
			if (el) el.addEventListener('mouseleave', handleMouseLeave)
			return () => {
				window.removeEventListener('mousemove', handleMouseMove)
				window.removeEventListener('scroll', handleScroll, { capture: true })
				window.removeEventListener('touchmove', handleTouchMove)
				window.removeEventListener('touchend', handleTouchEnd)
				if (el) el.removeEventListener('mouseleave', handleMouseLeave)
				if (rafIdRef.current !== null) {
					cancelAnimationFrame(rafIdRef.current)
					rafIdRef.current = null
				}
			}
		}, [handleMouseMove, handleScroll, handleTouchMove, handleTouchEnd, handleMouseLeave])

		// ResizeObserver + viewport-resize + font-load cache invalidation.
		// Not gated on spreadRadius — the element-bounds half of the cache (elemCacheRef) is
		// used by the whole-element proximityRadius path too, and needs invalidating there.
		useEffect(() => {
			if (!cachePositions) return
			cacheValidRef.current = false
			const invalidate = () => { cacheValidRef.current = false }
			// ResizeObserver only fires when the element's own box changes size. A viewport
			// resize that merely repositions it leaves the cache stale, so listen for resize
			// directly as well.
			window.addEventListener('resize', invalidate)
			window.addEventListener('orientationchange', invalidate)
			document.fonts?.ready?.then(invalidate)
			const el = innerRef.current
			const ro = el ? new ResizeObserver(invalidate) : null
			if (el && ro) ro.observe(el)
			return () => {
				window.removeEventListener('resize', invalidate)
				window.removeEventListener('orientationchange', invalidate)
				if (ro) ro.disconnect()
			}
		}, [cachePositions, spreadRadius])

		// Invalidate cache when children or spreadRadius change (spans are re-rendered)
		useEffect(() => {
			cacheValidRef.current = false
		}, [children, spreadRadius])

		// Measure per-character advance-width delta for layout stabilization.
		// Uses an off-screen probe span so character spans' inline FVS don't interfere.
		// Re-runs after fonts load to ensure the variable font is active during measurement.
		useEffect(() => {
			if (!stabilizeLayout || !spreadRadius) {
				perCharDeltaRef.current = 0
				return
			}

			function measure() {
				const el = innerRef.current
				if (!el) return
				const rawText = el.textContent ?? ''
				const nonSpaceCount = rawText.replace(/\s/g, '').length
				if (nonSpaceCount === 0) return
				const cs = getComputedStyle(el)
				const probe = document.createElement('span')
				probe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;visibility:hidden;white-space:nowrap;pointer-events:none;'
				probe.style.fontFamily = cs.fontFamily
				probe.style.fontSize = cs.fontSize
				probe.style.fontWeight = cs.fontWeight
				probe.style.lineHeight = cs.lineHeight
				probe.style.letterSpacing = cs.letterSpacing
				probe.textContent = rawText
				document.body.appendChild(probe)
				// try/finally ensures the probe span is always removed even if an exception is thrown
				try {
					const buildFVS = (w: number) => {
						const parts = [`'wght' ${w.toFixed(0)}`]
						for (const [tag, val] of Object.entries(fixedAxes)) parts.push(`'${tag}' ${val}`)
						return parts.join(', ')
					}
					probe.style.fontVariationSettings = buildFVS(maxWeight)
					const wMax = probe.scrollWidth
					probe.style.fontVariationSettings = buildFVS(minWeight)
					const wMin = probe.scrollWidth
					perCharDeltaRef.current = wMax > wMin ? (wMax - wMin) / nonSpaceCount : 0
				} finally {
					document.body.removeChild(probe)
				}
			}

			measure()
			document.fonts?.ready?.then(measure)
		// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [stabilizeLayout, spreadRadius, minWeight, maxWeight, children, JSON.stringify(fixedAxes)])

		/** Extract plain text from React children for use as aria-label */
		const ariaLabel = useMemo(() => {
			if (!spreadRadius) return undefined
			function extractText(node: React.ReactNode): string {
				if (typeof node === 'string' || typeof node === 'number') return String(node)
				if (Array.isArray(node)) return node.map(extractText).join('')
				if (React.isValidElement(node)) {
					const el = node as React.ReactElement<{ children?: React.ReactNode }>
					return extractText(el.props.children)
				}
				return ''
			}
			return extractText(children) || undefined
		}, [children, spreadRadius])

		const processedChildren = useMemo(() => {
			if (!spreadRadius) return children

			charSpansRef.current = []
			let idx = 0

			function processNode(node: React.ReactNode): React.ReactNode {
				if (typeof node === 'string') {
					return [...node].map(char => {
						if (/\s/.test(char)) return char
						const i = idx++
						return (
							<span
								key={i}
								ref={el => { charSpansRef.current[i] = el }}
								aria-hidden="true"
								style={{ fontVariationSettings: buildVS(minWeight) }}
							>
								{char}
							</span>
						)
					})
				}
				if (Array.isArray(node)) return node.map((n, i) => <React.Fragment key={i}>{processNode(n)}</React.Fragment>)
				if (React.isValidElement(node)) {
					const el = node as React.ReactElement<{ children?: React.ReactNode }>
					if (el.props.children !== undefined) {
						return React.cloneElement(el, {}, processNode(el.props.children))
					}
				}
				return node
			}

			return processNode(children)
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [children, spreadRadius, minWeight, JSON.stringify(fixedAxes)])

		return (
			<Tag
				ref={mergedRef}
				className={className}
				aria-label={ariaLabel}
				style={{ fontVariationSettings: buildVS(minWeight), ...style }}
			>
				{processedChildren}
			</Tag>
		)
	},
)

MagnetChar.displayName = 'MagnetChar'

/** @deprecated Use MagnetChar instead */
export const MagnetBlock = MagnetChar
/** @deprecated Use MagnetCharProps instead */
export type MagnetBlockProps = MagnetCharProps
