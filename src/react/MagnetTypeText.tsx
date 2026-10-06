// magnetType/src/react/MagnetTypeText.tsx — React component wrapper
import React, { Children, forwardRef, isValidElement, useCallback } from 'react'
import { useMagnetType } from './useMagnetType'
import type { MagnetTypeOptions } from '../core/types'

/** Props for MagnetTypeText — all MagnetTypeOptions plus HTML attributes for the element */
interface MagnetTypeTextProps extends MagnetTypeOptions, Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'className' | 'style'> {
	children: React.ReactNode
	/** HTML element to render. Default: 'p' */
	as?: React.ElementType
	className?: string
	style?: React.CSSProperties
}

/** MagnetTypeOptions keys: consumed by the hook, not forwarded to the DOM element. */
const OPTION_KEYS: (keyof MagnetTypeOptions)[] = [
	'mode', 'scope', 'radius', 'falloff', 'props', 'axes', 'magnetMode', 'wdthBoost', 'wghtBoost', 'trackBoost', 'cachePositions', 'stabilizeLayout', 'transitionMs',
]

/**
 * A string that changes whenever the rendered content of `children` changes: text, element types,
 * keys and primitive props, walked recursively. Functions and objects are ignored.
 */
function childrenSignature(children: React.ReactNode): string {
	const parts: string[] = []
	const walk = (node: React.ReactNode) => {
		Children.forEach(node, (child) => {
			if (child === null || child === undefined || typeof child === 'boolean') return
			if (typeof child === 'string' || typeof child === 'number') { parts.push(String(child)); return }
			if (isValidElement(child)) {
				const type = typeof child.type === 'string' ? child.type : ((child.type as { displayName?: string; name?: string }).displayName ?? (child.type as { name?: string }).name ?? 'C')
				const props = child.props as Record<string, unknown>
				const attrs = Object.keys(props).filter((k) => k !== 'children' && ['string', 'number', 'boolean'].includes(typeof props[k])).sort().map((k) => `${k}=${String(props[k])}`)
				parts.push(`<${type}${child.key != null ? '#' + child.key : ''} ${attrs.join(' ')}>`)
				walk(props.children as React.ReactNode)
				parts.push(`</${type}>`)
			}
		})
	}
	walk(children)
	return parts.join('\u0000')
}

/**
 * Drop-in component that applies the magnetType effect to its children. HTML attributes (id, aria-*,
 * data-*, lang, event handlers…) and the ref are forwarded to the element.
 */
export const MagnetTypeText = forwardRef<HTMLElement, MagnetTypeTextProps>(
	function MagnetTypeText({ children, as: Tag = 'p', className, style, ...rest }, ref) {
		const options: MagnetTypeOptions = {}
		const htmlProps: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(rest)) {
			if ((OPTION_KEYS as string[]).includes(key)) (options as Record<string, unknown>)[key] = value
			else htmlProps[key] = value
		}
		// The library rewrites the element's text nodes, so React can't patch new children into it. When
		// the children or the tag change, remount the element (key) and re-run on the fresh content.
		const contentKey = `${typeof Tag === 'string' ? Tag : 'C'}|${childrenSignature(children)}`
		const innerRef = useMagnetType(options, contentKey)

		/** Callback ref that satisfies both the forwarded ref and the internal hook ref */
		const mergedRef = useCallback(
			(node: HTMLElement | null) => {
				(innerRef as { current: HTMLElement | null }).current = node
				if (typeof ref === 'function') {
					ref(node)
				} else if (ref) {
					ref.current = node
				}
			},
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[ref],
		)

		return (
			<Tag key={contentKey} ref={mergedRef} className={className} style={style} {...htmlProps}>
				{children}
			</Tag>
		)
	},
)

MagnetTypeText.displayName = 'MagnetTypeText'
