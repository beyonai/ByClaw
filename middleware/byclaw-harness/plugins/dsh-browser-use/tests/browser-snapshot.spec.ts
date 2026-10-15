import { existsSync } from 'node:fs'
import type { Page } from 'playwright-core'
import { afterEach, expect, it, vi } from 'vitest'
import { PlaywrightBrowserDriver } from '../src/browserd.js'
import type { BrowserContextDriver, BrowserDriverInstance } from '../src/browser-runtime.js'

const executablePath = [process.env.BYCLAW_BROWSER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find(path => path && existsSync(path))
const browserIt = executablePath ? it : it.skip
browserIt('compact observations filter before the cap and exclude clipped text, with full opt-in', async () => {
  const { driver } = await fixture('<button hidden>Hidden</button>'.repeat(210)
    + '<button>Visible action</button><div style="height:40px;overflow:hidden"><p>Visible text</p><p style="margin-top:100px">Clipped secret</p></div>'
    + '<p style="margin-top:2000px">Offscreen text</p>')
  const compact = await driver.readSnapshot!(200, 16_000, 'compact')
  expect(compact.elements.map(e => e.name)).toEqual(['Visible action'])
  expect(compact.text).toContain('Visible text')
  expect(compact.text).not.toContain('Clipped secret')
  expect(compact.text).not.toContain('Offscreen text')
  expect(compact.omittedElements).toBe(210)
  const full = await driver.readSnapshot!(200, 16_000, 'full')
  expect(full.elements).toHaveLength(200)
  expect(full.text).toContain('Offscreen text')
}, 20_000)

browserIt('scrolls observed internal containers and reports clamped displacement without moving the page', async () => {
  const { driver, page } = await fixture('<div aria-label="Messages" style="height:100px;overflow:auto"><div style="height:350px">History</div></div>')
  const snapshot = await driver.readSnapshot!(200, 6000, 'compact')
  const target = snapshot.elements.find(e => e.name === 'Messages')
  expect(target?.scrollable).toBe(true)
  const result = await driver.scroll!({ deltaY: 560, element: target!.stableIndex! })
  expect(result).toMatchObject({ beforeY: 0, afterY: 250, deltaY: 250 })
  expect(await page.evaluate(() => scrollY)).toBe(0)
  expect((await driver.scroll!({ deltaY: 560, element: target!.stableIndex! })).deltaY).toBe(0)
  await expect(driver.scroll!({ deltaY: 10, element: 999999 })).rejects.toThrow('browser-element-not-found')
}, 20_000)

browserIt('clips a single multiline text node at the viewport and excludes transparent ancestors', async () => {
  const { driver } = await fixture('<div style="opacity:0"><button>Invisible action</button>Invisible text</div>'
    + '<div style="height:40px;overflow:hidden"><p style="white-space:pre;font-size:14px;line-height:20px;margin:0">First line\nSecond line\nClipped third line</p></div>')
  const compact = await driver.readSnapshot!(200, 16000, 'compact')
  expect(compact.elements).toHaveLength(0)
  expect(compact.text).toContain('First line')
  expect(compact.text).toContain('Second line')
  expect(compact.text).not.toContain('Clipped third line')
  expect(compact.text).not.toContain('Invisible text')
}, 20_000)

browserIt('bounds compact text and reports document scrolling including reverse movement', async () => {
  const { driver } = await fixture('<div style="position:fixed;font-size:1px;width:1000px">' + 'x'.repeat(10000) + '</div><div style="height:3000px"></div>')
  expect((await driver.readSnapshot!(200, 16000, 'compact')).text.length).toBeLessThanOrEqual(6000)
  expect(await driver.scroll!({ deltaY: 300 })).toMatchObject({ beforeY: 0, afterY: 300, deltaY: 300 })
  expect(await driver.scroll!({ deltaY: -500 })).toMatchObject({ beforeY: 300, afterY: 0, deltaY: -300 })
}, 20_000)

browserIt('reads visible slotted text once and skips fallback text when assigned', async () => {
  const { driver, page } = await fixture('<div id="host"><p>Slotted payment confirmation</p></div>')
  await page.evaluate(() => {
    document.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML = '<slot>Unused fallback</slot>'
  })
  const { text } = await driver.readSnapshot!(200, 6000, 'compact')
  expect(text.match(/Slotted payment confirmation/g)).toHaveLength(1)
  expect(text).not.toContain('Unused fallback')
}, 20_000)

browserIt('reads display-contents text using text geometry rather than an empty parent box', async () => {
  const { driver } = await fixture('<span style="display:contents">Visible contents text</span>'
    + '<span style="display:contents;visibility:hidden">Invisible contents text</span>')
  const { text } = await driver.readSnapshot!(200, 6000, 'compact')
  expect(text).toContain('Visible contents text')
  expect(text).not.toContain('Invisible contents text')
}, 20_000)
let browser: BrowserDriverInstance | undefined
let context: BrowserContextDriver | undefined
afterEach(async () => {
  try { await context?.close() } finally {
    try { await browser?.close() } finally { vi.restoreAllMocks() }
  }
}, 30_000)
async function fixture(html: string) {
  browser = await new PlaywrightBrowserDriver().launch({ executablePath, headless: true })
  context = await browser.newContext({ acceptDownloads: true })
  const driver = await context.newPage()
  const page = (driver as unknown as { pageHandle: Page }).pageHandle
  await page.setContent(html)
  return { driver, page, read: () => driver.readSnapshot!(200, 16_000) }
}

browserIt('keeps node identity across reorders and rejects replaced, unobserved and navigated nodes', async () => {
  const { driver, page, read } = await fixture('<button id="a">Same</button><button id="b">Same</button>')
  const first = await read()
  await page.evaluate(() => document.body.prepend(document.querySelector('#b')!))
  const moved = await read()
  expect(moved.elements.map(e => e.stableIndex)).toEqual(first.elements.map(e => e.stableIndex).reverse())
  await page.evaluate(() => document.querySelector('#a')!.replaceWith(document.querySelector('#a')!.cloneNode(true)))
  expect((await driver.readState!()).stateFingerprint).not.toBe(moved.stateFingerprint)
  expect(await driver.element(first.elements[0]!.stableIndex!)).toBeUndefined()
  const replaced = await read()
  expect(replaced.elements[1]!.stableIndex).not.toBe(first.elements[0]!.stableIndex)
  expect(await driver.element(987654321)).toBeUndefined()
  await page.goto('data:text/html,<button>Same</button>')
  expect(await driver.element(replaced.elements[0]!.stableIndex!)).toBeUndefined()
  const navigated = await read()
  expect(navigated.elements[0]!.stableIndex).toBeGreaterThan(Math.max(...replaced.elements.map(e => e.stableIndex!)))
}, 20_000)

browserIt('takes an atomic bounded snapshot, preserves shadow controls and does not publish IDs to the page', async () => {
  const { driver, page, read } = await fixture('<title>Snapshot</title><input type="password" value="sensitive"><div id="host"></div><p>body text</p>')
  await page.evaluate(() => {
    document.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML = '<button onclick="this.textContent=\'Clicked\'">Shadow action</button>'
    Object.assign(window, { __jevFast: { nodes: new Map([[1, document.body]]) } })
  })
  const globals = await page.evaluate(() => Object.getOwnPropertyNames(window))
  const snapshot = await read()
  expect(snapshot.title).toBe('Snapshot')
  expect(snapshot.text).toContain('body text')
  expect(snapshot.elements.find(e => e.type === 'password')?.value).toBeUndefined()
  expect(JSON.stringify(snapshot)).not.toContain('sensitive')
  const shadow = snapshot.elements.find(e => e.name === 'Shadow action')!
  expect(shadow).toMatchObject({ visible: true, covered: false })
  await (await driver.element(shadow.stableIndex!))!.click()
  expect(await page.locator('#host button').innerText()).toBe('Clicked')
  expect(await page.evaluate(() => Object.getOwnPropertyNames(window))).toEqual(globals)
  const bounded = await driver.readSnapshot!(1, 4)
  expect(bounded.elements).toHaveLength(1)
  expect(bounded.text.length).toBeLessThanOrEqual(4)
  expect(await driver.element(shadow.stableIndex!)).toBeUndefined()
}, 20_000)

browserIt('uses one warm evaluation for 200 elements with no element handle enumeration', async () => {
  const { page, read } = await fixture(Array.from({ length: 200 }, (_, i) => `<button>${i}</button>`).join(''))
  const evaluateHandle = vi.spyOn(page, 'evaluateHandle')
  const first = await read()
  expect(first.elements).toHaveLength(200)
  expect(evaluateHandle).toHaveBeenCalledTimes(1)
  const registry = await evaluateHandle.mock.results[0]!.value
  const evaluate = vi.spyOn(registry, 'evaluate')
  const locator = vi.spyOn(page, 'locator')
  const second = await read()
  expect(second.stateFingerprint).toBe(first.stateFingerprint)
  expect(evaluate).toHaveBeenCalledTimes(1)
  expect(evaluateHandle).toHaveBeenCalledTimes(1)
  expect(locator).not.toHaveBeenCalled()
}, 20_000)

browserIt('detects property changes without invalidating on unrelated body text, and finds overlays after hidden candidates', async () => {
  const { driver, page, read } = await fixture('<input aria-label="Choice" type="checkbox"><p id="text">Before</p>'
    + '<div class="modal" hidden></div>'.repeat(25)
    + '<div role="dialog" aria-label="Visible dialog">Dialog</div>')
  const first = await read()
  expect(first.blockingLayers).toEqual([expect.objectContaining({ name: 'Visible dialog' })])
  await page.evaluate(() => { document.querySelector('#text')!.textContent = 'After' })
  const textChanged = await driver.readState!()
  expect(textChanged.stateFingerprint).toBe(first.stateFingerprint)
  expect(textChanged.contentFingerprint).not.toBe(first.contentFingerprint)
  await page.evaluate(() => { document.querySelector('input')!.checked = true })
  expect((await driver.readState!()).stateFingerprint).not.toBe(first.stateFingerprint)
}, 20_000)

browserIt('exposes goal candidates for ARIA choices, editable fields and select options without passwords', async () => {
  const { driver } = await fixture('<button type="button">Go</button><input aria-label="Query"><input type="password" value="secret">'
    + '<div role="option">Suggestion</div><div inert><button>Inert</button></div>'
    + '<select aria-label="City"><option selected value="a">A</option><option value="b">B</option><optgroup disabled><option value="c">C</option></optgroup></select>')
  const snapshot = await driver.readSnapshot!(200, 6000, 'compact')
  expect(snapshot.elements.find(e => e.name === 'Go')).toMatchObject({ clickable: true, submit: false })
  expect(snapshot.elements.find(e => e.name === 'Query')).toMatchObject({ editable: true })
  expect(snapshot.elements.find(e => e.name === 'Suggestion')).toMatchObject({ clickable: true })
  expect(snapshot.elements.find(e => e.name === 'Inert')).toMatchObject({ disabled: true })
  expect(snapshot.elements.find(e => e.name === 'City')?.options).toEqual([
    { value: 'a', label: 'A', disabled: false, selected: true }, { value: 'b', label: 'B', disabled: false, selected: false },
    { value: 'c', label: 'C', disabled: true, selected: false },
  ])
  expect(JSON.stringify(snapshot)).not.toContain('secret')
}, 20_000)
