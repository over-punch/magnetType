// magnetType/src/react/useMagnetType.ts — React hook for magnetType
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { startMagnetType, applyMagnetType, getCleanHTML } from '../core/adjust'
import type { MagnetTypeOptions } from '../core/types'

/**
 * React hook that applies the magnetType effect to a ref'd element.
 *
 * For mode: 'word' — starts the cursor proximity rAF loop via startMagnetType.
 * For mode: 'legibility' — starts the cursor-driven wdth boost via applyMagnetType.
 *
 * Both modes return a stop function on mount and restart when options change.
 * When cachePositions is true (the default), the position cache is rebuilt on element
 * resize, viewport resize, font load, and whenever a per-frame drift check detects the
 * element has moved. Set cachePositions: false to disable caching entirely.
 *
 * Defaults to 'word' mode if mode is undefined.
 */
export function useMagnetType(options: MagnetTypeOptions) {
	const ref = useRef<HTMLElement>(null)
	const originalHTMLRef = useRef<string | null>(null)
	const optionsRef = useRef(options)
	optionsRef.current = options
	const stopRef = useRef<(() => void) | null>(null)

	// Determine which mode we're in — default to 'word'; 'field' is an alias for 'word'
	const mode = options.mode ?? 'word'

	// Destructure options that should trigger a re-run when changed
	const { axes, radius, falloff, magnetMode, wdthBoost, scope } = options
	// Serialise objects for dependency comparison (identity would always trigger)
	const axesKey = axes ? JSON.stringify(axes) : undefined
	const propsKey = options.props ? JSON.stringify(options.props) : undefined

	const run = useCallback(() => {
		const el = ref.current
		if (!el) return

		if (originalHTMLRef.current === null) {
			originalHTMLRef.current = getCleanHTML(el)
		}

		// Stop any running loop before re-running
		if (stopRef.current) {
			stopRef.current()
			stopRef.current = null
		}

		const currentMode = optionsRef.current.mode ?? 'word'

		// 'field' is an accepted alias for 'word'
		if (currentMode === 'word' || currentMode === 'field') {
			stopRef.current = startMagnetType(el, originalHTMLRef.current, optionsRef.current)
		} else {
			stopRef.current = applyMagnetType(el, originalHTMLRef.current, optionsRef.current)
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mode, axesKey, radius, falloff, magnetMode, wdthBoost, scope, propsKey])

	useLayoutEffect(() => {
		run()

		return () => {
			if (stopRef.current) {
				stopRef.current()
				stopRef.current = null
			}
		}
	}, [run])

	// Re-run after fonts load — ensures measurements are taken on the loaded font.
	// The mounted guard prevents calling run on a detached element if the component
	// unmounts before fonts finish loading, and avoids redundant re-runs when
	// document.fonts.ready is already resolved (synchronous .then firing).
	useEffect(() => {
		let mounted = true
		document.fonts?.ready?.then(() => {
			if (mounted) run()
		})
		return () => { mounted = false }
	}, [run])

	return ref
}
