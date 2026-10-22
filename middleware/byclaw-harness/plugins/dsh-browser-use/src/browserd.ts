import { closeOwnedBrowserServer } from './browser-close.js'
import { startActivationServer } from './activation-server.js'
import { BycliRuntime, type BycliRuntimeOptions } from './bycli-runtime.js'
import { browserGoalEnabled } from './goal-config.js'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { renameSync, writeFileSync } from 'node:fs'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import {
  createServer as createHttpServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type Server as HttpServer,
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect as connectTcp, createServer, type Socket } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserServer,
  type Download,
  type ElementHandle,
  type JSHandle,
  type Page,
  type Request,
  type Route,
} from 'playwright-core'
import {
  BROWSER_BROKER_MAX_FRAME_BYTES,
  type BrowserBlockingLayer,
  type BrowserBrokerCancelRequest,
  type BrowserBrokerErrorResponse,
  type BrowserBrokerRequest,
  type BrowserBrokerResponse,
  type BrowserWaitForCondition,
} from './protocol.js'
import {
  BrowserRuntime,
  BrowserRuntimeError,
  isBrowserUrlAllowed,
  type BrowserContextDriver,
  type BrowserContextPolicy,
  type BrowserDownloadDriver,
  type BrowserDriver,
  type BrowserDriverInstance,
  type BrowserElementDescription,
  type BrowserLocatorDriver,
  type BrowserPageDriver,
  type BrowserPolicyViolation,
  type BrowserRuntimeOptions,
  type BrowserLifecycleEvent,
  type BrowserSessionDesktopManager,
  type BrowserWindowSize,
} from './browser-runtime.js'
import { readBrowserSecretFromEnvironment } from './secret-fd.js'
import { createSnapshotRegistry } from './browser-snapshot.js'
import { parseDesktopScreen, SessionDesktopManager, type IntegerRange, type SessionDesktop } from './session-desktop-manager.js'
import { BrowserWindowGeometry } from './browser-window-geometry.js'
import { startViewerGateway, type ViewerGateway } from './viewer-gateway.js'

const MAX_BROWSERD_CONNECTION_BUFFER_BYTES = BROWSER_BROKER_MAX_FRAME_BYTES + 1
const ACTION_INTENT_SETTLE_MS = 25
const INTERACTIVE_SELECTOR =
  'a,button,input,textarea,select,[role=button],[role=option],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=combobox],[role=textbox],[contenteditable=true]'
const BLOCKING_LAYER_SELECTOR =
  'dialog,[role=dialog],[aria-modal=true],[class*=modal i],[class*=overlay i],[class*=mask i],[class*=popover i],[class*=dropdown i]'

export interface BrowserLaunchConfiguration {
  readonly userDataDir: string
  readonly args?: readonly string[]
  readonly ignoreDefaultArgs?: readonly string[]
  readonly invalidExtensionPaths: readonly string[]
}

export async function resolveBrowserLaunchConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<BrowserLaunchConfiguration> {
  const args = ['--disable-dev-shm-usage']
  const dshHome = resolve(environment.DSH_HOME?.trim() || join(homedir(), '.dsh'))
  const userDataDir = resolve(
    environment.BYCLAW_BROWSER_USER_DATA_DIR?.trim() || join(dshHome, 'browser', 'user-data'),
  )
  const candidates = (environment.BYCLAW_BROWSER_EXTENSIONS ?? '')
    .split(delimiter)
    .map(candidate => candidate.trim())
    .filter(Boolean)
    .map(candidate => resolve(candidate))
  const validExtensionPaths: string[] = []
  const invalidExtensionPaths: string[] = []
  for (const candidate of candidates) {
    try {
      const [directory, manifest] = await Promise.all([
        stat(candidate),
        stat(join(candidate, 'manifest.json')),
      ])
      if (!directory.isDirectory() || !manifest.isFile()) throw new Error('invalid-extension-layout')
      validExtensionPaths.push(candidate)
    } catch {
      invalidExtensionPaths.push(candidate)
    }
  }
  if (validExtensionPaths.length === 0) return { userDataDir, args, invalidExtensionPaths }
  const extensionList = validExtensionPaths.join(',')
  return {
    userDataDir,
    args: [
      ...args,
      `--disable-extensions-except=${extensionList}`,
      `--load-extension=${extensionList}`,
    ],
    ignoreDefaultArgs: ['--disable-extensions', '--no-startup-window'],
    invalidExtensionPaths,
  }
}

async function enablePersistentProfileDeveloperMode(
  userDataDir: string,
  args: readonly string[] | undefined,
): Promise<void> {
  const loadsUnpackedExtension = args?.some(argument => (
    argument.startsWith('--load-extension=') && argument.length > '--load-extension='.length
  )) === true
  if (!loadsUnpackedExtension) return

  const defaultProfile = join(userDataDir, 'Default')
  const preferencesPath = join(defaultProfile, 'Preferences')
  await mkdir(defaultProfile, { recursive: true, mode: 0o700 })
  let preferences: unknown = {}
  try {
    preferences = JSON.parse(await readFile(preferencesPath, 'utf8'))
  } catch (error) {
    if (!isRecord(error) || error.code !== 'ENOENT') {
      throw new Error('browser-profile-preferences-invalid', { cause: error })
    }
  }
  if (!isRecord(preferences)) throw new Error('browser-profile-preferences-invalid')
  const extensions = isRecord(preferences.extensions) ? preferences.extensions : {}
  const ui = isRecord(extensions.ui) ? extensions.ui : {}
  if (ui.developer_mode === true) return
  const next = {
    ...preferences,
    extensions: {
      ...extensions,
      ui: { ...ui, developer_mode: true },
    },
  }
  const temporaryPath = `${preferencesPath}.byclaw-${String(process.pid)}-${randomUUID()}`
  try {
    await writeFile(temporaryPath, JSON.stringify(next), { mode: 0o600, flag: 'wx' })
    await rename(temporaryPath, preferencesPath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function clearChromiumSingletonFiles(userDataDir: string): Promise<void> {
  await Promise.all(['SingletonLock', 'SingletonCookie', 'SingletonSocket'].map(async name => {
    try {
      await unlink(join(userDataDir, name))
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') throw error
    }
  }))
}

function safeDownloadName(value: string): string {
  const normalized = value
    .replaceAll(/[\\/\u0000-\u001f\u007f]/g, '_')
    .replace(/^\.+$/, 'download')
    .slice(0, 255)
  return normalized || 'download'
}

function policyRequestDetail(method: string, rawUrl: string): string {
  let url = rawUrl
  try {
    const parsed = new URL(rawUrl)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    url = parsed.href
  } catch {
    url = rawUrl
  }
  return `page request ${method.slice(0, 16)} ${url.slice(0, 448)}`
}

function isBrowserWebSocketAllowed(value: string, allowedDomains: readonly string[]): boolean {
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'ws:') parsed.protocol = 'http:'
    else if (parsed.protocol === 'wss:') parsed.protocol = 'https:'
    else return false
    return isBrowserUrlAllowed(parsed.href, allowedDomains)
  } catch {
    return false
  }
}

class BrowserDomainProxy {
  readonly #server: HttpServer
  readonly #clientSockets = new Set<Socket>()
  readonly #upstreamSockets = new Set<Socket>()
  readonly #upstreamRequests = new Set<ClientRequest>()
  readonly #upstreamResponses = new Set<IncomingMessage>()
  #allowedDomains: readonly string[] = []
  #closed = false

  constructor() {
    this.#server = createHttpServer((request, response) => {
      if (this.#closed) {
        response.destroy()
        return
      }
      let target: URL
      try {
        target = new URL(request.url ?? '')
      } catch {
        response.writeHead(400).end()
        return
      }
      if (!isBrowserUrlAllowed(target.href, this.#allowedDomains)) {
        response.writeHead(403).end()
        return
      }
      const forward = target.protocol === 'https:' ? httpsRequest : httpRequest
      let activeResponse: IncomingMessage | undefined
      const upstream = forward(target, {
        method: request.method,
        headers: { ...request.headers, host: target.host },
      }, upstreamResponse => {
        activeResponse = upstreamResponse
        this.#upstreamResponses.add(upstreamResponse)
        upstreamResponse.once('close', () => this.#upstreamResponses.delete(upstreamResponse))
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
        upstreamResponse.pipe(response)
      })
      this.#upstreamRequests.add(upstream)
      upstream.once('close', () => this.#upstreamRequests.delete(upstream))
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(502)
        response.end()
      })
      response.once('close', () => {
        upstream.destroy()
        activeResponse?.destroy()
      })
      request.pipe(upstream)
    })
    this.#server.on('connection', socket => {
      this.#clientSockets.add(socket)
      socket.on('error', () => undefined)
      socket.once('close', () => this.#clientSockets.delete(socket))
    })
    this.#server.on('connect', (request, clientSocket, head) => {
      if (this.#closed) {
        clientSocket.destroy()
        return
      }
      let target: URL
      try {
        target = new URL(`https://${request.url ?? ''}`)
      } catch {
        clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
        return
      }
      if (!isBrowserUrlAllowed(target.href, this.#allowedDomains)) {
        clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
        return
      }
      const upstream = connectTcp(Number(target.port || 443), target.hostname, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.byteLength > 0) upstream.write(head)
        upstream.pipe(clientSocket)
        clientSocket.pipe(upstream)
      })
      this.#upstreamSockets.add(upstream)
      upstream.once('close', () => this.#upstreamSockets.delete(upstream))
      upstream.on('error', () => clientSocket.destroy())
      clientSocket.on('error', () => upstream.destroy())
      clientSocket.once('close', () => upstream.destroy())
      upstream.once('close', () => clientSocket.destroy())
    })
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.#server.once('error', reject)
      this.#server.listen(0, '127.0.0.1', resolve)
    })
    const address = this.#server.address()
    if (!address || typeof address === 'string') throw new Error('browser-proxy-address-unavailable')
    return `http://127.0.0.1:${address.port}`
  }

  allow(domains: readonly string[]): void {
    this.#allowedDomains = domains
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    for (const request of this.#upstreamRequests) request.destroy()
    for (const response of this.#upstreamResponses) response.destroy()
    for (const socket of this.#upstreamSockets) socket.destroy()
    for (const socket of this.#clientSockets) socket.destroy()
    await new Promise<void>(resolve => {
      if (!this.#server.listening) return resolve()
      this.#server.close(() => resolve())
    })
  }
}

class PlaywrightElementDriver implements BrowserLocatorDriver {
  constructor(
    private readonly handle: ElementHandle<HTMLElement | SVGElement>,
    private readonly stableIndex?: number,
  ) {}

  async describeElement(): Promise<BrowserElementDescription | undefined> {
    if (!(await this.handle.evaluate(element => element.isConnected).catch(() => false))) return undefined
    const description = await this.handle.evaluate(element => {
      const htmlElement = element as HTMLElement
      const tag = element.tagName.toLowerCase()
      const input = element instanceof HTMLInputElement ? element : undefined
      const select = element instanceof HTMLSelectElement ? element : undefined
      const textarea = element instanceof HTMLTextAreaElement ? element : undefined
      const button = element instanceof HTMLButtonElement ? element : undefined
      const type = input?.type ?? button?.type
      const formControl = input ?? select ?? textarea
      const labelledBy = element.getAttribute('aria-labelledby')?.trim()
        .split(/\s+/)
        .map(id => document.getElementById(id)?.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ')
      const associatedLabel = formControl?.labels
        ? Array.from(formControl.labels).map(label => label.textContent?.trim() ?? '').filter(Boolean).join(' ')
        : ''
      const name =
        element.getAttribute('aria-label')?.trim() ||
        labelledBy ||
        associatedLabel ||
        element.getAttribute('placeholder')?.trim() ||
        element.getAttribute('title')?.trim() ||
        element.getAttribute('name')?.trim() ||
        (formControl ? '' : htmlElement.innerText?.trim()) ||
        (input?.type === 'password' ? '' : input?.value?.trim()) ||
        ''
      const submit =
        (button !== undefined && button.type === 'submit') ||
        (input !== undefined && (input.type === 'submit' || input.type === 'image'))
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      const visible = style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0
      const inViewport = visible && rect.bottom > 0 && rect.right > 0
        && rect.top < innerHeight && rect.left < innerWidth
      const hit = inViewport
        ? document.elementFromPoint(
            Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2)),
            Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2)),
          )
        : null
      const covered = Boolean(hit && hit !== element && !element.contains(hit))
      return {
        tag,
        ...(element.getAttribute('role') ? { role: element.getAttribute('role')! } : {}),
        name,
        ...(type ? { type } : {}),
        ...(formControl && input?.type !== 'password' ? { value: formControl.value } : {}),
        disabled:
          (formControl !== undefined && formControl.disabled) ||
          (button !== undefined && button.disabled) ||
          element.getAttribute('aria-disabled') === 'true',
        submit,
        keyboardSubmit:
          submit ||
          (input !== undefined && input.form !== null && !['button', 'reset'].includes(input.type)),
        ...((input?.type === 'checkbox' || input?.type === 'radio')
          ? { checked: element.getAttribute('aria-checked') === 'mixed' ? 'mixed' as const : input.checked }
          : {}),
        ...(select ? { selectedValue: select.value } : {}),
        ...(formControl ? { readonly: 'readOnly' in formControl && formControl.readOnly } : {}),
        ...(formControl ? { required: formControl.required } : {}),
        ...(input || select ? { multiple: input?.multiple ?? select?.multiple ?? false } : {}),
        ...(input?.type === 'file' ? { accept: input.accept } : {}),
        ...(element.getAttribute('aria-expanded') === 'true' || element.getAttribute('aria-expanded') === 'false'
          ? { expanded: element.getAttribute('aria-expanded') === 'true' }
          : {}),
        visible,
        inViewport,
        covered,
      }
    })
    return {
      ...description,
      ...(this.stableIndex !== undefined ? { stableIndex: this.stableIndex } : {}),
    }
  }

  async click(options?: { timeout?: number }): Promise<void> {
    await this.handle.click(options)
  }

  async fill(value: string, options?: { timeout?: number }): Promise<void> {
    await this.handle.fill(value, options)
  }

  async selectOption(value: string, options?: { timeout?: number }): Promise<void> {
    await this.handle.selectOption(value, options)
  }

  screenshot(options?: { type: 'png' | 'jpeg'; quality?: number }): Promise<Buffer> {
    return this.handle.screenshot(options)
  }
}

class PlaywrightPageDriver implements BrowserPageDriver {
  readonly keyboard
  readonly #downloads: Array<Promise<BrowserDownloadDriver>> = []
  readonly #activeDownloads = new Set<Download>()
  readonly #activeDownloadTasks = new Set<Promise<BrowserDownloadDriver>>()
  readonly #actionIntentWaiters = new Set<() => void>()
  readonly #actionRequests = new Set<Request>()
  #actionInProgress = false
  #collectActionIntents = false
  #actionAborted = false
  #actionIntents = 0
  #actionIntentResults = 0
  #downloadDirectory: Promise<string> | undefined
  #nextElementIndex = 1
  #elements = new Map<number, ElementHandle<HTMLElement | SVGElement>>()
  #snapshotRegistry: Promise<JSHandle<ReturnType<typeof createSnapshotRegistry>>> | undefined
  #snapshotGeneration = 0
  #snapshotMaxElements = 200
  #snapshotMaxTextChars = 16_000
  #snapshotDetail: 'compact' | 'full' = 'full'

  constructor(
    readonly pageHandle: Page,
    private readonly downloadRoot: string,
  ) {
    this.keyboard = { press: (key: string) => this.pageHandle.keyboard.press(key) }
    this.pageHandle.on('download', download => {
      this.resolveActionIntent()
      this.#activeDownloads.add(download)
      const task = this.#captureDownload(download).finally(() => {
        this.#activeDownloads.delete(download)
        this.#activeDownloadTasks.delete(task)
      })
      void task.catch(() => undefined)
      this.#activeDownloadTasks.add(task)
      this.#downloads.push(task)
    })
    this.pageHandle.on('request', request => {
      if (
        this.#actionInProgress &&
        request.isNavigationRequest() &&
        request.frame() === this.pageHandle.mainFrame()
      ) {
        this.#actionRequests.add(request)
      }
    })
    this.pageHandle.on('response', response => {
      if (![204, 205].includes(response.status())) return
      if (!this.#actionRequests.delete(response.request())) return
      this.resolveActionIntent()
    })
    this.pageHandle.on('requestfailed', request => {
      if (!this.#actionRequests.delete(request)) return
      setImmediate(() => this.resolveActionIntent())
    })
    this.pageHandle.on('framenavigated', frame => {
      if (frame !== this.pageHandle.mainFrame()) return
      this.resolveActionIntent()
      this.#invalidateElements()
    })
    this.pageHandle.once('close', () => this.abortAction())
  }

  goto(url: string, options?: { timeout?: number }): Promise<unknown> {
    return this.pageHandle.goto(url, { ...options, waitUntil: 'domcontentloaded' })
  }

  url(): string {
    return this.pageHandle.url()
  }

  title(): Promise<string> {
    return this.pageHandle.title()
  }

  async readBodyText(): Promise<string> {
    return this.pageHandle.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
  }

  async describeElements(maxElements: number): Promise<readonly BrowserElementDescription[]> {
    return (await this.readSnapshot(maxElements, this.#snapshotMaxTextChars)).elements
  }

  async scroll(options: import('./protocol.js').BrowserScrollOptions) {
    const registry = await this.#registry()
    const result = await registry.evaluate((state, options) => state.scroll(options), options)
    if (result.error) throw new BrowserRuntimeError(result.error)
    return result
  }

  async readSnapshot(maxElements: number, maxTextChars: number, detail: 'compact' | 'full' = 'full') {
    this.#snapshotDetail = detail
    this.#snapshotMaxElements = maxElements
    this.#snapshotMaxTextChars = maxTextChars
    const snapshot = await this.#captureSnapshot(true)
    this.#disposeElementHandles()
    return snapshot
  }

  async readState() {
    const generation = this.#snapshotGeneration
    const registry = await this.#registry()
    const result = await registry.evaluate((state, options) => {
      const snapshot = state.capture({ ...options, observe: false })
      return {
        stateFingerprint: snapshot.stateFingerprint,
        contentFingerprint: snapshot.contentFingerprint,
        nextIndex: snapshot.nextIndex,
      }
    }, { maxElements: this.#snapshotMaxElements, maxTextChars: this.#snapshotMaxTextChars, detail: this.#snapshotDetail })
    this.#acceptSnapshot(result.nextIndex, generation)
    return { stateFingerprint: result.stateFingerprint, contentFingerprint: result.contentFingerprint }
  }

  #registry(): Promise<JSHandle<ReturnType<typeof createSnapshotRegistry>>> {
    if (!this.#snapshotRegistry) {
      const registry = this.pageHandle.evaluateHandle(createSnapshotRegistry, {
        nextIndex: this.#nextElementIndex,
        documentId: randomUUID(),
        interactiveSelector: INTERACTIVE_SELECTOR,
        blockingSelector: BLOCKING_LAYER_SELECTOR,
      })
      this.#snapshotRegistry = registry
      void registry.catch(() => {
        if (this.#snapshotRegistry === registry) this.#snapshotRegistry = undefined
      })
    }
    return this.#snapshotRegistry
  }

  async #captureSnapshot(observe: boolean) {
    const generation = this.#snapshotGeneration
    const registry = await this.#registry()
    const result = await registry.evaluate((state, options) => state.capture(options), {
      maxElements: this.#snapshotMaxElements, maxTextChars: this.#snapshotMaxTextChars, observe,
      detail: this.#snapshotDetail,
    })
    // Navigation may win the race while the old document's evaluation returns.
    // Never publish its indices or reuse them in the next document.
    this.#acceptSnapshot(result.nextIndex, generation)
    const { nextIndex: _nextIndex, ...snapshot } = result
    return snapshot
  }

  #acceptSnapshot(nextIndex: number, generation: number): void {
    this.#nextElementIndex = Math.max(this.#nextElementIndex, nextIndex)
    if (generation !== this.#snapshotGeneration) throw new BrowserRuntimeError('browser-observation-stale')
  }

  describeBlockingLayers(maxElements: number): Promise<readonly BrowserBlockingLayer[]> {
    return this.pageHandle.locator(BLOCKING_LAYER_SELECTOR).evaluateAll((elements, maximum) => {
      return elements.flatMap(element => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        const visible = style.display !== 'none' && style.visibility !== 'hidden'
          && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0
          && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth
        if (!visible || style.pointerEvents === 'none' || element.getAttribute('aria-hidden') === 'true') return []
        const name = element.getAttribute('aria-label')?.trim()
          || element.getAttribute('title')?.trim()
          || element.textContent?.trim().slice(0, 256)
          || ''
        return [{
          tag: element.tagName.toLowerCase(),
          ...(element.getAttribute('role') ? { role: element.getAttribute('role')! } : {}),
          name,
          ...(element.getAttribute('class') ? { className: element.getAttribute('class')!.slice(0, 256) } : {}),
        }]
      }).slice(0, maximum)
    }, maxElements)
  }

  async element(index: number): Promise<BrowserLocatorDriver | undefined> {
    let handle = this.#elements.get(index)
    if (!handle) {
      if (!this.#snapshotRegistry) return undefined
      const generation = this.#snapshotGeneration
      const registry = await this.#snapshotRegistry
      const value = await registry.evaluateHandle((state, id) => state.element(id), index)
      const element = value.asElement()
      if (!element || generation !== this.#snapshotGeneration) {
        await value.dispose().catch(() => undefined)
        return undefined
      }
      handle = element as ElementHandle<HTMLElement | SVGElement>
      this.#elements.set(index, handle)
    }
    const connected = await handle.evaluate(element => element.isConnected).catch(() => false)
    if (!connected) {
      this.#elements.delete(index)
      await handle.dispose().catch(() => undefined)
      return undefined
    }
    return new PlaywrightElementDriver(handle, index)
  }

  async describeFocusedElement(): Promise<BrowserElementDescription | undefined> {
    const handle = (await this.pageHandle.evaluateHandle(() => document.activeElement)).asElement()
    if (!handle) return undefined
    try {
      return await new PlaywrightElementDriver(
        handle as ElementHandle<HTMLElement | SVGElement>,
      ).describeElement()
    } finally {
      await handle.dispose().catch(() => undefined)
    }
  }

  waitForTimeout(milliseconds: number): Promise<void> {
    return this.pageHandle.waitForTimeout(milliseconds)
  }

  screenshot(options?: {
    type: 'png' | 'jpeg'; fullPage?: boolean; quality?: number
    clip?: { x: number; y: number; width: number; height: number }
  }): Promise<Buffer> {
    return this.pageHandle.screenshot(options)
  }

  viewportSize(): { width: number; height: number } | null {
    return this.pageHandle.viewportSize()
  }

  bringToFront(): Promise<void> {
    return this.pageHandle.bringToFront()
  }

  async waitUntilReady(timeout: number): Promise<boolean> {
    try {
      await this.pageHandle.waitForFunction(selector => {
        const interactive = Array.from(document.querySelectorAll(selector))
          .some(element => {
            const style = getComputedStyle(element)
            const rectangle = element.getBoundingClientRect()
            return style.visibility !== 'hidden' && style.display !== 'none'
              && rectangle.width > 0 && rectangle.height > 0
          })
        return interactive || (document.body?.innerText ?? '').trim().length > 0
      }, INTERACTIVE_SELECTOR, { timeout })
      return true
    } catch {
      return false
    }
  }

  async waitForCondition(condition: BrowserWaitForCondition, timeout: number): Promise<void> {
    if (condition.selector) {
      await this.pageHandle.locator(condition.selector).first().waitFor({ state: 'visible', timeout })
      return
    }
    if (condition.role) {
      await this.pageHandle.getByRole(condition.role as never).first().waitFor({ state: 'visible', timeout })
      return
    }
    if (condition.text) {
      await this.pageHandle.getByText(condition.text, { exact: false }).first().waitFor({ state: 'visible', timeout })
      return
    }
    if (condition.url) {
      await this.pageHandle.waitForURL(condition.url, { timeout })
      return
    }
    if (condition.networkIdle) {
      await this.pageHandle.waitForLoadState('networkidle', { timeout })
      return
    }
    throw new BrowserRuntimeError('browser-query-no-match')
  }

  async stateFingerprint(): Promise<string> {
    return (await this.readState()).stateFingerprint
  }

  async contentFingerprint(): Promise<string> {
    return (await this.readState()).contentFingerprint
  }

  async close(): Promise<void> {
    this.#invalidateElements()
    this.abortAction()
    await this.cancelActiveDownloads()
    await this.pageHandle.close().catch(() => undefined)
    await this.cleanupDownloadFiles()
  }

  beginAction(): void {
    this.#actionInProgress = true
    this.#collectActionIntents = true
    this.#actionAborted = false
    this.#actionIntents = 0
    this.#actionIntentResults = 0
    this.#actionRequests.clear()
  }

  async endAction(completed: boolean): Promise<void> {
    if (!completed) {
      this.#collectActionIntents = false
      this.#actionInProgress = false
      this.#actionRequests.clear()
      return
    }
    await this.pageHandle.evaluate(() => Promise.resolve())
    // Exposed-binding notifications travel back to Node asynchronously. Keep
    // the collection window open for one short quiet period so a synchronous
    // burst (for example, two link.click() downloads) is not truncated.
    await this.pageHandle.waitForTimeout(ACTION_INTENT_SETTLE_MS)
    this.#collectActionIntents = false
    while (!this.#actionAborted && this.#actionIntentResults < this.#actionIntents) {
      await new Promise<void>(resolve => this.#actionIntentWaiters.add(resolve))
    }
    this.#actionInProgress = false
    this.#actionRequests.clear()
    if (this.#actionAborted) throw new BrowserRuntimeError('browser-action-closed', true)
  }

  noteActionIntent(): void {
    if (this.#collectActionIntents) this.#actionIntents += 1
  }

  resolveActionIntent(): void {
    if (!this.#actionInProgress) return
    this.#actionIntentResults += 1
    if (this.#actionIntentResults < this.#actionIntents) return
    for (const resolve of this.#actionIntentWaiters) resolve()
    this.#actionIntentWaiters.clear()
  }

  abortAction(): void {
    if (!this.#actionInProgress) return
    this.#actionAborted = true
    this.#collectActionIntents = false
    for (const resolve of this.#actionIntentWaiters) resolve()
    this.#actionIntentWaiters.clear()
  }

  async consumeDownloads(): Promise<readonly BrowserDownloadDriver[]> {
    const downloads = this.#downloads.splice(0)
    return Promise.all(downloads)
  }

  async cancelActiveDownloads(): Promise<void> {
    await Promise.allSettled([...this.#activeDownloads].map(download => download.cancel()))
    await Promise.allSettled([...this.#activeDownloadTasks])
  }

  async cleanupDownloadFiles(): Promise<void> {
    await Promise.allSettled([...this.#activeDownloadTasks])
    const directory = this.#downloadDirectory
    this.#downloadDirectory = undefined
    if (directory) await directory.then(path => rm(path, { recursive: true, force: true })).catch(() => undefined)
  }

  async #captureDownload(download: Download): Promise<BrowserDownloadDriver> {
    this.#downloadDirectory ??= this.#createDownloadDirectory()
    const directory = await this.#downloadDirectory
    const path = join(directory, randomUUID())
    await download.saveAs(path)
    await chmod(path, 0o600)
    const metadata = await stat(path)
    return { name: safeDownloadName(download.suggestedFilename()), path, size: metadata.size }
  }

  async #createDownloadDirectory(): Promise<string> {
    await mkdir(this.downloadRoot, { recursive: true, mode: 0o700 })
    await chmod(this.downloadRoot, 0o700)
    const directory = await mkdtemp(join(this.downloadRoot, 'lease-'))
    await chmod(directory, 0o700)
    return directory
  }

  #invalidateElements(): void {
    this.#snapshotGeneration++
    const registry = this.#snapshotRegistry
    this.#snapshotRegistry = undefined
    if (registry) void registry.then(value => value.dispose()).catch(() => undefined)
    this.#disposeElementHandles()
  }

  #disposeElementHandles(): void {
    const handles = [...this.#elements.values()]
    this.#elements.clear()
    for (const handle of handles) void handle.dispose().catch(() => undefined)
  }
}

interface PersistentPagePolicy {
  readonly policy: BrowserContextPolicy
  readonly reject: (violation: BrowserPolicyViolation) => void
  readonly resolveActionIntent: () => void
}

class PersistentContextPolicyRouter {
  readonly #policies = new Map<Page, PersistentPagePolicy>()

  constructor(private readonly contextHandle: BrowserContext) {}

  async install(): Promise<void> {
    await this.contextHandle.route('**/*', async route => {
      const request = route.request()
      let requestPage: Page | undefined
      try {
        requestPage = request.frame().page()
      } catch {
        requestPage = undefined
      }
      let registration = requestPage ? this.#policies.get(requestPage) : undefined
      if (!registration && requestPage) {
        const opener = await requestPage.opener().catch(() => null)
        registration = opener ? this.#policies.get(opener) : undefined
        if (registration) {
          registration.reject({
            code: 'browser-popup-denied',
            detail: policyRequestDetail(request.method(), request.url()),
          })
          registration.resolveActionIntent()
          await route.abort('blockedbyclient')
          return
        }
      }
      if (!registration) {
        await route.continue()
        return
      }
      if (!isBrowserUrlAllowed(request.url(), registration.policy.allowedDomains)) {
        if (request.isNavigationRequest()) {
          registration.reject({
            code: 'browser-navigation-denied',
            detail: policyRequestDetail(request.method(), request.url()),
          })
          registration.resolveActionIntent()
        }
        await route.abort('blockedbyclient')
        return
      }
      if (!registration.policy.allowSubmit && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        registration.reject({
          code: 'browser-submit-denied',
          detail: policyRequestDetail(request.method(), request.url()),
        })
        await route.abort('blockedbyclient')
        return
      }
      await route.continue()
    })
  }

  register(page: Page, registration: PersistentPagePolicy): void {
    this.#policies.set(page, registration)
  }

  unregister(page: Page): void {
    this.#policies.delete(page)
  }
}

class PlaywrightContextDriver implements BrowserContextDriver {
  readonly #pages = new Map<Page, PlaywrightPageDriver>()
  #policyViolation: BrowserPolicyViolation | undefined

  constructor(
    private readonly contextHandle: BrowserContext,
    private readonly domainProxy: BrowserDomainProxy | undefined,
    private readonly downloadRoot: string,
    private readonly ownsContext = true,
    private readonly persistentPolicyRouter?: PersistentContextPolicyRouter,
    private readonly windowGeometry?: BrowserWindowGeometry,
  ) {}

  async newPage(): Promise<BrowserPageDriver> {
    const page = await this.contextHandle.newPage()
    try {
      await this.windowGeometry?.normalize(page)
    } catch (error) {
      await page.close().catch(() => undefined)
      throw error
    }
    return this.#wrap(page)
  }

  async installPolicy(page: BrowserPageDriver, policy: BrowserContextPolicy): Promise<void> {
    if (!(page instanceof PlaywrightPageDriver)) throw new Error('browser-page-driver-mismatch')
    this.domainProxy?.allow(policy.allowedDomains)
    const actionIntentBinding = `__byclaw_action_intent_${randomUUID().replaceAll('-', '')}`
    await page.pageHandle.exposeBinding(actionIntentBinding, () => page.noteActionIntent())
    await page.pageHandle.addInitScript(bindingName => {
      const report = () => {
        const binding = (globalThis as Record<string, unknown>)[bindingName]
        if (typeof binding === 'function') void (binding as () => Promise<unknown>)()
      }
      const reportAfterDispatch = (
        event: Event,
        target: HTMLAnchorElement | HTMLAreaElement | HTMLFormElement,
      ) => {
        queueMicrotask(() => {
          if (event.defaultPrevented || (target.target && target.target !== '_self')) return
          const destination = target instanceof HTMLFormElement ? target.action : target.href
          if (/^https?:/i.test(destination)) report()
        })
      }
      document.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target.closest('a,area') : null
        if (target instanceof HTMLAnchorElement || target instanceof HTMLAreaElement) {
          reportAfterDispatch(event, target)
        }
      }, true)
      document.addEventListener('submit', event => {
        if (event.target instanceof HTMLFormElement) reportAfterDispatch(event, event.target)
      }, true)
    }, actionIntentBinding)
    const popupBinding = `__byclaw_popup_${randomUUID().replaceAll('-', '')}`
    await page.pageHandle.exposeBinding(popupBinding, () => {
      this.#policyViolation ??= {
        code: 'browser-popup-denied',
        detail: 'page script attempted to open a popup',
      }
    })
    await page.pageHandle.addInitScript(bindingName => {
      const report = () => {
        const binding = (globalThis as Record<string, unknown>)[bindingName]
        if (typeof binding === 'function') void (binding as () => Promise<unknown>)()
      }
      Object.defineProperty(globalThis, 'open', {
        configurable: false,
        writable: false,
        value: () => {
          report()
          return null
        },
      })
      const nativeSubmit = HTMLFormElement.prototype.submit
      Object.defineProperty(HTMLFormElement.prototype, 'submit', {
        configurable: false,
        writable: false,
        value(this: HTMLFormElement) {
          if (this.target && this.target !== '_self') {
            report()
            return
          }
          return nativeSubmit.call(this)
        },
      })
      document.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target.closest('a,area') : null
        if (!target || !target.getAttribute('target') || target.getAttribute('target') === '_self') return
        event.preventDefault()
        event.stopImmediatePropagation()
        report()
      }, true)
      document.addEventListener('submit', event => {
        const form = event.target instanceof HTMLFormElement ? event.target : null
        if (!form || !form.target || form.target === '_self') return
        event.preventDefault()
        event.stopImmediatePropagation()
        report()
      }, true)
    }, popupBinding)
    const intercept = async (route: Route) => {
      const request = route.request()
      if (this.ownsContext) {
        let requestPage: Page | undefined
        try {
          requestPage = request.frame().page()
        } catch {
          requestPage = undefined
        }
        if (requestPage !== page.pageHandle) {
          this.#policyViolation ??= {
            code: 'browser-popup-denied',
            detail: policyRequestDetail(request.method(), request.url()),
          }
          page.resolveActionIntent()
          await route.abort('blockedbyclient')
          return
        }
      }
      if (request.isNavigationRequest() && !isBrowserUrlAllowed(request.url(), policy.allowedDomains)) {
        this.#policyViolation ??= {
          code: 'browser-navigation-denied',
          detail: policyRequestDetail(request.method(), request.url()),
        }
        page.resolveActionIntent()
        await route.abort('blockedbyclient')
        return
      }
      if (!policy.allowSubmit && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        this.#policyViolation ??= {
          code: 'browser-submit-denied',
          detail: policyRequestDetail(request.method(), request.url()),
        }
        await route.abort('blockedbyclient')
        return
      }
      await route.continue()
    }
    if (this.persistentPolicyRouter) {
      this.persistentPolicyRouter.register(page.pageHandle, {
        policy,
        reject: violation => { this.#policyViolation ??= violation },
        resolveActionIntent: () => page.resolveActionIntent(),
      })
      await page.pageHandle.routeWebSocket('**/*', async webSocket => {
        if (isBrowserWebSocketAllowed(webSocket.url(), policy.allowedDomains)) {
          webSocket.connectToServer()
          return
        }
        await webSocket.close({ code: 1008, reason: 'Blocked by browser policy' })
      })
    } else {
      await this.contextHandle.route('**/*', intercept)
    }
    const onPopup = (candidate: Page) => {
      this.#wrap(candidate)
      this.#policyViolation ??= {
        code: 'browser-popup-denied',
        detail: 'page created an additional popup context',
      }
      void candidate.close().catch(() => undefined)
    }
    if (this.ownsContext) this.contextHandle.on('page', onPopup)
    else page.pageHandle.on('popup', onPopup)
  }

  consumePolicyViolation(): BrowserPolicyViolation | undefined {
    const violation = this.#policyViolation
    this.#policyViolation = undefined
    return violation
  }

  pages(): readonly BrowserPageDriver[] {
    return [...this.#pages.values()]
  }

  async close(): Promise<void> {
    const pages = [...this.#pages.values()]
    for (const page of pages) this.persistentPolicyRouter?.unregister(page.pageHandle)
    for (const page of pages) page.abortAction()
    await Promise.allSettled(pages.map(page => page.cancelActiveDownloads()))
    if (this.ownsContext) {
      this.windowGeometry?.stop()
      await this.contextHandle.close().catch(() => undefined)
      await this.windowGeometry?.close()
    } else {
      await Promise.allSettled(pages.map(page => page.close()))
    }
    await Promise.allSettled(pages.map(page => page.cleanupDownloadFiles()))
    await this.domainProxy?.close().catch(() => undefined)
  }

  #wrap(page: Page): PlaywrightPageDriver {
    const existing = this.#pages.get(page)
    if (existing) return existing
    const wrapped = new PlaywrightPageDriver(page, this.downloadRoot)
    this.#pages.set(page, wrapped)
    return wrapped
  }
}

class PlaywrightBrowserDriverInstance implements BrowserDriverInstance {
  readonly pid: number
  #closed = false

  constructor(
    private readonly browserHandle: Browser,
    private readonly browserServer: BrowserServer,
    private readonly downloadRoot: string,
    private readonly windowSize?: BrowserWindowSize,
  ) {
    const pid = browserServer.process().pid
    if (pid === undefined) throw new Error('browser-process-id-unavailable')
    this.pid = pid
  }

  isConnected(): boolean {
    return !this.#closed && this.browserHandle.isConnected()
  }

  onDisconnected(listener: () => void): () => void {
    this.browserHandle.on('disconnected', listener)
    return () => this.browserHandle.off('disconnected', listener)
  }

  async newContext(options: { acceptDownloads: true }): Promise<BrowserContextDriver> {
    const domainProxy = new BrowserDomainProxy()
    const proxyServer = await domainProxy.listen()
    let context: BrowserContext | undefined
    let windowGeometry: BrowserWindowGeometry | undefined
    try {
      context = await this.browserHandle.newContext({
        ...options,
        proxy: { server: proxyServer },
        serviceWorkers: 'block',
        ...(this.windowSize ? { viewport: null } : {}),
      })
      if (this.windowSize) {
        windowGeometry = new BrowserWindowGeometry(context, this.windowSize)
        await windowGeometry.install()
      }
      return new PlaywrightContextDriver(context, domainProxy, this.downloadRoot, true, undefined, windowGeometry)
    } catch (error) {
      windowGeometry?.stop()
      await context?.close().catch(() => undefined)
      await windowGeometry?.close()
      await domainProxy.close().catch(() => undefined)
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.browserHandle.close().catch(() => undefined)
    await closeOwnedBrowserServer(this.browserServer).catch(() => undefined)
  }
}

class PlaywrightPersistentBrowserDriverInstance implements BrowserDriverInstance {
  readonly #disconnectListeners = new Set<() => void>()
  #closed = false

  constructor(
    private readonly contextHandle: BrowserContext,
    private readonly downloadRoot: string,
    private readonly policyRouter: PersistentContextPolicyRouter,
    private readonly windowGeometry?: BrowserWindowGeometry,
  ) {
    const disconnected = () => {
      if (this.#closed) return
      this.#closed = true
      this.windowGeometry?.stop()
      for (const listener of this.#disconnectListeners) listener()
    }
    this.contextHandle.once('close', disconnected)
    this.contextHandle.browser()?.once('disconnected', disconnected)
  }

  isConnected(): boolean {
    return !this.#closed && (this.contextHandle.browser()?.isConnected() ?? true)
  }

  onDisconnected(listener: () => void): () => void {
    this.#disconnectListeners.add(listener)
    return () => this.#disconnectListeners.delete(listener)
  }

  async newContext(options: { acceptDownloads: true }): Promise<BrowserContextDriver> {
    if (!options.acceptDownloads) throw new Error('browser-downloads-required')
    return new PlaywrightContextDriver(
      this.contextHandle,
      undefined,
      this.downloadRoot,
      false,
      this.policyRouter,
      this.windowGeometry,
    )
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.windowGeometry?.stop()
    await this.contextHandle.close().catch(() => undefined)
    await this.windowGeometry?.close()
  }
}

export class PlaywrightBrowserDriver implements BrowserDriver {
  constructor(
    private readonly downloadRoot = join(tmpdir(), 'dsh-browser-downloads'),
    private readonly profileExclusive = false,
  ) {}

  async launch(options: {
    readonly executablePath?: string
    readonly headless: boolean
    readonly environment?: Readonly<Record<string, string>>
    readonly args?: readonly string[]
    readonly ignoreDefaultArgs?: readonly string[]
    readonly userDataDir?: string
    readonly windowSize?: BrowserWindowSize
  }): Promise<BrowserDriverInstance> {
    const windowSize = !options.headless ? options.windowSize : undefined
    const args = [...options.args ?? [], ...(windowSize ? [
      `--window-size=${windowSize.width},${windowSize.height}`, '--window-position=0,0',
    ] : [])]
    const launchOptions = {
      ...(options.executablePath ? { executablePath: options.executablePath } : {}),
      headless: options.headless,
      ...(options.environment ? { env: { ...process.env, ...options.environment } } : {}),
      ...(args.length ? { args } : {}),
      ...(options.ignoreDefaultArgs?.length ? { ignoreDefaultArgs: [...options.ignoreDefaultArgs] } : {}),
    }
    if (options.userDataDir) {
      await mkdir(options.userDataDir, { recursive: true, mode: 0o700 })
      await chmod(options.userDataDir, 0o700)
      if (this.profileExclusive) await clearChromiumSingletonFiles(options.userDataDir)
      await enablePersistentProfileDeveloperMode(options.userDataDir, options.args)
      const context = await chromium.launchPersistentContext(options.userDataDir, {
        ...launchOptions,
        acceptDownloads: true,
        serviceWorkers: 'block',
        ...(windowSize ? { viewport: null } : {}),
      })
      const windowGeometry = windowSize ? new BrowserWindowGeometry(context, windowSize) : undefined
      try {
        await windowGeometry?.install()
        if (context.pages().length === 0) {
          const page = await context.newPage()
          await windowGeometry?.normalize(page)
        }
        const policyRouter = new PersistentContextPolicyRouter(context)
        await policyRouter.install()
        return new PlaywrightPersistentBrowserDriverInstance(context, this.downloadRoot, policyRouter, windowGeometry)
      } catch (error) {
        windowGeometry?.stop()
        await context.close().catch(() => undefined)
        await windowGeometry?.close()
        throw error
      }
    }
    const browserServer = await chromium.launchServer({
      ...launchOptions,
    })
    try {
      const browser = await chromium.connect(browserServer.wsEndpoint())
      return new PlaywrightBrowserDriverInstance(browser, browserServer, this.downloadRoot, windowSize)
    } catch (error) {
      await browserServer.close().catch(() => undefined)
      throw error
    }
  }
}

export interface BrowserdDesktopManager extends BrowserSessionDesktopManager {
  open(sessionId: string, leaseId: string, signal: AbortSignal): Promise<SessionDesktop>
  targetFor(sessionId: string): { host: '127.0.0.1'; port: number } | undefined
  defaultSessionId(): string | undefined
}

export interface BrowserdOptions extends Omit<
  BrowserRuntimeOptions,
  'driver' | 'desktopManager' | 'browserEnvironment' | 'keepBrowserAlive' | 'windowSize'
> {
  readonly socketPath: string
  readonly socketMode?: number
  readonly downloadRoot?: string
  readonly screenshotRoot?: string
  readonly driver?: BrowserDriver
  readonly maxPendingRequests?: number
  readonly maxPendingBytes?: number
  readonly viewerMode?: 'none' | 'novnc' | 'shared-novnc'
  readonly viewerHost?: string
  readonly viewerPort?: number
  readonly novncRoot?: string
  readonly desktopRuntimeRoot?: string
  readonly desktopScreen?: string
  readonly displayRange?: IntegerRange
  readonly rfbPortRange?: IntegerRange
  readonly websockifyPortRange?: IntegerRange
  readonly desktopReadinessTimeoutMs?: number
  readonly desktopManager?: BrowserdDesktopManager
  readonly profileExclusive?: boolean
  readonly activationSocketPath?: string
  readonly bycli?: Omit<BycliRuntimeOptions, 'ensureBrowser'>
}

export interface BrowserdServer {
  readonly socketPath: string
  readonly viewerPort?: number
  close(): Promise<void>
}

interface BrokerFrameJob {
  readonly frame: Buffer
  readonly parsed: unknown
  readonly requestId: string
  readonly requestType: unknown
  readonly leaseId: string | undefined
  readonly capability: string | undefined
  readonly controller: AbortController
  accounted: boolean
}

interface LeaseLane {
  tail: Promise<void>
  pendingRequests: number
  pendingBytes: number
}

interface ConnectionState {
  readonly socket: Socket
  readonly leaseIds: Set<string>
  readonly closedLeaseIds: Set<string>
  readonly abortController: AbortController
  readonly lanes: Map<string, LeaseLane>
  readonly requests: Map<string, BrokerFrameJob>
  readonly work: Set<Promise<void>>
  buffer: Buffer
  pendingRequests: number
  pendingBytes: number
  controlRequests: number
  controlBytes: number
  closed: boolean
}

function errorCode(error: unknown): string {
  if (error instanceof BrowserRuntimeError && /^[a-z0-9-]{1,80}$/.test(error.code)) return error.code
  return 'browser-broker-operation-failed'
}

function errorPayload(error: unknown): BrowserBrokerErrorResponse['error'] {
  const code = errorCode(error)
  if (!(error instanceof BrowserRuntimeError)) return { code, fatal: true, recoverable: false }
  return {
    code,
    ...(error.detail ? { detail: error.detail.slice(0, 512) } : {}),
    fatal: error.fatal,
    recoverable: error.recoverable,
  }
}

function requestIdFrom(value: unknown): string {
  if (!value || typeof value !== 'object') return 'unknown'
  const requestId = (value as Record<string, unknown>).requestId
  return typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 256
    ? requestId
    : 'unknown'
}

function secureCredentialEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.byteLength === expectedBytes.byteLength
    && timingSafeEqual(actualBytes, expectedBytes)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function asCancelRequest(value: unknown): BrowserBrokerCancelRequest | undefined {
  if (!isRecord(value) || value.type !== 'cancel') return undefined
  const hasLease = value.leaseId !== undefined || value.capability !== undefined
  const keys = hasLease
    ? ['type', 'requestId', 'secret', 'targetRequestId', 'leaseId', 'capability']
    : ['type', 'requestId', 'secret', 'targetRequestId']
  if (!hasOnlyKeys(value, keys)
    || !isBoundedString(value.requestId, 256)
    || !isBoundedString(value.targetRequestId, 256)
    || !isBoundedString(value.secret, 512)
    || (hasLease && (!isBoundedString(value.leaseId, 256)
      || !isBoundedString(value.capability, 512)))) return undefined
  return value as unknown as BrowserBrokerCancelRequest
}

function serializeResponse(response: BrowserBrokerResponse): string {
  const serialized = JSON.stringify(response)
  if (Buffer.byteLength(serialized, 'utf8') <= BROWSER_BROKER_MAX_FRAME_BYTES) return `${serialized}\n`
  const fallback: BrowserBrokerErrorResponse = {
    type: 'error',
    requestId: response.requestId,
    error: { code: 'browser-broker-response-too-large' },
  }
  return `${JSON.stringify(fallback)}\n`
}

export async function startBrowserd(options: BrowserdOptions): Promise<BrowserdServer> {
  if (!options.socketPath) throw new Error('browser-broker-invalid-socket-path')
  const maxPendingRequests = options.maxPendingRequests ?? 32
  const maxPendingBytes = options.maxPendingBytes ?? BROWSER_BROKER_MAX_FRAME_BYTES
  const socketMode = options.socketMode ?? 0o600
  if (
    !Number.isSafeInteger(maxPendingRequests) || maxPendingRequests <= 0 ||
    !Number.isSafeInteger(maxPendingBytes) || maxPendingBytes <= 0 ||
    !Number.isSafeInteger(socketMode) || socketMode < 0o600 || socketMode > 0o660
  ) {
    throw new Error('browserd-invalid-queue-config')
  }
  await mkdir(dirname(options.socketPath), { recursive: true, mode: 0o700 })
  const viewerMode = options.viewerMode ?? 'none'
  if (viewerMode !== 'none' && viewerMode !== 'novnc' && viewerMode !== 'shared-novnc') {
    throw new Error('browser-viewer-invalid-mode')
  }
  if (viewerMode === 'novnc' && options.userDataDir) {
    throw new Error('browser-persistent-profile-viewer-unsupported')
  }
  let desktopManager: BrowserdDesktopManager | undefined
  let sharedDesktop: SessionDesktop | undefined
  let runtime: BrowserRuntime | undefined
  let viewerGateway: ViewerGateway | undefined
  let activationServer: Awaited<ReturnType<typeof startActivationServer>> | undefined
  let bycli: BycliRuntime | undefined
  const starting = new AbortController()
  const desktopScreen = options.desktopScreen ?? '1365x768x24'
  const windowSize = viewerMode === 'none' ? undefined : parseDesktopScreen(desktopScreen)
  if (viewerMode === 'novnc' || viewerMode === 'shared-novnc') {
    if (!options.novncRoot) throw new Error('browser-viewer-root-not-found')
    const environment = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
    desktopManager = options.desktopManager ?? new SessionDesktopManager({
      runtimeRoot: options.desktopRuntimeRoot ?? '/run/byclaw-browser/sessions',
      screen: desktopScreen,
      displayRange: options.displayRange ?? { start: 100, end: 199 },
      rfbPortRange: options.rfbPortRange ?? { start: 5901, end: 6000 },
      websockifyPortRange: options.websockifyPortRange ?? { start: 6101, end: 6200 },
      readinessTimeoutMs: options.desktopReadinessTimeoutMs ?? 15_000,
      environment,
      onRouteClosed: sessionId => viewerGateway?.closeSession(sessionId),
    })
    try {
      viewerGateway = await startViewerGateway({
        host: options.viewerHost ?? '0.0.0.0',
        port: options.viewerPort ?? 8081,
        novncRoot: options.novncRoot,
        targetFor: sessionId => desktopManager?.targetFor(sessionId),
        defaultSessionId: () => desktopManager?.defaultSessionId(),
        ...(viewerMode === 'shared-novnc' ? {
          ensureStarted: async () => {
            if (!runtime) throw new Error('browser-runtime-unavailable')
            await runtime.start()
          },
        } : {}),
        ...(browserGoalEnabled(environment) ? {
          sharedGoalViewer: viewerMode === 'shared-novnc',
          goalState: () => runtime?.goalControl.state(),
          goalControl: (runId: string, generation: number, command: 'pause' | 'resume' | 'cancel') => {
            if (!runtime) throw new Error('browser-goal-unavailable')
            const state = runtime.goalControl.control(runId, generation, command)
            if (command !== 'pause') viewerGateway?.closeAllSessions()
            return state
          },
        } : {}),
      })
    } catch (error) {
      await desktopManager.close().catch(() => undefined)
      throw error
    }
  }
  try {
    const driver = options.driver ?? new PlaywrightBrowserDriver(options.downloadRoot, options.profileExclusive === true)
    runtime = new BrowserRuntime({
      goalEnabled: browserGoalEnabled(),
      driver: viewerMode !== 'shared-novnc' ? driver : {
        async launch(launchOptions) {
          starting.signal.throwIfAborted()
          // BrowserRuntime coalesces concurrent launch attempts. Desktop and Chrome
          // are one lazy unit, reused by tools, noVNC and the byCLI extension.
          try {
            sharedDesktop ??= await desktopManager!.open('shared', 'browserd-shared', starting.signal)
            const browser = await driver.launch({ ...launchOptions,
              environment: sharedDesktop.environment,
              windowSize: sharedDesktop.windowSize ?? windowSize,
            })
            sharedDesktop.publish()
            return browser
          } catch (error) {
            process.stderr.write(`browserd: on-demand startup failed: ${formatBrowserdStartupError(error)}\n`)
            await sharedDesktop?.close().catch(() => undefined)
            sharedDesktop = undefined
            throw error
          }
        },
      },
      secret: options.secret,
      ...(options.executablePath ? { executablePath: options.executablePath } : {}),
      ...(viewerMode === 'shared-novnc'
        ? { headless: false, keepBrowserAlive: true }
        : options.headless !== undefined ? { headless: options.headless } : {}),
      ...(windowSize ? { windowSize: sharedDesktop?.windowSize ?? windowSize } : {}),
      ...(options.args?.length ? { args: options.args } : {}),
      ...(options.ignoreDefaultArgs?.length ? { ignoreDefaultArgs: options.ignoreDefaultArgs } : {}),
      ...(options.userDataDir ? { userDataDir: options.userDataDir } : {}),
      ...(options.idleBrowserMs !== undefined ? { idleBrowserMs: options.idleBrowserMs } : {}),
      ...(options.maxTextChars !== undefined ? { maxTextChars: options.maxTextChars } : {}),
      ...(options.maxElements !== undefined ? { maxElements: options.maxElements } : {}),
      ...(options.maxWaitMs !== undefined ? { maxWaitMs: options.maxWaitMs } : {}),
      ...(options.maxScreenshotBytes !== undefined ? { maxScreenshotBytes: options.maxScreenshotBytes } : {}),
      ...(options.screenshotRoot ? { screenshotRoot: options.screenshotRoot } : {}),
      ...(options.setTimer ? { setTimer: options.setTimer } : {}),
      ...(options.clearTimer ? { clearTimer: options.clearTimer } : {}),
      ...(options.onBrowserLifecycle ? { onBrowserLifecycle: options.onBrowserLifecycle } : {}),
      ...(viewerMode === 'novnc' && desktopManager ? { desktopManager } : {}),
    })
    if (options.bycli) {
      bycli = new BycliRuntime({ ...options.bycli, ensureBrowser: () => runtime!.start() })
    }
    if (options.activationSocketPath) {
      activationServer = await startActivationServer(options.activationSocketPath, async () => {
        if (!bycli) throw new Error('bycli-disabled')
        await bycli.ensure()
      })
    }
  } catch (error) {
    starting.abort()
    await activationServer?.close().catch(() => undefined)
    await bycli?.close().catch(() => undefined)
    await viewerGateway?.close().catch(() => undefined)
    await runtime?.shutdown().catch(() => undefined)
    await desktopManager?.close().catch(() => undefined)
    throw error
  }
  if (!runtime) throw new Error('browser-runtime-startup-failed')
  const activeRuntime = runtime
  const connections = new Set<ConnectionState>()
  let stopping = false
  const server = createServer(socket => {
    if (stopping) {
      socket.destroy()
      return
    }
    const state: ConnectionState = {
      socket,
      leaseIds: new Set(),
      closedLeaseIds: new Set(),
      abortController: new AbortController(),
      lanes: new Map(),
      requests: new Map(),
      work: new Set(),
      buffer: Buffer.alloc(0),
      pendingRequests: 0,
      pendingBytes: 0,
      controlRequests: 0,
      controlBytes: 0,
      closed: false,
    }
    connections.add(state)
    socket.on('data', chunk => onData(state, chunk))
    socket.on('error', () => undefined)
    socket.once('close', () => {
      state.closed = true
      state.abortController.abort()
      for (const request of state.requests.values()) request.controller.abort()
      connections.delete(state)
      const leaseIds = [...state.leaseIds]
      state.leaseIds.clear()
      void Promise.all(leaseIds.map(leaseId => activeRuntime.closeLease(leaseId)))
    })
  })

  function write(state: ConnectionState, response: BrowserBrokerResponse): void {
    if (!state.closed && !state.socket.destroyed) state.socket.write(serializeResponse(response))
  }

  function writeError(state: ConnectionState, requestId: string, codeOrError: string | unknown): void {
    write(state, {
      type: 'error', requestId,
      error: typeof codeOrError === 'string' ? { code: codeOrError } : errorPayload(codeOrError),
    })
  }

  function finishJob(state: ConnectionState, lane: LeaseLane, job: BrokerFrameJob): void {
    if (!job.accounted) return
    job.accounted = false
    state.pendingRequests -= 1
    state.pendingBytes -= job.frame.byteLength
    lane.pendingRequests -= 1
    lane.pendingBytes -= job.frame.byteLength
  }

  function trackWork(state: ConnectionState, promise: Promise<void>): void {
    state.work.add(promise)
    void promise.finally(() => state.work.delete(promise)).catch(() => undefined)
  }

  async function dispatchBusiness(state: ConnectionState, job: BrokerFrameJob): Promise<void> {
    try {
      if (state.closed) return
      if (job.leaseId && state.closedLeaseIds.has(job.leaseId)) {
        writeError(state, job.requestId, 'browser-lease-not-found')
        return
      }
      const operationSignal = AbortSignal.any([
        state.abortController.signal,
        job.controller.signal,
      ])
      const result = await activeRuntime.dispatch(job.parsed as BrowserBrokerRequest, operationSignal)
      if (job.requestType === 'open' && job.leaseId) {
        if (state.closed || job.controller.signal.aborted) await activeRuntime.closeLease(job.leaseId)
        else state.leaseIds.add(job.leaseId)
      }
      write(state, { type: 'ok', requestId: job.requestId, result })
    } catch (error) {
      writeError(state, job.requestId, error)
    } finally {
      if (state.requests.get(job.requestId) === job) state.requests.delete(job.requestId)
    }
  }

  function abortLeaseLane(state: ConnectionState, leaseId: string): void {
    for (const request of state.requests.values()) {
      if (request.leaseId === leaseId) request.controller.abort()
    }
  }

  async function dispatchControl(state: ConnectionState, parsed: unknown): Promise<void> {
    const requestId = requestIdFrom(parsed)
    const request = isRecord(parsed) ? parsed : undefined
    try {
      if (!request || !isBoundedString(request.secret, 512)) {
        throw new BrowserRuntimeError('browser-broker-invalid-request')
      }
      activeRuntime.authorizeSecret(request.secret)
      switch (request.type) {
        case 'goal': {
          const result = await activeRuntime.dispatch(parsed as BrowserBrokerRequest)
          const goal = activeRuntime.goalControl.state()
          if (goal && goal.status !== 'paused') viewerGateway?.closeAllSessions()
          write(state, { type: 'ok', requestId, result })
          return
        }
        case 'cancel': {
          const cancel = asCancelRequest(request)
          if (!cancel) throw new BrowserRuntimeError('browser-broker-invalid-request')
          const target = state.requests.get(cancel.targetRequestId)
          if (!target) {
            write(state, { type: 'ok', requestId, result: { cancelled: false } })
            return
          }
          if (target.leaseId) {
            if (cancel.leaseId !== target.leaseId
              || typeof cancel.capability !== 'string'
              || typeof target.capability !== 'string'
              || !secureCredentialEqual(cancel.capability, target.capability)) {
              throw new BrowserRuntimeError('browser-lease-unauthorized')
            }
            let opened = true
            try {
              activeRuntime.authorizeLease(cancel.secret, cancel.leaseId, cancel.capability)
            } catch (error) {
              opened = false
              if (target.requestType !== 'open'
                || !(error instanceof BrowserRuntimeError)
                || error.code !== 'browser-lease-not-found') throw error
            }
            target.controller.abort()
            if (opened) {
              state.closedLeaseIds.add(target.leaseId)
              await activeRuntime.closeLease(target.leaseId)
              state.leaseIds.delete(target.leaseId)
            }
          } else {
            if (cancel.leaseId !== undefined || cancel.capability !== undefined) {
              throw new BrowserRuntimeError('browser-broker-invalid-request')
            }
            target.controller.abort()
          }
          write(state, { type: 'ok', requestId, result: { cancelled: true } })
          return
        }
        case 'close': {
          if (!hasOnlyKeys(request, ['type', 'requestId', 'secret', 'leaseId', 'capability'])
            || !isBoundedString(request.leaseId, 256)
            || !isBoundedString(request.capability, 512)) {
            throw new BrowserRuntimeError('browser-broker-invalid-request')
          }
          activeRuntime.authorizeLease(request.secret, request.leaseId, request.capability)
          state.closedLeaseIds.add(request.leaseId)
          abortLeaseLane(state, request.leaseId)
          await activeRuntime.closeLease(request.leaseId)
          state.leaseIds.delete(request.leaseId)
          write(state, { type: 'ok', requestId, result: null })
          return
        }
        case 'shutdown': {
          if (!hasOnlyKeys(request, ['type', 'requestId', 'secret'])) {
            throw new BrowserRuntimeError('browser-broker-invalid-request')
          }
          for (const connection of connections) {
            for (const active of connection.requests.values()) active.controller.abort()
          }
          await activeRuntime.shutdown()
          write(state, { type: 'ok', requestId, result: null })
          return
        }
        default:
          throw new BrowserRuntimeError('browser-broker-invalid-request')
      }
    } catch (error) {
      writeError(state, requestId, error)
    }
  }

  function scheduleControl(state: ConnectionState, parsed: unknown, bytes: number): void {
    // Controls have their own bounded pool so cleanup remains available when
    // business work is saturated and independent leases can close together.
    if (state.controlRequests >= maxPendingRequests
      || state.controlBytes + bytes > maxPendingBytes) {
      writeError(state, requestIdFrom(parsed), 'browser-broker-overloaded')
      return
    }
    state.controlRequests += 1
    state.controlBytes += bytes
    const work = dispatchControl(state, parsed).finally(() => {
      state.controlRequests -= 1
      state.controlBytes -= bytes
    })
    trackWork(state, work)
  }

  function scheduleBusiness(state: ConnectionState, job: BrokerFrameJob): void {
    const laneKey = job.leaseId ?? '__connection__'
    const lane = state.lanes.get(laneKey) ?? {
      tail: Promise.resolve(), pendingRequests: 0, pendingBytes: 0,
    }
    if (state.requests.has(job.requestId)
      || state.pendingRequests + state.controlRequests >= maxPendingRequests
      || state.pendingBytes + state.controlBytes + job.frame.byteLength > maxPendingBytes
      || lane.pendingRequests >= maxPendingRequests
      || lane.pendingBytes + job.frame.byteLength > maxPendingBytes) {
      const response = serializeResponse({
        type: 'error',
        requestId: job.requestId,
        error: { code: 'browser-broker-overloaded' },
      })
      state.closed = true
      state.abortController.abort()
      for (const request of state.requests.values()) request.controller.abort()
      state.socket.end(response)
      return
    }
    job.accounted = true
    state.pendingRequests += 1
    state.pendingBytes += job.frame.byteLength
    lane.pendingRequests += 1
    lane.pendingBytes += job.frame.byteLength
    state.requests.set(job.requestId, job)
    state.lanes.set(laneKey, lane)
    const run = lane.tail.catch(() => undefined).then(() => dispatchBusiness(state, job))
    const settled = run.catch(() => undefined).finally(() => {
      finishJob(state, lane, job)
      if (lane.tail === settled) state.lanes.delete(laneKey)
    })
    lane.tail = settled
    trackWork(state, settled)
  }

  function onData(state: ConnectionState, chunk: Buffer): void {
    if (state.closed) return
    state.buffer = Buffer.concat([state.buffer, chunk])
    if (state.buffer.byteLength > MAX_BROWSERD_CONNECTION_BUFFER_BYTES && state.buffer.indexOf(0x0a) < 0) {
      write(state, { type: 'error', requestId: 'unknown', error: { code: 'browser-broker-frame-too-large' } })
      state.socket.end()
      return
    }
    while (true) {
      const newline = state.buffer.indexOf(0x0a)
      if (newline < 0) return
      const frame = state.buffer.subarray(0, newline)
      state.buffer = state.buffer.subarray(newline + 1)
      if (frame.byteLength > BROWSER_BROKER_MAX_FRAME_BYTES) {
        write(state, { type: 'error', requestId: 'unknown', error: { code: 'browser-broker-frame-too-large' } })
        state.socket.end()
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(frame.toString('utf8'))
      } catch {
        writeError(state, 'unknown', 'browser-broker-protocol')
        state.socket.end()
        return
      }
      const record = isRecord(parsed) ? parsed : undefined
      if (record?.type === 'goal' || record?.type === 'cancel' || record?.type === 'close' || record?.type === 'shutdown') {
        scheduleControl(state, parsed, frame.byteLength)
        continue
      }
      const job: BrokerFrameJob = {
        frame,
        parsed,
        requestId: requestIdFrom(parsed),
        requestType: record?.type,
        leaseId: typeof record?.leaseId === 'string' ? record.leaseId : undefined,
        capability: typeof record?.capability === 'string' ? record.capability : undefined,
        controller: new AbortController(),
        accounted: false,
      }
      scheduleBusiness(state, job)
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.removeListener('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(options.socketPath)
    })
    await chmod(options.socketPath, socketMode)
  } catch (error) {
    stopping = true
    starting.abort()
    await activationServer?.close().catch(() => undefined)
    await bycli?.close().catch(() => undefined)
    for (const state of connections) {
      state.closed = true
      state.abortController.abort()
      state.socket.destroy()
    }
    await new Promise<void>(resolve => {
      if (!server.listening) return resolve()
      server.close(() => resolve())
    })
    await viewerGateway?.close().catch(() => undefined)
    await activeRuntime.shutdown().catch(() => undefined)
    await desktopManager?.close().catch(() => undefined)
    await unlink(options.socketPath).catch(() => undefined)
    throw error
  }

  let closePromise: Promise<void> | undefined
  return {
    socketPath: options.socketPath,
    ...(viewerGateway ? { viewerPort: viewerGateway.port } : {}),
    close() {
      if (closePromise) return closePromise
      closePromise = (async () => {
        stopping = true
        starting.abort()
        await activationServer?.close().catch(() => undefined)
        await bycli?.close().catch(() => undefined)
        const stoppedAccepting = new Promise<void>(resolve => {
          if (!server.listening) return resolve()
          server.close(() => resolve())
        })
        const active = [...connections]
        for (const state of active) {
          state.closed = true
          state.abortController.abort()
          for (const request of state.requests.values()) request.controller.abort()
          state.socket.destroy()
        }
        await viewerGateway?.close().catch(() => undefined)
        await activeRuntime.shutdown()
        await desktopManager?.close().catch(() => undefined)
        await Promise.all(active.map(state => Promise.allSettled([...state.work])))
        connections.clear()
        await stoppedAccepting
        await unlink(options.socketPath).catch(() => undefined)
      })()
      return closePromise
    },
  }
}

function readPositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('browserd-invalid-number')
  return parsed
}

function readBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  throw new Error('browserd-invalid-boolean')
}

function readIntegerRange(value: string | undefined): IntegerRange | undefined {
  if (!value) return undefined
  const match = /^(\d+)-(\d+)$/.exec(value)
  if (!match) throw new Error('browserd-invalid-range')
  const start = Number(match[1])
  const end = Number(match[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
    throw new Error('browserd-invalid-range')
  }
  return { start, end }
}

function reportBrowserLifecycle(
  event: BrowserLifecycleEvent,
  generationFile: string | undefined,
): void {
  const pid = 'pid' in event && event.pid !== undefined ? ` pid=${event.pid}` : ''
  if (event.type === 'launched') {
    process.stderr.write(`browserd: Chrome launched generation=${event.generation}${pid}\n`)
    if (!generationFile) return
    const temporary = `${generationFile}.${process.pid}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify({
        generation: event.generation,
        ...(event.pid !== undefined ? { pid: event.pid } : {}),
        startedAt: new Date().toISOString(),
      }), { mode: 0o600 })
      renameSync(temporary, generationFile)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      process.stderr.write(`browserd: failed to publish Chrome generation: ${detail}\n`)
    }
    return
  }
  if (event.type === 'disconnected') {
    process.stderr.write(`browserd: Chrome disconnected generation=${event.generation}${pid}\n`)
    return
  }
  process.stderr.write(
    `browserd: Chrome restart scheduled generation=${event.generation} delayMs=${event.delayMs}\n`,
  )
}

async function main(): Promise<void> {
  const socketPath = process.env.BYCLAW_BROWSER_SOCKET
  if (!socketPath) throw new Error('browserd-missing-config')
  const secret = readBrowserSecretFromEnvironment()
  const idleBrowserMs = readPositiveInteger(process.env.BYCLAW_BROWSER_IDLE_MS)
  const headless = readBoolean(process.env.BYCLAW_BROWSER_HEADLESS)
  const profileExclusive = readBoolean(process.env.BYCLAW_BROWSER_PROFILE_EXCLUSIVE)
  const socketMode = process.env.BYCLAW_BROWSER_SOCKET_MODE
    ? Number.parseInt(process.env.BYCLAW_BROWSER_SOCKET_MODE, 8)
    : undefined
  const viewerMode = process.env.BYCLAW_BROWSER_VIEWER ?? 'none'
  if (viewerMode !== 'none' && viewerMode !== 'novnc' && viewerMode !== 'shared-novnc') {
    throw new Error('browser-viewer-invalid-mode')
  }
  const viewerPort = readPositiveInteger(process.env.BYCLAW_BROWSER_VNC_WEB_PORT)
  const desktopReadinessTimeoutMs = readPositiveInteger(process.env.BYCLAW_BROWSER_DESKTOP_READY_TIMEOUT_MS)
  const displayRange = readIntegerRange(process.env.BYCLAW_BROWSER_DISPLAY_RANGE)
  const rfbPortRange = readIntegerRange(process.env.BYCLAW_BROWSER_RFB_PORT_RANGE)
  const websockifyPortRange = readIntegerRange(process.env.BYCLAW_BROWSER_WEBSOCKIFY_PORT_RANGE)
  const launchConfiguration = await resolveBrowserLaunchConfiguration()
  const generationFile = process.env.BYCLAW_BROWSER_GENERATION_FILE
  for (const extensionPath of launchConfiguration.invalidExtensionPaths) {
    process.stderr.write(`browserd-extension-not-found:${extensionPath}\n`)
  }
  const server = await startBrowserd({
    socketPath,
    secret,
    ...(process.env.BYCLAW_BROWSER_ACTIVATION_SOCKET ? {
      activationSocketPath: process.env.BYCLAW_BROWSER_ACTIVATION_SOCKET,
      bycli: {
        enabled: readBoolean(process.env.BYCLAW_BYCLI_ENABLED) ?? false,
        restartCommand: process.env.BYCLAW_BYCLI_DAEMON_COMMAND
          ? [process.env.BYCLAW_BYCLI_DAEMON_COMMAND] : ['bycli', 'daemon', 'restart'],
        statusCommand: process.env.BYCLAW_BYCLI_STATUS_COMMAND
          ? [process.env.BYCLAW_BYCLI_STATUS_COMMAND] : ['bycli', 'daemon', 'status', '--json'],
        timeoutMs: readPositiveInteger(process.env.BYCLAW_BROWSER_READY_TIMEOUT_MS) ?? 60_000,
        commandTimeoutMs: readPositiveInteger(process.env.BYCLAW_BYCLI_COMMAND_TIMEOUT_MS) ?? 3_000,
        healthIntervalMs: readPositiveInteger(process.env.BYCLAW_BYCLI_HEALTH_INTERVAL_MS) ?? 30_000,
        log: (message: string) => process.stderr.write(`browserd: ${message}\n`),
      },
    } : {}),
    ...(process.env.BYCLAW_BROWSER_DOWNLOAD_ROOT ? { downloadRoot: process.env.BYCLAW_BROWSER_DOWNLOAD_ROOT } : {}),
    ...(process.env.BYCLAW_BROWSER_SCREENSHOT_ROOT ? { screenshotRoot: process.env.BYCLAW_BROWSER_SCREENSHOT_ROOT } : {}),
    ...(process.env.BYCLAW_BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BYCLAW_BROWSER_EXECUTABLE_PATH } : {}),
    ...(viewerMode !== 'novnc' ? { userDataDir: launchConfiguration.userDataDir } : {}),
    ...(launchConfiguration.args ? { args: launchConfiguration.args } : {}),
    ...(launchConfiguration.ignoreDefaultArgs
      ? { ignoreDefaultArgs: launchConfiguration.ignoreDefaultArgs }
      : {}),
    ...(idleBrowserMs !== undefined ? { idleBrowserMs } : {}),
    ...(headless !== undefined ? { headless } : {}),
    ...(profileExclusive !== undefined ? { profileExclusive } : {}),
    ...(socketMode !== undefined ? { socketMode } : {}),
    viewerMode,
    ...(process.env.BYCLAW_BROWSER_VNC_WEB_LISTEN_ADDRESS
      ? { viewerHost: process.env.BYCLAW_BROWSER_VNC_WEB_LISTEN_ADDRESS }
      : {}),
    ...(viewerPort !== undefined ? { viewerPort } : {}),
    ...(process.env.BYCLAW_BROWSER_NOVNC_DIR ? { novncRoot: process.env.BYCLAW_BROWSER_NOVNC_DIR } : {}),
    ...(process.env.BYCLAW_BROWSER_SESSION_RUNTIME_ROOT
      ? { desktopRuntimeRoot: process.env.BYCLAW_BROWSER_SESSION_RUNTIME_ROOT }
      : {}),
    ...(process.env.BYCLAW_BROWSER_XVFB_SCREEN ? { desktopScreen: process.env.BYCLAW_BROWSER_XVFB_SCREEN } : {}),
    ...(displayRange ? { displayRange } : {}),
    ...(rfbPortRange ? { rfbPortRange } : {}),
    ...(websockifyPortRange ? { websockifyPortRange } : {}),
    ...(desktopReadinessTimeoutMs !== undefined ? { desktopReadinessTimeoutMs } : {}),
    onBrowserLifecycle: event => reportBrowserLifecycle(event, generationFile),
  })
  const stop = () => {
    void server.close().finally(() => process.exit(0))
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

export function formatBrowserdStartupError(error: unknown): string {
  const code = error instanceof BrowserRuntimeError ? error.code : 'browserd-start-failed'
  const detail = (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 2_048)
  return detail && detail !== code ? `${code}: ${detail}` : code
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${formatBrowserdStartupError(error)}\n`)
    process.exitCode = 1
  })
}
