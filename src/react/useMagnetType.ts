// magnetType/src/react/useMagnetType.ts — React hook for magnetType: starts the chosen mode on the
// element, restarts when any option or the content changes, re-measures once fonts load, stops on unmount.
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { startMagnetType, applyMagnetType, getCleanHTML } from '../core/adjust'
import type { MagnetTypeOptions } from '../core/types'

/**
 * React hook that applies the magnetType effect to a ref'd element.
 * mode 'word' (or its alias 'field') runs startMagnetType; mode 'legibility' runs applyMagnetType.
 *
 * @param options    - MagnetTypeOptions
 * @param contentKey - A value that changes when the element's content changes (MagnetTypeText derives one
 *                     from its children). The library rewrites the element's text nodes, so new content
 *                     needs a fresh element and a fresh snapshot.
 */
export function useMagnetType(options: MagnetTypeOptions = {}, contentKey?: string) {
	const ref = useRef<HTMLElement>(null)
	const originalHTMLRef = useRef<string | null>(null)
	/** The element originalHTMLRef was read from; a new element is read afresh. */
	const sourceElRef = useRef<HTMLElement | null>(null)
	const optionsRef = useRef(options)
	optionsRef.current = options
	const stopRef = useRef<(() => void) | null>(null)

	// Every option is a dependency (serialised, so an inline object doesn't re-run every render).
	const optionsKey = JSON.stringify(options)

	const run = useCallback(() => {
		const el = ref.current
		if (!el) return
		stopRef.current?.()
		stopRef.current = null
		if (originalHTMLRef.current === null || sourceElRef.current !== el) {
			originalHTMLRef.current = getCleanHTML(el)
			sourceElRef.current = el
		}
		const mode = optionsRef.current.mode ?? 'word'
		stopRef.current = mode === 'legibility'
			? applyMagnetType(el, originalHTMLRef.current, optionsRef.current)
			: startMagnetType(el, originalHTMLRef.current, optionsRef.current)
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [optionsKey, contentKey])

	useLayoutEffect(() => {
		run()
		return () => {
			stopRef.current?.()
			stopRef.current = null
		}
	}, [run])

	// Re-run once fonts finish loading (not when they already have — a second rebuild on mount).
	useEffect(() => {
		if (typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded') return
		let mounted = true
		document.fonts.ready.then(() => { if (mounted) run() }).catch(() => {})
		return () => { mounted = false }
	}, [run])

	return ref
}
