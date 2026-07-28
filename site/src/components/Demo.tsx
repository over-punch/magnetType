"use client"

// Interactive demo for magnetType — word mode, legibility mode, and character mode
import { useState, useDeferredValue, useEffect, useCallback, useMemo, useId } from "react"
import { useMediaQuery, useClientValue } from "@/lib/clientValue"
import { MagnetTypeText, MagnetChar } from "@liiift-studio/magnettype"
import type { MagnetTypeModeType, FalloffType, MagnetModeType } from "@liiift-studio/magnettype"

/** Prose paragraphs for word mode demo */
const FIELD_PARAGRAPHS = [
	`Typography has always been a conversation between the reader and the page. The characters on a printed sheet are fixed — their weight, their spacing, their axis values locked at the moment of setting. But type on screen can breathe, respond, move.`,
	`Variable fonts make every letterform a dial. The weight axis can thicken a stroke from hairline to slab; the width axis can compress a condensed face or expand it to full measure. These were tools for the typesetter, applied once at design time. Magnet Type applies them continuously, in real time, driven by where the cursor happens to be.`,
	`Move your cursor through the paragraph above. Words in the field attract toward their peak weight, then settle back as the cursor passes. The effect is subtle — not animation, not distraction — just a living texture that responds to presence. The text remains entirely readable throughout.`,
]

/** Confusable character text for legibility mode */
const LEGIBILITY_TEXT = `Millennial criminal inflaming rill: distinguish il, 1I, rn, 0O at every size. Rindfleisch, millennium, ringtail, infiltration.`

/** Gyro icon — spinning dial indicating device orientation control */
function GyroIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
			<circle cx="7" cy="7" r="5.5" />
			<circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
			<path d="M7 1.5 A5.5 5.5 0 0 1 12.5 7" strokeWidth="1.4" />
			<path d="M11.5 5.5 L12.5 7 L13.8 6" strokeWidth="1.2" />
		</svg>
	)
}

/** Slider sub-component with label, value display, and aria linkage between input and value readout */
function Slider({ label, value, min, max, step, onChange, title }: {
	label: string
	value: number
	min: number
	max: number
	step: number
	onChange: (v: number) => void
	title?: string
}) {
	const valueId = useId()
	return (
		<div className="flex flex-col gap-1">
			<span className="text-xs uppercase tracking-[0.18em] font-medium text-muted">{label}</span>
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				aria-label={label}
				aria-describedby={valueId}
				title={title}
				onChange={e => onChange(Number(e.target.value))}
				onTouchStart={e => e.stopPropagation()}
				style={{ touchAction: 'pan-y' }}
			/>
			<span id={valueId} className="tabular-nums text-xs text-muted text-right">{value}</span>
		</div>
	)
}

/** Toggle button row — highlights the active option; group label is announced by screen readers */
function ToggleGroup<T extends string>({ label, options, value, onChange, titles }: {
	label: string
	options: readonly T[]
	value: T
	onChange: (v: T) => void
	/** Optional tooltip for each option, keyed by option value */
	titles?: Partial<Record<T, string>>
}) {
	const labelId = useId()
	return (
		<div role="group" aria-labelledby={labelId} className="contents">
			<span id={labelId} className="text-xs uppercase tracking-[0.18em] font-medium text-muted">{label}</span>
			{options.map(v => (
				<button
					key={v}
					onClick={() => onChange(v)}
					aria-pressed={value === v}
					title={titles?.[v]}
					className="text-xs px-3 py-1 rounded-full border transition-opacity"
					style={{
						borderColor: 'currentColor',
						opacity: value === v ? 1 : 0.5,
						background: value === v ? 'var(--btn-bg)' : 'transparent',
					}}
				>
					{v}
				</button>
			))}
		</div>
	)
}

/** Boolean toggle button — highlights when active; accepts an optional aria-label for stable accessible names */
function ToggleButton({ label, value, onChange, icon, title, 'aria-label': ariaLabel }: {
	label: React.ReactNode
	value: boolean
	onChange: (v: boolean) => void
	icon?: React.ReactNode
	title?: string
	'aria-label'?: string
}) {
	return (
		<button
			onClick={() => onChange(!value)}
			aria-pressed={value}
			aria-label={ariaLabel}
			title={title}
			className="text-xs px-3 py-1 rounded-full border transition-opacity flex items-center gap-1.5"
			style={{
				borderColor: 'currentColor',
				opacity: value ? 1 : 0.5,
				background: value ? 'var(--btn-bg)' : 'transparent',
			}}
		>
			{icon}{label}
		</button>
	)
}

/** Prose paragraphs for character mode demo */
const CHAR_PARAGRAPHS = [
	`Typography has always been a conversation between the reader and the page. Each word on a printed sheet is fixed — its weight locked at the moment of setting. But type on screen can breathe, respond, and shift its gravity as the cursor passes through.`,
	`Move your cursor slowly across the paragraphs. Characters nearest the cursor rise toward their peak weight, fading back as you move away. The result is a living texture that responds to presence — not animation for its own sake, but legibility shaped by attention.`,
	`Character mode works per-character across any block element — including mixed content with inline code, links, or other elements. The weight gradient follows the cursor continuously, adjusted on scroll so the effect never drifts.`,
]

/** Stable sample style — defined outside component to avoid new reference on every render */
const sampleStyle: React.CSSProperties = {
	fontFamily: "var(--font-merriweather), serif",
	fontSize: "1.125rem",
	lineHeight: "1.8",
	fontVariationSettings: '"wght" 300, "opsz" 18, "wdth" 100',
}

/** Interactive magnetType demo — word, legibility, and character modes */
export default function Demo() {
	const [mode, setMode] = useState<MagnetTypeModeType | 'char'>('char')
	const [weightHigh, setWeightHigh] = useState(900)
	const [weightLow, setWeightLow] = useState(300)
	const [radius, setRadius] = useState(120)
	const [falloff, setFalloff] = useState<FalloffType>('quadratic')
	const [magnetMode, setMagnetMode] = useState<MagnetModeType>('attract')

	// Character mode state
	const [blockSpreadRadius, setBlockSpreadRadius] = useState(80)
	const [blockWeightHigh, setBlockWeightHigh] = useState(900)
	const [blockWeightLow, setBlockWeightLow] = useState(300)
	const dBlockSpreadRadius = useDeferredValue(blockSpreadRadius)
	const dBlockWeightHigh = useDeferredValue(blockWeightHigh)
	const dBlockWeightLow = useDeferredValue(blockWeightLow)

	// Props toggles for word mode
	const [opacityProp, setOpacityProp] = useState(false)
	const [italicProp, setItalicProp] = useState(false)

	// Gyro state
	const [gyroMode, setGyroMode] = useState(false)
	const isTouch = useMediaQuery('(hover: none)')
	const hasOrientation = useClientValue(() => typeof DeviceOrientationEvent !== 'undefined', false)
	const showGyro = isTouch && hasOrientation

	// Gyro → synthetic mousemove on document
	useEffect(() => {
		if (!gyroMode) return
		let rafId: number | null = null
		const handleOrientation = (e: DeviceOrientationEvent) => {
			if (rafId !== null) return
			rafId = requestAnimationFrame(() => {
				rafId = null
				if (e.gamma !== null && e.beta !== null) {
					const x = Math.round(((e.gamma + 90) / 180) * window.innerWidth)
					const clamped = Math.max(15, Math.min(90, e.beta))
					const y = Math.round(((clamped - 15) / 75) * window.innerHeight)
					document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }))
				}
			})
		}
		window.addEventListener('deviceorientation', handleOrientation)
		return () => {
			window.removeEventListener('deviceorientation', handleOrientation)
			if (rafId !== null) cancelAnimationFrame(rafId)
		}
	}, [gyroMode])

	/** Toggle gyro — requests iOS permission if needed; shows alert if denied */
	const toggleGyro = useCallback(async () => {
		if (gyroMode) {
			setGyroMode(false)
			return
		}
		// iOS 13+ requires explicit permission
		const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
		if (typeof DOE.requestPermission === 'function') {
			try {
				const permission = await DOE.requestPermission()
				if (permission === 'granted') {
					setGyroMode(true)
				} else {
					alert('Gyro access was denied. Enable motion & orientation access in Settings > Safari to use this feature.')
				}
			} catch {
				alert('Gyro permission could not be requested. Enable motion & orientation access in Settings > Safari.')
			}
		} else {
			setGyroMode(true)
		}
	}, [gyroMode])

	const dWeightHigh = useDeferredValue(weightHigh)
	const dWeightLow = useDeferredValue(weightLow)
	const dRadius = useDeferredValue(radius)

	// Build merged props object for word mode — memoised to avoid unnecessary child re-renders
	const fieldProps = useMemo(
		() => opacityProp || italicProp
			? {
				...(opacityProp ? { opacity: [0.5, 1.0] as [number, number] } : {}),
				...(italicProp ? { italic: true } : {}),
			}
			: undefined,
		[opacityProp, italicProp]
	)

	// Guard: ensure deferred block weights never invert (char mode)
	const safeBlockWeightLow = Math.min(dBlockWeightLow, dBlockWeightHigh)
	const safeBlockWeightHigh = Math.max(dBlockWeightLow, dBlockWeightHigh)

	return (
		<div className="w-full">
			{/* Screen-reader live region announces mode and state changes */}
			<div aria-live="polite" aria-atomic="true" className="sr-only">
				{mode === 'char' && 'Character mode active'}
				{mode === 'word' && `Word mode active, ${magnetMode}`}
				{mode === 'legibility' && 'Legibility mode active'}
			</div>

			{/* Mode toggle */}
			<div className="flex flex-wrap items-center gap-3 mb-6">
				<ToggleGroup
					label="Mode"
					options={['char', 'word', 'legibility'] as const}
					value={mode}
					onChange={setMode}
					titles={{
						char: "Per-character mode: each individual letter's weight tracks proximity to the cursor",
						word: "Per-word mode: each word's weight shifts as the cursor enters its magnetic radius",
						legibility: "Legibility mode: expands the width axis on visually confusable characters (il1I, rn, 0O) near the cursor",
					}}
				/>
			</div>

			{/* Word mode controls */}
			{mode === 'word' && (
				<>
					<div className="grid grid-cols-2 sm:grid-cols-3 gap-6 mb-6">
						<Slider label="Weight High" value={weightHigh} min={100} max={900} step={10} onChange={setWeightHigh} title="Maximum font weight applied to a word when it sits at the centre of the magnetic field — the value the cursor attracts toward" />
						<Slider label="Weight Low"  value={weightLow}  min={100} max={900} step={10} onChange={setWeightLow}  title="Resting font weight for words outside the magnetic radius — the baseline weight the effect falls back to" />
						<Slider label="Radius"      value={radius}     min={60}  max={240} step={10} onChange={setRadius}     title="Distance in pixels from the cursor at which words begin to feel the magnetic pull — larger values create a broader, softer field" />
					</div>
					<div className="flex flex-wrap items-center gap-3 mb-4">
						<ToggleGroup
							label="Falloff"
							options={['linear', 'quadratic'] as const}
							value={falloff}
							onChange={setFalloff}
							titles={{
								linear: "Weight decreases at a constant rate as distance from the cursor grows",
								quadratic: "Weight drops off faster near the edge of the radius, giving a sharper, more focused effect",
							}}
						/>
						<ToggleGroup
							label="Magnet"
							options={['attract', 'repel'] as const}
							value={magnetMode}
							onChange={setMagnetMode}
							titles={{
								attract: "Words near the cursor pull toward the high weight — the cursor acts as a weight magnet",
								repel: "Words near the cursor push toward the low weight — proximity lightens rather than bolds",
							}}
						/>
					</div>
					<div role="group" aria-label="Props" className="flex flex-wrap items-center gap-3 mb-8">
						<span className="text-xs uppercase tracking-[0.18em] font-medium text-muted" aria-hidden="true">Props</span>
						<ToggleButton label="opacity" value={opacityProp} onChange={setOpacityProp} title="Also fade word opacity in proportion to cursor proximity — near words appear at full opacity, distant words fade" />
						<ToggleButton label="italic" value={italicProp} onChange={setItalicProp} title="Italicise words as they enter the magnetic field, reverting to upright as they leave" />
						{showGyro && (
							<ToggleButton
								label="gyro"
								aria-label="Gyro / gaze control"
								value={gyroMode}
								onChange={() => { void toggleGyro() }}
								icon={<GyroIcon />}
								title="On glasses: head orientation = gaze position. Tilt to simulate."
							/>
						)}
					</div>
					<p className="text-xs text-muted mb-2" style={{ lineHeight: "1.6" }}>
						Word mode — each word pulls toward its nearest magnetic pole (gaze direction on glasses).
					</p>
					<div className="flex flex-col gap-8">
						{FIELD_PARAGRAPHS.map((para) => (
							<MagnetTypeText
								key={para.slice(0, 32)}
								mode="word"
								axes={{ wght: [Math.min(dWeightLow, dWeightHigh), Math.max(dWeightLow, dWeightHigh)] }}
								radius={dRadius}
								falloff={falloff}
								magnetMode={magnetMode}
								props={fieldProps}
								style={sampleStyle}
							>
								{para}
							</MagnetTypeText>
						))}
					</div>
					<p className="text-xs text-muted italic mt-8" style={{ lineHeight: "1.8" }}>
						{gyroMode
							? "On smart glasses, head orientation maps directly to gaze. magnetType responds to where you’re looking — axis variation follows your gaze across the text. Each word responds to proximity independently: words inside the radius attract toward the peak weight, words outside hold at rest."
							: "Move your cursor through the text — on glasses, this is gaze. On touch devices, try the gyro button if your device supports orientation events. Each word responds to proximity independently: words inside the radius attract toward the peak weight, words outside hold at rest. Try switching between attract and repel, or between linear and quadratic falloff. Cross-paragraph by default: all paragraphs respond to the same cursor."
						}
					</p>
				</>
			)}

			{/* Legibility mode controls + text */}
			{mode === 'legibility' && (
				<>
					<p className="text-xs text-muted mb-8">
						Legibility mode boosts the wdth axis on visually confusable characters (il1I, rn, 0O) in proportion to their confusion risk. Move your cursor over the text — characters near the cursor receive the full boost, fading out by distance. On touch devices the boost is always active.
					</p>
					<MagnetTypeText
						mode="legibility"
						wdthBoost={8}
						style={sampleStyle}
					>
						{LEGIBILITY_TEXT}
					</MagnetTypeText>
					<p className="text-xs text-muted italic mt-8" style={{ lineHeight: "1.8" }}>
						Characters like il, 1I, rn, and 0O receive a proportional wdth boost based on their confusion risk — the most ambiguous get the full boost, lower-risk characters get a partial boost. The result is marginally wider letterforms exactly where disambiguation matters most.
					</p>
				</>
			)}

			{/* Character mode */}
			{mode === 'char' && (
				<>
					<div className="grid grid-cols-2 sm:grid-cols-3 gap-6 mb-8">
						<Slider label="Spread Radius" value={blockSpreadRadius} min={20} max={300} step={10} onChange={setBlockSpreadRadius} title="How far in pixels from the cursor individual characters feel the weight gradient — smaller values keep the effect tightly focused, larger values spread it across more of the line" />
						<Slider label="Weight High"   value={blockWeightHigh}   min={100} max={900} step={10} onChange={setBlockWeightHigh}   title="Maximum font weight applied to characters directly under the cursor" />
						<Slider label="Weight Low"    value={blockWeightLow}    min={100} max={900} step={10} onChange={setBlockWeightLow}    title="Resting font weight for characters beyond the spread radius — the weight the text returns to when the cursor moves away" />
					</div>
					<p className="text-xs text-muted mb-6" style={{ lineHeight: "1.6" }}>
						Character mode — per-character weight gradient across any block element. Works with mixed content (inline code, links, etc). Move your cursor through the paragraphs below.
					</p>
					<div className="flex flex-col gap-8">
						{CHAR_PARAGRAPHS.map((para) => (
							<MagnetChar
								key={para.slice(0, 32)}
								spreadRadius={dBlockSpreadRadius}
								minWeight={safeBlockWeightLow}
								maxWeight={safeBlockWeightHigh}
								style={sampleStyle}
							>
								{para}
							</MagnetChar>
						))}
					</div>
					<p className="text-xs text-muted italic mt-8" style={{ lineHeight: "1.8" }}>
						spreadRadius controls how far from the cursor each character&apos;s weight fades to its minimum. Use proximityRadius to gate the effect to when the cursor is near the element edge, or omit it to always respond. Both props are independent and combinable.
					</p>
				</>
			)}
		</div>
	)
}
