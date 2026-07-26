// magnetType/src/framer/MagnetType.tsx — Framer code component wrapping the magnetType core.
//
// Distribution: paste this file into Framer (Insert → Code → New Component), or host it as an
// ES module and add it by URL. It imports the framework-agnostic core straight from the CDN, so
// it needs no build step — the core functions take a DOM element, not React, so there is no
// React version/externalisation issue.
//
// The rendering logic mirrors the already-proven `useMagnetType` hook: it snapshots the clean
// HTML, then runs the cursor-field effect (startMagnetType for word/field mode, applyMagnetType
// for legibility mode), both of which return a stop function used as the effect cleanup. The only
// Framer-specific additions are the property controls, RenderTarget gating, and layout annotations.
import { useEffect, useRef } from "react"
import { addPropertyControls, ControlType, RenderTarget } from "framer"
// Pin to a published version so shared instances stay stable. Bump when the core changes.
// The core is framework-agnostic (operates on a DOM element), so no React externalisation is needed.
import { startMagnetType, applyMagnetType, getCleanHTML } from "https://esm.sh/@liiift-studio/magnettype@1.2.7"

/** Props surfaced to the Framer UI via addPropertyControls, plus base text styling.
 *  Option fields are declared explicitly so the component needs no type import over HTTP. */
interface MagnetTypeFramerProps {
	/** The text to animate. */
	text: string
	/** CSS font-family — MUST resolve to a variable font for axis effects (wght/wdth). */
	fontFamily: string
	/** Font size in px. */
	fontSize: number
	/** Text colour. */
	color: string
	/** Horizontal text alignment. */
	textAlign: "left" | "center" | "right"
	/** Operating mode: per-word axis field, or per-character legibility wdth boost. */
	mode: "word" | "legibility"
	/** Variable-font axis tag driven in word mode (e.g. "wght", "wdth", "slnt"). */
	axisTag: string
	/** Axis value at full distance (rest) in word mode. */
	axisRest: number
	/** Axis value directly under the cursor (peak) in word mode. */
	axisPeak: number
	/** Whether cursor proximity attracts toward peak or repels toward rest (word mode). */
	magnetMode: "attract" | "repel"
	/** Keep line lengths stable by compensating letter-spacing as weight rises (word mode). */
	stabilizeLayout: boolean
	/** wdth units added to confusable characters at full cursor strength (legibility mode). */
	wdthBoost: number
	/** Pixel radius over which the field effect fades. */
	radius: number
	/** Falloff curve for cursor proximity strength. */
	falloff: "linear" | "quadratic"
	/** Whether cursor listeners attach to the document or just this element. */
	scope: "element" | "document"
	/** Milliseconds to ease back to rest values when the cursor leaves (0 = instant snap). */
	transitionMs: number
	/** Cache span centre positions to avoid per-frame layout reads. */
	cachePositions: boolean
	/** Toggle font-style:italic on spans where cursor strength > 0.5. */
	italic: boolean
	/** Opacity applied at rest (full distance). Pair with peakOpacity for a proximity fade. */
	restOpacity: number
	/** Opacity applied directly under the cursor. Equal to restOpacity = no opacity effect. */
	peakOpacity: number
}

/**
 * Cursor-field per-word variable font axis variation (and per-character legibility mode),
 * as a Framer code component.
 *
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight auto
 */
export default function MagnetType(props: Partial<MagnetTypeFramerProps>) {
	const {
		text = "Move your cursor across this",
		fontFamily = "Roboto Flex",
		fontSize = 64,
		color = "#111111",
		textAlign = "left",
		mode = "word",
		axisTag = "wght",
		axisRest = 300,
		axisPeak = 700,
		magnetMode = "attract",
		stabilizeLayout = true,
		wdthBoost = 6,
		radius = 160,
		falloff = "quadratic",
		scope = "element",
		transitionMs = 180,
		cachePositions = true,
		italic = false,
		restOpacity = 1,
		peakOpacity = 1,
	} = props

	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const el = ref.current
		if (!el) return

		// Run the live cursor effect on the editing canvas and in preview (so the designer sees it);
		// leave the text static on export / thumbnails, where no cursor exists to drive the field.
		const target = RenderTarget.current()
		const animate = target === RenderTarget.preview || target === RenderTarget.canvas
		if (!animate) return

		// Build the optional per-span props only when they deviate from neutral, so the core's
		// default (no inline opacity / no forced style) is preserved unless the designer opts in.
		const extraProps: { opacity?: [number, number]; italic?: boolean } = {}
		if (restOpacity !== 1 || peakOpacity !== 1) extraProps.opacity = [restOpacity, peakOpacity]
		if (italic) extraProps.italic = true
		const hasProps = Object.keys(extraProps).length > 0

		const original = getCleanHTML(el)

		// The two modes share one options shape but call different core entry points.
		const stop =
			mode === "legibility"
				? applyMagnetType(el, original, {
						mode: "legibility",
						wdthBoost,
						radius,
						falloff,
						scope,
						transitionMs,
						cachePositions,
						...(hasProps ? { props: extraProps } : {}),
				  })
				: startMagnetType(el, original, {
						mode: "word",
						axes: { [axisTag]: [axisRest, axisPeak] },
						magnetMode,
						stabilizeLayout,
						radius,
						falloff,
						scope,
						transitionMs,
						cachePositions,
						...(hasProps ? { props: extraProps } : {}),
				  })

		return () => {
			stop()
			el.innerHTML = original
		}
	}, [
		text,
		mode,
		axisTag,
		axisRest,
		axisPeak,
		magnetMode,
		stabilizeLayout,
		wdthBoost,
		radius,
		falloff,
		scope,
		transitionMs,
		cachePositions,
		italic,
		restOpacity,
		peakOpacity,
	])

	return (
		<div
			ref={ref}
			style={{
				fontFamily,
				fontSize,
				color,
				textAlign,
				lineHeight: 1.2,
				width: "100%",
			}}
		>
			{text}
		</div>
	)
}

// Map every meaningful MagnetTypeOptions field to a Framer control.
addPropertyControls(MagnetType, {
	text: {
		type: ControlType.String,
		title: "Text",
		defaultValue: "Move your cursor across this",
		displayTextArea: true,
	},
	fontFamily: {
		type: ControlType.String,
		title: "Font",
		defaultValue: "Roboto Flex",
		description: "Must be a variable font exposing the axis you drive (wght/wdth).",
	},
	fontSize: { type: ControlType.Number, title: "Size", defaultValue: 64, min: 8, max: 400, unit: "px" },
	color: { type: ControlType.Color, title: "Colour", defaultValue: "#111111" },
	textAlign: {
		type: ControlType.Enum,
		title: "Align",
		options: ["left", "center", "right"],
		optionTitles: ["Left", "Center", "Right"],
		defaultValue: "left",
		displaySegmentedControl: true,
	},
	mode: {
		type: ControlType.Enum,
		title: "Mode",
		options: ["word", "legibility"],
		optionTitles: ["Word field", "Legibility"],
		defaultValue: "word",
		description: "Word: per-word axis field. Legibility: per-char wdth boost on confusables.",
	},
	axisTag: {
		type: ControlType.String,
		title: "Axis",
		defaultValue: "wght",
		description: "Word mode: the variable-font axis tag driven by the cursor.",
	},
	axisRest: { type: ControlType.Number, title: "Axis rest", defaultValue: 300, min: 0, max: 1000, step: 1 },
	axisPeak: { type: ControlType.Number, title: "Axis peak", defaultValue: 700, min: 0, max: 1000, step: 1 },
	magnetMode: {
		type: ControlType.Enum,
		title: "Magnet",
		options: ["attract", "repel"],
		optionTitles: ["Attract", "Repel"],
		defaultValue: "attract",
	},
	stabilizeLayout: { type: ControlType.Boolean, title: "Stabilise", defaultValue: true },
	wdthBoost: {
		type: ControlType.Number,
		title: "wdth boost",
		defaultValue: 6,
		min: 0,
		max: 40,
		step: 1,
		description: "Legibility mode: wdth units added to confusable chars at peak.",
	},
	radius: { type: ControlType.Number, title: "Radius", defaultValue: 160, min: 20, max: 600, step: 10, unit: "px" },
	falloff: {
		type: ControlType.Enum,
		title: "Falloff",
		options: ["linear", "quadratic"],
		optionTitles: ["Linear", "Quadratic"],
		defaultValue: "quadratic",
	},
	scope: {
		type: ControlType.Enum,
		title: "Scope",
		options: ["element", "document"],
		optionTitles: ["Element", "Document"],
		defaultValue: "element",
	},
	transitionMs: {
		type: ControlType.Number,
		title: "Ease back",
		defaultValue: 180,
		min: 0,
		max: 2000,
		step: 10,
		unit: "ms",
	},
	cachePositions: { type: ControlType.Boolean, title: "Cache pos", defaultValue: true },
	italic: { type: ControlType.Boolean, title: "Italic", defaultValue: false },
	restOpacity: { type: ControlType.Number, title: "Opacity rest", defaultValue: 1, min: 0, max: 1, step: 0.05 },
	peakOpacity: { type: ControlType.Number, title: "Opacity peak", defaultValue: 1, min: 0, max: 1, step: 0.05 },
})
