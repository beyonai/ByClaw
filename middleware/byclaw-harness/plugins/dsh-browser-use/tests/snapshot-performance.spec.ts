import { existsSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { PlaywrightBrowserDriver } from '../src/browserd.js'
import type { BrowserContextDriver } from '../src/browser-runtime.js'

const executablePath = [
  process.env.BYCLAW_BROWSER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find(path => path && existsSync(path))

// Opt-in measurement, independent of timing assertions and model/network latency.
it.skipIf(!executablePath || process.env.BROWSER_SNAPSHOT_BENCH !== '1')(
  'measures repeated observations at increasing DOM sizes', async () => {
    const browser = await new PlaywrightBrowserDriver().launch({ executablePath, headless: true })
    let context: BrowserContextDriver | undefined
    try {
      context = await browser.newContext({ acceptDownloads: true })
      const driver = await context.newPage()
      const page = (driver as unknown as { pageHandle: Page }).pageHandle
      for (const size of [20, 100, 200]) {
        await page.setContent(Array.from({ length: size }, (_, i) => `<button>Control ${i}</button>`).join(''))
        const read = async () => {
          const atomic = driver as typeof driver & { readSnapshot?: (n: number, chars: number) => Promise<unknown> }
          if (atomic.readSnapshot) return atomic.readSnapshot(200, 16_000)
          await driver.describeElements(200)
          await driver.readBodyText()
          await driver.describeBlockingLayers?.(20)
          await driver.title()
          await driver.stateFingerprint?.()
          await driver.contentFingerprint?.()
        }
        await read()
        const samples = []
        for (let i = 0; i < 7; i++) {
          const start = performance.now()
          await read()
          samples.push(performance.now() - start)
        }
        samples.sort((a, b) => a - b)
        process.stdout.write(JSON.stringify({ size, medianMs: samples[3], p95Ms: samples[6], samples }) + '\n')
        expect(samples.every(value => Number.isFinite(value))).toBe(true)
      }
      await page.setContent('<section hidden>' + '<button>Hidden control</button>'.repeat(80) + '</section>'
        + '<div>' + '<button>Visible control</button>'.repeat(20) + '</div>'
        + Array.from({ length: 300 }, (_, i) => `<p>History ${i}: ${'message '.repeat(40)}</p>`).join('')
        + '<button>Offscreen control</button>'.repeat(20))
      const report = []
      for (const detail of ['full', 'compact'] as const) {
        const start = performance.now()
        const snapshot = await driver.readSnapshot!(200, 16000, detail)
        report.push({ detail, elements: snapshot.elements.length, textChars: snapshot.text.length,
          jsonBytes: Buffer.byteLength(JSON.stringify(snapshot)), elapsedMs: performance.now() - start })
      }
      process.stdout.write(JSON.stringify({ fixture: 'mixed-visibility-history', report }) + '\n')
      expect(report[1]!.jsonBytes).toBeLessThan(report[0]!.jsonBytes)
    } finally {
      try { await context?.close() } finally { await browser.close() }
    }
  }, 120_000,
)
