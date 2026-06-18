// Reproducible README visual capture for magnetType.
// Serves scripts/ over HTTP, drives capture.html with Playwright, and writes
// PNG stills (transparent corners, 2x) + an animated GIF of the cursor sweep.
// Run: node scripts/capture.mjs   (from repo root)
import { chromium } from "playwright"
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { writeFile, mkdir, cp } from "node:fs/promises"
import { existsSync } from "node:fs"
import { extname, join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const ASSETS = join(ROOT, "assets")
const FONTS_SRC = join(ROOT, "site", "public", "fonts")
const FONTS_DST = join(__dirname, "fonts")

const MIME = { ".html": "text/html", ".woff2": "font/woff2", ".css": "text/css", ".js": "text/javascript" }

// Make the variable font available next to capture.html so the @font-face resolves.
async function ensureFonts() {
	if (!existsSync(FONTS_DST)) await mkdir(FONTS_DST, { recursive: true })
	await cp(join(FONTS_SRC, "Merriweather.woff2"), join(FONTS_DST, "Merriweather.woff2"))
}

function serve() {
	const server = createServer(async (req, res) => {
		const url = (req.url || "/").split("?")[0]
		const path = join(__dirname, url === "/" ? "capture.html" : decodeURIComponent(url))
		try {
			const buf = await readFile(path)
			res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" })
			res.end(buf)
		} catch {
			res.writeHead(404); res.end("not found")
		}
	})
	return new Promise(resolve => server.listen(0, () => resolve(server)))
}

const SCENES = [
	{ name: "hero", anim: true },
	{ name: "word" },
	{ name: "char" },
	{ name: "legibility" },
]

async function main() {
	await ensureFonts()
	if (!existsSync(ASSETS)) await mkdir(ASSETS, { recursive: true })
	const server = await serve()
	const port = server.address().port
	const browser = await chromium.launch()

	for (const scene of SCENES) {
		const page = await browser.newPage({ deviceScaleFactor: 2 })
		await page.setViewportSize({ width: 980, height: 600 })
		await page.goto(`http://localhost:${port}/capture.html?scene=${scene.name}`)
		await page.waitForFunction(() => window.__ready === true, { timeout: 15000 })
		await page.waitForTimeout(250)
		const card = page.locator("#card")
		const out = join(ASSETS, `${scene.name}.png`)
		await card.screenshot({ path: out, omitBackground: true })
		console.log("wrote", out)

		if (scene.anim) {
			// Capture a sweep of frames as the cursor moves across the text line.
			const rect = await page.evaluate(() => {
				const r = window.__textRect()
				return { left: r.left, top: r.top, width: r.width, height: r.height }
			})
			const frameDir = join(ASSETS, "_frames")
			if (!existsSync(frameDir)) await mkdir(frameDir, { recursive: true })
			const STEPS = 36
			for (let i = 0; i < STEPS; i++) {
				// Ease back-and-forth sweep across the line, slight vertical drift.
				const t = i / (STEPS - 1)
				const tri = t < 0.5 ? t * 2 : (1 - t) * 2
				const ease = 0.5 - 0.5 * Math.cos(tri * Math.PI)
				const x = rect.left + rect.width * (0.08 + 0.84 * ease)
				const y = rect.top + rect.height * (0.32 + 0.36 * ease)
				await page.evaluate(([px, py]) => window.__applyAt(px, py), [x, y])
				await page.waitForTimeout(20)
				await card.screenshot({ path: join(frameDir, `f${String(i).padStart(3, "0")}.png`), omitBackground: true })
			}
			// Assemble GIF with ffmpeg if available, else leave frames.
			const gif = join(ASSETS, "hero.gif")
			const ff = spawnSync("ffmpeg", [
				"-y", "-framerate", "24", "-i", join(frameDir, "f%03d.png"),
				"-vf", "scale=880:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=full[p];[s1][p]paletteuse=dither=sierra2_4a",
				"-loop", "0", gif,
			], { stdio: "inherit" })
			if (ff.status === 0) console.log("wrote", gif)
			else console.warn("ffmpeg not available — frames left in", frameDir)
		}
		await page.close()
	}

	await browser.close()
	server.close()
	console.log("done")
}

main().catch(e => { console.error(e); process.exit(1) })
