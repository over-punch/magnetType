import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const alt = 'Magnet Type — Cursor-field variable font axis variation'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
	let interLight: Buffer
	try {
		interLight = await readFile(join(process.cwd(), 'public/fonts/inter-300.woff'))
	} catch (err) {
		throw new Error(`OG image: failed to load inter-300.woff — run npm run sync to restore fonts. ${err}`)
	}
	return new ImageResponse(
		(
			<div style={{ background: '#22003c', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '72px 80px', fontFamily: 'Inter, sans-serif' }}>
				<span style={{ fontSize: 13, letterSpacing: '0.18em', color: '#9b95a3', textTransform: 'uppercase' }}>magnet type</span>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
					<div style={{ display: 'flex', gap: 8, marginBottom: 48, alignItems: 'flex-end' }}>
						{[300, 380, 460, 560, 680, 780, 900].map((w, i) => (
							<div key={i} style={{ width: 32, height: Math.round(8 + (w - 300) / 600 * 40), background: i < 3 ? '#7c7882' : '#c1bacb', borderRadius: 3, opacity: 0.4 + i * 0.09 }} />
						))}
					</div>
					<div style={{ fontSize: 76, color: '#f6f4fa', lineHeight: 1.06, fontWeight: 300 }}>Magnet Type,</div>
					<div style={{ fontSize: 76, color: '#c1bacb', lineHeight: 1.06, fontWeight: 300 }}>word by word.</div>
				</div>
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
					<div style={{ fontSize: 14, color: '#c1bacb', letterSpacing: '0.04em', display: 'flex', gap: 20 }}>
						<span>TypeScript</span><span style={{ opacity: 0.4 }}>·</span>
						<span>Zero dependencies</span><span style={{ opacity: 0.4 }}>·</span>
						<span>React + Vanilla JS</span>
					</div>
					<div style={{ fontSize: 13, color: '#9b95a3', letterSpacing: '0.04em' }}>magnettype.com</div>
				</div>
			</div>
		),
		{ ...size, fonts: [{ name: 'Inter', data: interLight, style: 'normal', weight: 300 }] },
	)
}
