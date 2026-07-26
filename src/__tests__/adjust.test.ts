// magnetType/src/__tests__/adjust.test.ts — core algorithm tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { applyMagnetType, removeMagnetType, getCleanHTML, startMagnetType } from '../core/adjust'
import { MAGNET_TYPE_CLASSES } from '../core/types'

// ─── DOM measurement mock ─────────────────────────────────────────────────────

const CONTAINER_W = 600
const CHAR_W = 10

/**
 * Simulated layout shift applied to every mocked rect, in CSS pixels.
 * Lets a test move the element without changing its size — the exact case a
 * ResizeObserver cannot detect. Reset to 0,0 in beforeEach.
 */
const layoutOffset = { x: 0, y: 0 }

/** Build a mocked DOMRect at the given box, displaced by the current layoutOffset. */
function rect(left: number, top: number, width: number, height: number): DOMRect {
	const l = left + layoutOffset.x
	const t = top + layoutOffset.y
	return {
		width, height,
		left: l, right: l + width,
		top: t, bottom: t + height,
		x: l, y: t,
		toJSON: () => {},
	} as DOMRect
}

/**
 * Mocks offsetWidth on HTMLElement.prototype so happy-dom's constructor
 * `this.offsetWidth = 0` doesn't throw — the no-op setter absorbs it.
 * Also mocks getBoundingClientRect.
 * Returns a cleanup function restoring both originals.
 */
function mockMeasurement() {
	const proto = HTMLElement.prototype
	const priorOffsetWidth = Object.getOwnPropertyDescriptor(proto, 'offsetWidth')

	Object.defineProperty(proto, 'offsetWidth', {
		configurable: true,
		get: function (this: HTMLElement) {
			if (this.classList?.contains(MAGNET_TYPE_CLASSES.probe)) return 0
			if (this.classList?.contains(MAGNET_TYPE_CLASSES.char)) return CHAR_W
			if (this.classList?.contains(MAGNET_TYPE_CLASSES.word)) return CHAR_W * 5
			return CONTAINER_W
		},
		set: () => {},
	})

	const origBCR = Element.prototype.getBoundingClientRect
	Element.prototype.getBoundingClientRect = function (this: Element) {
		const el = this as HTMLElement
		// The probe is the one rect that must stay at the origin with zero size.
		if (el.classList?.contains(MAGNET_TYPE_CLASSES.probe)) {
			return { width: 0, top: 0, left: 0, bottom: 0, right: 0, height: 0, x: 0, y: 0, toJSON: () => {} } as DOMRect
		}
		if (el.classList?.contains(MAGNET_TYPE_CLASSES.char)) return rect(0, 0, CHAR_W, 20)
		if (el.classList?.contains(MAGNET_TYPE_CLASSES.word)) return rect(0, 0, CHAR_W * 5, 20)
		return rect(0, 0, CONTAINER_W, 20)
	}

	return () => {
		if (priorOffsetWidth) Object.defineProperty(proto, 'offsetWidth', priorOffsetWidth)
		Element.prototype.getBoundingClientRect = origBCR
	}
}

function makeElement(html: string): HTMLElement {
	const el = document.createElement('p')
	el.innerHTML = html
	el.style.width = `${CONTAINER_W}px`
	document.body.appendChild(el)
	return el
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('magnetType', () => {
	let cleanup: (() => void) | null = null

	beforeEach(() => {
		document.body.innerHTML = ''
		layoutOffset.x = 0
		layoutOffset.y = 0
		cleanup = mockMeasurement()
	})

	afterEach(() => {
		cleanup?.()
		cleanup = null
	})

	// ── getCleanHTML ────────────────────────────────────────────────────────────

	it('getCleanHTML is idempotent — same result when called twice on clean element', () => {
		const el = makeElement('<em>Hello</em> world')
		const html1 = getCleanHTML(el)
		const html2 = getCleanHTML(el)
		expect(html1).toBe(html2)
	})

	it('getCleanHTML strips injected char spans after applyMagnetType', () => {
		const el = makeElement('il1I fish')
		const original = getCleanHTML(el)
		const stop = applyMagnetType(el, original, { mode: 'legibility', wdthBoost: 6 })
		const cleaned = getCleanHTML(el)
		stop()
		expect(cleaned).not.toContain(MAGNET_TYPE_CLASSES.char)
		expect(cleaned).toBe(original)
	})

	it('getCleanHTML strips injected word spans after startMagnetType', () => {
		const el = makeElement('Hello world')
		const original = getCleanHTML(el)
		const stop = startMagnetType(el, original, { mode: 'field' })
		const cleaned = getCleanHTML(el)
		stop()
		expect(cleaned).not.toContain(MAGNET_TYPE_CLASSES.word)
	})

	// ── applyMagnetType — legibility mode ───────────────────────────────────────

	it('applyMagnetType does not throw on empty element', () => {
		const el = makeElement('')
		const original = getCleanHTML(el)
		expect(() => applyMagnetType(el, original, { mode: 'legibility' })).not.toThrow()
	})

	it('applyMagnetType does not throw on single word', () => {
		const el = makeElement('Hello')
		const original = getCleanHTML(el)
		expect(() => applyMagnetType(el, original, { mode: 'legibility' })).not.toThrow()
	})

	it('applyMagnetType returns a stop function', () => {
		const el = makeElement('il1I fish')
		const original = getCleanHTML(el)
		const stop = applyMagnetType(el, original, { mode: 'legibility', wdthBoost: 6 })
		expect(typeof stop).toBe('function')
		stop()
	})

	it('applyMagnetType wraps confusable characters in char spans', () => {
		// 'i', 'l', '1', 'I' are all risk-3 confusable
		const el = makeElement('il1I')
		const original = getCleanHTML(el)
		const stop = applyMagnetType(el, original, { mode: 'legibility', wdthBoost: 6 })
		const charSpans = el.querySelectorAll(`.${MAGNET_TYPE_CLASSES.char}`)
		// All 4 characters should be wrapped
		expect(charSpans.length).toBe(4)
		stop()
	})

	it('applyMagnetType char spans start at base wdth before cursor interaction', () => {
		// Before any cursor movement, all spans should be at base wdth (100)
		const el = makeElement('il1I')
		const original = getCleanHTML(el)
		const stop = applyMagnetType(el, original, { mode: 'legibility', wdthBoost: 6 })
		const charSpans = el.querySelectorAll<HTMLElement>(`.${MAGNET_TYPE_CLASSES.char}`)
		charSpans.forEach((span) => {
			expect(span.style.fontVariationSettings).toContain('"wdth" 100')
		})
		stop()
	})

	it('applyMagnetType applies wdth boost when cursor is directly over a char span', () => {
		// Capture rAF callback without auto-firing — avoids infinite recursion from frame self-scheduling
		let pendingRaf: FrameRequestCallback | null = null
		const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
			pendingRaf = cb; return 0
		})

		const el = makeElement('i')
		const original = getCleanHTML(el)
		// risk-3 char, wdthBoost 6, cursor at (5, 10) — char rect is {left:0, top:0, width:10, height:20}
		// center=(5,10), dist=0, strength=1, boost = 6 * (3/3) * 1 = 6, wdth = 106
		const stop = applyMagnetType(el, original, { mode: 'legibility', wdthBoost: 6, radius: 200 })

		// Flush scroll-restore rAF, then clear
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }

		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 10, bubbles: true }))
		// Fire the frame rAF once — updates spans, self-schedules another (which we don't fire)
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }

		const span = el.querySelector<HTMLElement>(`.${MAGNET_TYPE_CLASSES.char}`)
		expect(span?.style.fontVariationSettings).toContain('"wdth" 106')

		stop()
		rafSpy.mockRestore()
	})

	it('applyMagnetType applies partial wdth boost to risk-2 char at full strength', () => {
		let pendingRaf: FrameRequestCallback | null = null
		const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
			pendingRaf = cb; return 0
		})

		const el = makeElement('0')
		const original = getCleanHTML(el)
		// risk-2 char, wdthBoost 6, cursor centered on span: boost = 6 * (2/3) * 1 = 4, wdth = 104
		const stop = applyMagnetType(el, original, { mode: 'legibility', wdthBoost: 6, radius: 200 })
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }

		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 10, bubbles: true }))
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }

		const span = el.querySelector<HTMLElement>(`.${MAGNET_TYPE_CLASSES.char}`)
		expect(span?.style.fontVariationSettings).toContain('"wdth" 104')

		stop()
		rafSpy.mockRestore()
	})

	it('applyMagnetType applies partial wdth boost to risk-1 char at full strength', () => {
		let pendingRaf: FrameRequestCallback | null = null
		const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
			pendingRaf = cb; return 0
		})

		const el = makeElement('n')
		const original = getCleanHTML(el)
		// risk-1 char, wdthBoost 6, cursor centered: boost = 6 * (1/3) * 1 = 2, wdth = 102
		const stop = applyMagnetType(el, original, { mode: 'legibility', wdthBoost: 6, radius: 200 })
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }

		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 10, bubbles: true }))
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }

		const span = el.querySelector<HTMLElement>(`.${MAGNET_TYPE_CLASSES.char}`)
		expect(span?.style.fontVariationSettings).toContain('"wdth" 102')

		stop()
		rafSpy.mockRestore()
	})

	it('applyMagnetType does not wrap non-confusable characters', () => {
		// 'x', 'y', 'z' are not in CONFUSABLE
		const el = makeElement('xyz')
		const original = getCleanHTML(el)
		const stop = applyMagnetType(el, original, { mode: 'legibility', wdthBoost: 6 })
		const charSpans = el.querySelectorAll(`.${MAGNET_TYPE_CLASSES.char}`)
		expect(charSpans.length).toBe(0)
		stop()
	})

	it('applyMagnetType mixed: wraps only confusable chars in mixed string', () => {
		// 'a' is not confusable, 'i' is risk-3
		const el = makeElement('ai')
		const original = getCleanHTML(el)
		const stop = applyMagnetType(el, original, { mode: 'legibility', wdthBoost: 6 })
		const charSpans = el.querySelectorAll(`.${MAGNET_TYPE_CLASSES.char}`)
		// Only 'i' should be wrapped
		expect(charSpans.length).toBe(1)
		expect(charSpans[0].textContent).toBe('i')
		stop()
	})

	it('applyMagnetType preserves <em> and <strong> elements', () => {
		const el = makeElement('<em>italic</em> and <strong>bold</strong>')
		const original = getCleanHTML(el)
		const stop = applyMagnetType(el, original, { mode: 'legibility', wdthBoost: 6 })
		expect(el.querySelector('em')).toBeTruthy()
		expect(el.querySelector('strong')).toBeTruthy()
		stop()
	})

	it('applyMagnetType is idempotent — applying twice produces the same DOM structure', () => {
		const el = makeElement('il fish')
		const original = getCleanHTML(el)
		const stop1 = applyMagnetType(el, original, { mode: 'legibility', wdthBoost: 6 })
		const afterFirst = el.innerHTML
		stop1()

		const stop2 = applyMagnetType(el, original, { mode: 'legibility', wdthBoost: 6 })
		const afterSecond = el.innerHTML
		stop2()

		expect(afterSecond).toBe(afterFirst)
	})

	// ── removeMagnetType ────────────────────────────────────────────────────────

	it('removeMagnetType restores original HTML after legibility apply', () => {
		const el = makeElement('<em>ill</em> fish')
		const original = getCleanHTML(el)
		const stop = applyMagnetType(el, original, { mode: 'legibility', wdthBoost: 6 })
		stop()
		expect(el.innerHTML).toBe(original)
	})

	it('applyMagnetType stop function restores original HTML', () => {
		const el = makeElement('ill fish')
		const original = getCleanHTML(el)
		const stop = applyMagnetType(el, original, { mode: 'legibility', wdthBoost: 6 })
		stop()
		expect(el.innerHTML).toBe(original)
	})

	// ── startMagnetType — field mode ────────────────────────────────────────────

	it('startMagnetType returns a stop function without throwing', () => {
		const el = makeElement('Hello world typography')
		const original = getCleanHTML(el)
		let stop: (() => void) | undefined
		expect(() => {
			stop = startMagnetType(el, original, { mode: 'field' })
		}).not.toThrow()
		expect(typeof stop).toBe('function')
		stop?.()
	})

	it('startMagnetType wraps words in word spans', () => {
		const el = makeElement('Hello world')
		const original = getCleanHTML(el)
		const stop = startMagnetType(el, original, { mode: 'field' })
		const wordSpans = el.querySelectorAll(`.${MAGNET_TYPE_CLASSES.word}`)
		expect(wordSpans.length).toBe(2)
		stop()
	})

	it('startMagnetType stop function restores original HTML', () => {
		const el = makeElement('Hello world')
		const original = getCleanHTML(el)
		const stop = startMagnetType(el, original, { mode: 'field' })
		stop()
		expect(el.innerHTML).toBe(original)
	})

	it('startMagnetType does not crash on empty element', () => {
		const el = makeElement('')
		const original = getCleanHTML(el)
		let stop: (() => void) | undefined
		expect(() => {
			stop = startMagnetType(el, original, { mode: 'field' })
		}).not.toThrow()
		stop?.()
	})

	it('startMagnetType does not crash on single word', () => {
		const el = makeElement('Hello')
		const original = getCleanHTML(el)
		let stop: (() => void) | undefined
		expect(() => {
			stop = startMagnetType(el, original, { mode: 'field' })
		}).not.toThrow()
		stop?.()
	})

	it('startMagnetType responds to document mousemove by default (scope: document)', () => {
		let pendingRaf: FrameRequestCallback | null = null
		const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
			pendingRaf = cb; return 0
		})

		const el = makeElement('Hello world')
		const original = getCleanHTML(el)
		const stop = startMagnetType(el, original, { mode: 'field', axes: { wght: [300, 700] }, radius: 200 })

		// Flush scroll-restore rAF
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }

		// Dispatch on document — should drive the field even from outside the element
		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 2, clientY: 10, bubbles: true }))
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }

		// At least one word span should have a non-rest wght value
		const spans = Array.from(el.querySelectorAll<HTMLElement>(`.${MAGNET_TYPE_CLASSES.word}`))
		const anyBoosted = spans.some((span) =>
			span.style.fontVariationSettings !== '' &&
			!span.style.fontVariationSettings.includes('"wght" 300'),
		)
		expect(anyBoosted).toBe(true)

		stop()
		rafSpy.mockRestore()
	})

	it('startMagnetType scope: element responds to element mousemove', () => {
		let pendingRaf: FrameRequestCallback | null = null
		const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
			pendingRaf = cb; return 0
		})

		const el = makeElement('Hello world')
		const original = getCleanHTML(el)
		const stop = startMagnetType(el, original, { mode: 'field', scope: 'element', axes: { wght: [300, 700] } })

		// Flush scroll-restore rAF
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }

		// Dispatch mousemove directly on the element — should schedule the field loop rAF
		el.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 10, bubbles: true }))

		expect(pendingRaf).not.toBeNull()

		stop()
		rafSpy.mockRestore()
	})

	// ── props — opacity and italic ──────────────────────────────────────────────

	it('startMagnetType applies opacity prop on cursor proximity', () => {
		let pendingRaf: FrameRequestCallback | null = null
		const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
			pendingRaf = cb; return 0
		})

		const el = makeElement('Hello world')
		const original = getCleanHTML(el)
		const stop = startMagnetType(el, original, {
			mode: 'field',
			radius: 200,
			props: { opacity: [1, 0.5] },
		})
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }

		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 2, clientY: 10, bubbles: true }))
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }

		const spans = Array.from(el.querySelectorAll<HTMLElement>(`.${MAGNET_TYPE_CLASSES.word}`))
		const anyOpacity = spans.some((span) => span.style.opacity !== '' && span.style.opacity !== '1')
		expect(anyOpacity).toBe(true)

		stop()
		rafSpy.mockRestore()
	})

	// ── prefers-reduced-motion and SSR guards ───────────────────────────────────

	it('startMagnetType: prefers-reduced-motion restores originalHTML and returns noop stop', () => {
		vi.spyOn(window, 'matchMedia').mockReturnValue({
			matches: true, media: '', onchange: null, addListener: () => {}, removeListener: () => {},
			addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
		} as MediaQueryList)
		const el = makeElement('Hello world')
		const original = getCleanHTML(el)
		const stop = startMagnetType(el, original, { mode: 'field' })
		expect(el.innerHTML).toBe(original)
		expect(el.querySelectorAll(`.${MAGNET_TYPE_CLASSES.word}`).length).toBe(0)
		expect(typeof stop).toBe('function')
		expect(() => stop()).not.toThrow()
		vi.restoreAllMocks()
	})

	it('applyMagnetType: prefers-reduced-motion restores originalHTML and returns noop stop', () => {
		vi.spyOn(window, 'matchMedia').mockReturnValue({
			matches: true, media: '', onchange: null, addListener: () => {}, removeListener: () => {},
			addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
		} as MediaQueryList)
		const el = makeElement('il1I fish')
		const original = getCleanHTML(el)
		const stop = applyMagnetType(el, original, { mode: 'legibility', wdthBoost: 6 })
		expect(el.innerHTML).toBe(original)
		expect(el.querySelectorAll(`.${MAGNET_TYPE_CLASSES.char}`).length).toBe(0)
		expect(typeof stop).toBe('function')
		expect(() => stop()).not.toThrow()
		vi.restoreAllMocks()
	})

	it('startMagnetType: SSR guard does not throw when window is undefined', () => {
		const el = makeElement('Hello world')
		const original = getCleanHTML(el)
		const win = (globalThis as Record<string, unknown>).window
		delete (globalThis as Record<string, unknown>).window
		try {
			let stop: (() => void) | undefined
			expect(() => { stop = startMagnetType(el, original, {}) }).not.toThrow()
			expect(typeof stop).toBe('function')
		} finally {
			;(globalThis as Record<string, unknown>).window = win
		}
	})

	it('applyMagnetType applies opacity prop on cursor proximity', () => {
		let pendingRaf: FrameRequestCallback | null = null
		const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
			pendingRaf = cb; return 0
		})

		const el = makeElement('i')
		const original = getCleanHTML(el)
		const stop = applyMagnetType(el, original, {
			mode: 'legibility',
			radius: 200,
			props: { opacity: [1, 0.5] },
		})
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }

		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 10, bubbles: true }))
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }

		const span = el.querySelector<HTMLElement>(`.${MAGNET_TYPE_CLASSES.char}`)
		// At full strength (cursor centered on char), opacity should be peakValue = 0.5
		expect(span?.style.opacity).toBeTruthy()
		expect(parseFloat(span?.style.opacity ?? '1')).toBeLessThan(1)

		stop()
		rafSpy.mockRestore()
	})

	// ── position cache invalidation on layout shift ─────────────────────────────

	it('startMagnetType re-tracks the cursor after the element moves without resizing', () => {
		let pendingRaf: FrameRequestCallback | null = null
		const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
			pendingRaf = cb; return 0
		})

		const el = makeElement('Hello')
		const original = getCleanHTML(el)
		const stop = startMagnetType(el, original, {
			mode: 'word',
			axes: { wght: [300, 700] },
			radius: 100,
			cachePositions: true,
			stabilizeLayout: false,
		})
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }

		const span = () => el.querySelector<HTMLElement>(`.${MAGNET_TYPE_CLASSES.word}`)

		// Word centre starts at (25, 10). Cursor dead on it — full peak weight.
		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 25, clientY: 10, bubbles: true }))
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }
		expect(span()?.style.fontVariationSettings).toContain('"wght" 700')

		// Shift the whole element 500px right. Its size is unchanged, so a ResizeObserver
		// would never fire — only the per-frame drift check can catch this.
		layoutOffset.x = 500

		// Same cursor coordinates. The word is now 500px away, far outside radius 100,
		// so it must fall back to rest weight. Stale cache would still report 700.
		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 25, clientY: 10, bubbles: true }))
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }
		expect(span()?.style.fontVariationSettings).toContain('"wght" 300')

		// And the cursor at the word's new centre must reach peak again.
		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 525, clientY: 10, bubbles: true }))
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }
		expect(span()?.style.fontVariationSettings).toContain('"wght" 700')

		stop()
		rafSpy.mockRestore()
	})

	it('applyMagnetType re-tracks the cursor after the element moves without resizing', () => {
		let pendingRaf: FrameRequestCallback | null = null
		const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
			pendingRaf = cb; return 0
		})

		const el = makeElement('i')
		const original = getCleanHTML(el)
		const stop = applyMagnetType(el, original, {
			mode: 'legibility',
			radius: 100,
			wdthBoost: 9,
			cachePositions: true,
		})
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }

		const span = () => el.querySelector<HTMLElement>(`.${MAGNET_TYPE_CLASSES.char}`)

		// Char centre starts at (5, 10). Cursor dead on it — full boost (risk 3 → 9 + base 100).
		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 10, bubbles: true }))
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }
		expect(span()?.style.fontVariationSettings).toContain('"wdth" 109')

		// Move the element without resizing it.
		layoutOffset.x = 500

		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 10, bubbles: true }))
		if (pendingRaf) { pendingRaf(0); pendingRaf = null }
		expect(span()?.style.fontVariationSettings).toContain('"wdth" 100')

		stop()
		rafSpy.mockRestore()
	})

	it('startMagnetType registers and cleans up viewport resize listeners when caching', () => {
		const addSpy = vi.spyOn(window, 'addEventListener')
		const removeSpy = vi.spyOn(window, 'removeEventListener')

		const el = makeElement('Hello world')
		const original = getCleanHTML(el)
		const stop = startMagnetType(el, original, { cachePositions: true })

		const added = addSpy.mock.calls.map((c) => c[0])
		expect(added).toContain('resize')
		expect(added).toContain('orientationchange')

		stop()

		const removed = removeSpy.mock.calls.map((c) => c[0])
		expect(removed).toContain('resize')
		expect(removed).toContain('orientationchange')

		addSpy.mockRestore()
		removeSpy.mockRestore()
	})
})
