import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createConnection, createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserBrokerClient } from '../src/broker-client.js'
import { BrowserSessionController } from '../src/browser-session-controller.js'
import {
  PlaywrightBrowserDriver,
  startBrowserd,
  type BrowserdServer,
} from '../src/browserd.js'
import type { BrowserDriver } from '../src/browser-runtime.js'

const secret = 'browserd-e2e-secret'
const firstLease = { leaseId: 'e2e-one', capability: 'e2e-capability-one' }
const secondLease = { leaseId: 'e2e-two', capability: 'e2e-capability-two' }

const testTlsKey = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7JWojvZQswD9R
0fvu3+qavYDM7wuHnETFCR3aayI8ipEak19M639latQsnbU7nQ52Sktz0q4p4iV2
VYXOMp9DwmlVt/n8OYNMFC2GjET8vM+b/aa+CuUVfvkwRJPaoxQbymfBxRro/dvv
tULykIwURA8KknjatTij8ywFi/+C3OjLYRE7e5QFHIZaomjUM9yz4vg6L4Cysb9C
iY/xIg3151YpfBtu3y8UERwI6mdPJru6v6LQUcrfSZvZ2u9uh+VgxiMCon6f/lRP
eeLcePXNYIOvdXvllm+KF+NjDszPXGIp/Z5PnR4gBFcU00+1lr2zNBjjPDr39R6j
XR0gE0ahAgMBAAECggEAJAp+UKBBsUWb3CjFrTkDwCW3MKBntsfeSZjqHiaMOx8P
d1AC5jgjOneSoX4EyVSDlL3VnppoDqpd/xZU1MNUfzLpYMfz1YKI+eWX5+XLImZF
UDwO+OH1wMhJeqV2WQCXjouSJFPOjSjYiqc8m6TBSWTbBbT0H+CPJineZDoULNIE
jogoMrrSOlY5UrxNlUxhHP+YVBKWYYimiuxV20xSDBQzGu5nmmtuWwfK/YFMsVir
rk+oAtWeBqmRxtw2WNRSW35mo2euNqxWGK8cV6vcL3TK7gchpONqmAkiJRoEqRZp
ulS8R+F865Ruol9+p7E4Ky3SsD8y/qD1oA+U/AOOvQKBgQDhUj/9FSLgTZEZSJAF
0fd1+2BwdQIS8cdvNCa8GIJD/mAbxIpMpSLk3VY7P8nr9/BLBjoL+pzd56TKyMrI
rNePNnnLKvjVmd3dQZaG1v1Cf2WUmD4LLmd+ADssy2iHlGraFzVM4/tPHiQTp7NR
SfZiFbYg8Ap7WLTNzj4vNJrtHQKBgQDUoIpRmvMO9T4Aa0pL0BI2wNoq65SXHR4D
X7WKwgKEBvgLfeCnCp71tZ/DlkF0CnLJljTtIpkTEuxAHSMNGj34gtRRwuqpHPRh
Bra7DtWx7dfWChjdaHUwmaICheX5jSE2CGXxJ10DCZ35LvGtLAvH4lqXmRkw1NsR
Fj8C8QL8VQKBgQCGTTc0y59hIPrGnjiyL2eXnEDsZuHYluJvxx77aIRksL9qbaid
bKSy07btU+UwUDWbElgRAcz0e3j/IdW07UkC5M6NqcxtzOuwUMK/FnAYbcUHYAND
OOKY+NxMo+VnQrC507GCZjVKAEYyrPe2ESbZaeWIFmu4/7OtJCxuiKV7hQKBgByq
A9uaevfiQdiGnj54L2xoNUEh/yccCsbDqVKqcvJfiiLqdlWujd1r/by9TdeZ7P2W
HU52opI6s9S02NvUVNRitsLK9x2TRLKr2AiBqHdTLAyz0cRPZ7UEkR2r9WPeDcMe
ALgw6U4WhtBn7ra8wF3S+wmC3y2BFINKL3ZzDUb9AoGBALybvUejQ5pdk/rriX4B
9waOE70VRmZuKu9IHh4khyS139tSt4AbcqFvyrclq7SBnA5a38zxeifqtyvdPGjn
i04oY8QvIGJtBEkzp7s4LbvrIsw6rLHbkhoundPoleBJek5v+2LR0REdrNgbmuXW
qcKZpg19AByW2pUYlyEOR/+0
-----END PRIVATE KEY-----`

const testTlsCertificate = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIURiPoRI3qGr714M/5GY9OCbUQj4UwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDkxMDEwMzAzOFoXDTM2MDkw
NzEwMzAzOFowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAuyVqI72ULMA/UdH77t/qmr2AzO8Lh5xExQkd2msiPIqR
GpNfTOt/ZWrULJ21O50OdkpLc9KuKeIldlWFzjKfQ8JpVbf5/DmDTBQthoxE/LzP
m/2mvgrlFX75MEST2qMUG8pnwcUa6P3b77VC8pCMFEQPCpJ42rU4o/MsBYv/gtzo
y2ERO3uUBRyGWqJo1DPcs+L4Oi+AsrG/QomP8SIN9edWKXwbbt8vFBEcCOpnTya7
ur+i0FHK30mb2drvboflYMYjAqJ+n/5UT3ni3Hj1zWCDr3V75ZZvihfjYw7Mz1xi
Kf2eT50eIARXFNNPtZa9szQY4zw69/Ueo10dIBNGoQIDAQABo28wbTAdBgNVHQ4E
FgQU/BmWs7unkPy+HA+rxHhx9h/AfjswHwYDVR0jBBgwFoAU/BmWs7unkPy+HA+r
xHhx9h/AfjswDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARhwR/AAABgglsb2Nh
bGhvc3QwDQYJKoZIhvcNAQELBQADggEBAJ4y0+ORPAXE11pbHWd7G7xoHhbQTsNN
haCtn5lEOr4hTrLewU7eEqtH1XeoDJhMmk5xpNy28KkQPOlf0wbxg0TYYRB+aWQu
AzQlDYpe8fl3RUrk/gG/IwjSidDPHdYxeMp88EROTlSR651o7tME76/FRXlQKNZW
RQT1Kkr/kxOp7+gQU0jt7YR9fi/ldBzzA+x+0yTezlfdgq+jvaTXAShVc7D2LCl0
P+HdEhXq7T3FjsaQdXfN/pVdqcbUJEvyEz7l1FCfP1RkrwtGz+2lEuW7bN1nWIe7
yL644fGHQF0VMAAlG2ljSgUocZ0zyOtTSwMaypVktDg7bBEx65A9uhY=
-----END CERTIFICATE-----`

const executablePath = [
  process.env.BYCLAW_BROWSER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].find(candidate => candidate && existsSync(candidate))

const servers: BrowserdServer[] = []
const httpServers: HttpServer[] = []
const clients: BrowserBrokerClient[] = []
const directories: string[] = []

async function createFixture(): Promise<string> {
  const server = createHttpServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const value = url.searchParams.get('value') ?? 'missing'
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    if (url.pathname === '/compact-scroll') {
      response.end('<button hidden>Hidden diagnostic</button><div aria-label="Messages" style="height:100px;overflow:auto"><div style="height:350px">History</div></div><p style="margin-top:2000px">Offscreen history</p>')
      return
    }
    response.end(`<!doctype html>
      <html><head><title>isolated-${value}</title></head>
      <body>
      <button type="button" data-byclaw-browser-index="7">Inspect A</button>
      <button type="button" data-byclaw-browser-index="7">Inspect B</button>
      <button type="button" data-byclaw-browser-index="777">Forged</button><script>
        localStorage.setItem('lease-value', ${JSON.stringify(value)});
        document.cookie = 'lease-value=' + encodeURIComponent(${JSON.stringify(value)}) + '; Path=/';
        document.body.append(' cookie=' + document.cookie + ' storage=' + localStorage.getItem('lease-value'));
      </script></body></html>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  httpServers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture-address-unavailable')
  return `http://127.0.0.1:${address.port}`
}

interface PolicyFixture {
  readonly origin: string
  readonly blockedOrigin: string
  submitted: number
  popupRequests: number
  blockedRequests: number
  blockedWebSockets: number
  allowedWebSockets: number
  downloadBytes: number
  rawDownloadBytes: number
  plainDownloadBytes: number
  unknownDownloadBytes: number
  sameUrlRequests: number
  sameUrlDownloadBytes: number
  concurrentRequests: number
  concurrentDownloadBytes: number
  multiDownloadRequests: number
  activeDownloadBytes: number
  activeDownloadClosed: boolean
  stalledDownloadRequests: number
  stalledDownloadClosed: boolean
  backgroundNoContentRequests: number
  delayedDownloadBytes: number
  resourceBytes: number
  resourceClosed: boolean
}

async function createPolicyFixture(): Promise<PolicyFixture> {
  const fixture: PolicyFixture = {
    origin: '',
    blockedOrigin: '',
    submitted: 0,
    popupRequests: 0,
    blockedRequests: 0,
    blockedWebSockets: 0,
    allowedWebSockets: 0,
    downloadBytes: 0,
    rawDownloadBytes: 0,
    plainDownloadBytes: 0,
    unknownDownloadBytes: 0,
    sameUrlRequests: 0,
    sameUrlDownloadBytes: 0,
    concurrentRequests: 0,
    concurrentDownloadBytes: 0,
    multiDownloadRequests: 0,
    activeDownloadBytes: 0,
    activeDownloadClosed: false,
    stalledDownloadRequests: 0,
    stalledDownloadClosed: false,
    backgroundNoContentRequests: 0,
    delayedDownloadBytes: 0,
    resourceBytes: 0,
    resourceClosed: false,
  }
  const blocked = createHttpServer((_request, response) => {
    fixture.blockedRequests += 1
    response.end('blocked target received request')
  })
  blocked.on('upgrade', (_request, socket) => {
    fixture.blockedWebSockets += 1
    socket.destroy()
  })
  await new Promise<void>((resolve, reject) => {
    blocked.once('error', reject)
    blocked.listen(0, '127.0.0.1', resolve)
  })
  httpServers.push(blocked)
  const blockedAddress = blocked.address()
  if (!blockedAddress || typeof blockedAddress === 'string') throw new Error('blocked-address-unavailable')
  fixture.blockedOrigin = `http://localhost:${blockedAddress.port}`

  let pendingConcurrentResponse: ServerResponse | undefined
  const allowed = createHttpServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/submitted') {
      fixture.submitted += 1
      response.end('submitted')
      return
    }
    if (url.pathname === '/redirect') {
      response.writeHead(302, { location: `${fixture.blockedOrigin}/hit` })
      response.end()
      return
    }
    if (url.pathname === '/cross-origin-resource') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<img src="${fixture.blockedOrigin}/hit" alt="blocked">`)
      return
    }
    if (url.pathname === '/cross-origin-websocket') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<script>new WebSocket(${JSON.stringify(fixture.blockedOrigin.replace('http:', 'ws:'))})</script>`)
      return
    }
    if (url.pathname === '/same-origin-websocket') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<script>new WebSocket(${JSON.stringify(fixture.origin.replace('http:', 'ws:'))})</script>`)
      return
    }
    if (url.pathname === '/popup-target') {
      fixture.popupRequests += 1
      response.end('popup target')
      return
    }
    if (url.pathname === '/large-download') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="../../large.bin"',
      })
      const chunk = Buffer.alloc(16 * 1024, 0x61)
      let sent = 0
      const interval = setInterval(() => {
        if (sent >= 20) {
          clearInterval(interval)
          response.end()
          return
        }
        fixture.downloadBytes += chunk.byteLength
        sent += 1
        response.write(chunk)
      }, 25)
      response.once('close', () => clearInterval(interval))
      return
    }
    if (url.pathname === '/raw-download') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      const chunk = Buffer.alloc(16 * 1024, 0x62)
      let sent = 0
      const interval = setInterval(() => {
        if (sent >= 20) {
          clearInterval(interval)
          response.end()
          return
        }
        fixture.rawDownloadBytes += chunk.byteLength
        sent += 1
        response.write(chunk)
      }, 25)
      response.once('close', () => clearInterval(interval))
      return
    }
    if (url.pathname === '/plain-download') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      const chunk = Buffer.alloc(16 * 1024, 0x65)
      let sent = 0
      const interval = setInterval(() => {
        if (sent >= 20) {
          clearInterval(interval)
          response.end()
          return
        }
        fixture.plainDownloadBytes += chunk.byteLength
        sent += 1
        response.write(chunk)
      }, 25)
      response.once('close', () => clearInterval(interval))
      return
    }
    if (url.pathname === '/unknown-download') {
      response.writeHead(200, { 'content-type': 'application/x-byclaw-unknown' })
      const chunk = Buffer.alloc(16 * 1024, 0x66)
      let sent = 0
      const interval = setInterval(() => {
        if (sent >= 20) {
          clearInterval(interval)
          response.end()
          return
        }
        fixture.unknownDownloadBytes += chunk.byteLength
        sent += 1
        response.write(chunk)
      }, 25)
      response.once('close', () => clearInterval(interval))
      return
    }
    if (url.pathname === '/same-download') {
      fixture.sameUrlRequests += 1
      if (fixture.sameUrlRequests === 1) {
        response.writeHead(200, {
          'content-type': 'text/plain',
          'content-disposition': 'attachment; filename="prefetch.txt"',
        })
        response.end('prefetched')
        return
      }
      response.writeHead(200, { 'content-type': 'text/plain' })
      const chunk = Buffer.alloc(16 * 1024, 0x67)
      let sent = 0
      const interval = setInterval(() => {
        if (sent >= 20) {
          clearInterval(interval)
          response.end()
          return
        }
        fixture.sameUrlDownloadBytes += chunk.byteLength
        sent += 1
        response.write(chunk)
      }, 25)
      response.once('close', () => clearInterval(interval))
      return
    }
    if (url.pathname === '/concurrent-download') {
      fixture.concurrentRequests += 1
      if (fixture.concurrentRequests === 1) {
        pendingConcurrentResponse = response
        response.writeHead(200, {
          'content-type': 'text/plain',
          'content-disposition': 'attachment; filename="concurrent-fetch.txt"',
        })
        response.flushHeaders()
        return
      }
      pendingConcurrentResponse?.end('concurrent fetch complete')
      pendingConcurrentResponse = undefined
      response.writeHead(200, { 'content-type': 'text/plain' })
      const chunk = Buffer.alloc(16 * 1024, 0x68)
      let sent = 0
      const interval = setInterval(() => {
        if (sent >= 20) {
          clearInterval(interval)
          response.end()
          return
        }
        fixture.concurrentDownloadBytes += chunk.byteLength
        sent += 1
        response.write(chunk)
      }, 25)
      response.once('close', () => clearInterval(interval))
      return
    }
    if (url.pathname === '/multi-download') {
      fixture.multiDownloadRequests += 1
      response.writeHead(200, {
        'content-type': 'text/plain',
        'content-disposition': `attachment; filename="multi-${url.searchParams.get('id')}.txt"`,
      })
      response.end(`multi-${url.searchParams.get('id')}`)
      return
    }
    if (url.pathname === '/active-download') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="active.bin"',
      })
      const chunk = Buffer.alloc(16 * 1024, 0x69)
      const interval = setInterval(() => {
        fixture.activeDownloadBytes += chunk.byteLength
        response.write(chunk)
      }, 20)
      response.once('close', () => {
        fixture.activeDownloadClosed = true
        clearInterval(interval)
      })
      return
    }
    if (url.pathname === '/no-content') {
      response.writeHead(204).end()
      return
    }
    if (url.pathname === '/stalled-download') {
      fixture.stalledDownloadRequests += 1
      response.once('close', () => {
        fixture.stalledDownloadClosed = true
      })
      return
    }
    if (url.pathname === '/background-no-content') {
      fixture.backgroundNoContentRequests += 1
      response.writeHead(204).end()
      return
    }
    if (url.pathname === '/delayed-download') {
      const body = Buffer.alloc(64 * 1024, 0x6a)
      const timer = setTimeout(() => {
        fixture.delayedDownloadBytes += body.byteLength
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename="delayed.bin"',
        })
        response.end(body)
      }, 500)
      response.once('close', () => clearTimeout(timer))
      return
    }
    if (url.pathname === '/slow-resource') {
      response.writeHead(200, { 'content-type': 'application/javascript' })
      const chunk = Buffer.alloc(16 * 1024, 0x63)
      const interval = setInterval(() => {
        fixture.resourceBytes += chunk.byteLength
        response.write(chunk)
      }, 20)
      response.once('close', () => {
        fixture.resourceClosed = true
        clearInterval(interval)
      })
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (url.pathname === '/form') {
      response.end('<form method="post" action="/submitted"><button>Submit</button></form>')
      return
    }
    if (url.pathname === '/late-submit') {
      response.end(`<p>Late submit fixture</p><script>
        setTimeout(() => fetch('/submitted', { method: 'POST', body: 'blocked' }).catch(() => {}), 100)
      </script>`)
      return
    }
    if (url.pathname === '/popup') {
      response.end('<button type="button" onclick="window.open(\'/popup-target\')">Open popup</button>')
      return
    }
    if (url.pathname === '/initial-popup') {
      response.end('<script>window.open(\'/popup-target\')</script>')
      return
    }
    if (url.pathname === '/native-popup') {
      response.end(`<form target="_blank" action="/popup-target"></form>
        <button type="button" onclick="document.querySelector('form').submit()">Native popup</button>`)
      return
    }
    if (url.pathname === '/replace') {
      response.end(`<button type="button" onclick="
        document.querySelector('#target').remove();
        document.documentElement.dataset.byclawBrowserNextIndex='1';
        const next=document.createElement('button');
        next.id='target'; next.type='button'; next.textContent='New target';
        document.body.append(next)
      ">Replace</button><button id="target" type="button">Old target</button>`)
      return
    }
    if (url.pathname === '/controls') {
      response.end(`<label for="notes">Notes label</label>
        <textarea id="notes" required readonly>misleading inner text</textarea>
        <input type="checkbox" aria-label="Enabled" checked>
        <input type="checkbox" aria-label="Partial" aria-checked="mixed">
        <select aria-label="Choice" multiple><option value="a">A</option><option value="b" selected>B</option></select>
        <button type="button" aria-expanded="true">Details</button>`)
      return
    }
    if (url.pathname === '/overlay') {
      response.end(`<button type="button" style="position:absolute;left:40px;top:40px">Shared action</button>
        <button type="button" style="display:none">Shared action</button>
        <div role="dialog" aria-modal="true" aria-label="Login dialog"
          class="beyond-modal-wrap" style="position:fixed;inset:0;background:white;z-index:10">
          <button type="button" style="margin:40px">Continue</button>
        </div>`)
      return
    }
    if (url.pathname === '/spa') {
      response.end(`<script>
        setTimeout(() => {
          const button = document.createElement('button');
          button.id = 'ready'; button.textContent = 'SPA Ready';
          document.body.append(button);
        }, 100)
      </script>`)
      return
    }
    if (url.pathname === '/download') {
      const target = url.searchParams.get('target')
      response.end(target
        ? `<a href="${target}">HTTPS download</a>`
        : '<a href="/large-download">Download</a>')
      return
    }
    if (url.pathname === '/raw-download-page') {
      response.end('<a href="/raw-download">Raw download</a>')
      return
    }
    if (url.pathname === '/plain-download-page') {
      response.end('<a download href="/plain-download">Plain download</a>')
      return
    }
    if (url.pathname === '/unknown-download-page') {
      response.end('<a href="/unknown-download">Unknown download</a>')
      return
    }
    if (url.pathname === '/same-download-page') {
      response.end(`<script>
        fetch('/same-download').then(() => {
          const link = document.createElement('a');
          link.href = '/same-download'; link.textContent = 'Same URL download';
          link.onclick = () => { link.download = 'same-url.txt' };
          document.body.append(link);
        })
      </script>`)
      return
    }
    if (url.pathname === '/concurrent-download-page') {
      response.end(`<a href="/concurrent-download"
        onclick="this.download='concurrent.txt'">Concurrent download</a>
        <script>void fetch('/concurrent-download').then(response => response.text())</script>`)
      return
    }
    if (url.pathname === '/multi-download-page') {
      response.end(`<button type="button" onclick="
        for (const id of ['one', 'two']) {
          const link = document.createElement('a');
          link.href = '/multi-download?id=' + id;
          link.download = id + '.txt';
          link.click();
        }
      ">Multiple downloads</button>`)
      return
    }
    if (url.pathname === '/active-download-page') {
      response.end('<a href="/active-download">Active download</a>')
      return
    }
    if (url.pathname === '/no-content-page') {
      response.end('<a href="/no-content">No content</a>')
      return
    }
    if (url.pathname === '/stalled-download-page') {
      response.end('<a download href="/stalled-download">Stalled download</a>')
      return
    }
    if (url.pathname === '/background-download-page') {
      response.end(`<a download href="/delayed-download"
        onclick="void fetch('/background-no-content')">Delayed download</a>`)
      return
    }
    if (url.pathname === '/large-html') {
      response.end(`<title>ordinary-html</title><main>${'ordinary page '.repeat(8_000)}</main>`)
      return
    }
    if (url.pathname === '/ordinary-link-page') {
      response.end('<a href="/large-html">Ordinary page</a>')
      return
    }
    if (url.pathname === '/resource-page') {
      response.end('<script>void fetch(\'/slow-resource\').then(response => response.arrayBuffer())</script>')
      return
    }
    response.end('ok')
  })
  allowed.on('upgrade', (_request, socket) => {
    fixture.allowedWebSockets += 1
    socket.destroy()
  })
  await new Promise<void>((resolve, reject) => {
    allowed.once('error', reject)
    allowed.listen(0, '127.0.0.1', resolve)
  })
  httpServers.push(allowed)
  const allowedAddress = allowed.address()
  if (!allowedAddress || typeof allowedAddress === 'string') throw new Error('allowed-address-unavailable')
  fixture.origin = `http://127.0.0.1:${allowedAddress.port}`
  return fixture
}

async function createHttpsDownloadFixture(): Promise<{ origin: string; bytes: () => number }> {
  let transferred = 0
  const server = createHttpsServer({ key: testTlsKey, cert: testTlsCertificate }, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream' })
    const chunk = Buffer.alloc(16 * 1024, 0x64)
    let sent = 0
    const interval = setInterval(() => {
      if (sent >= 20) {
        clearInterval(interval)
        response.end()
        return
      }
      transferred += chunk.byteLength
      sent += 1
      response.write(chunk)
    }, 25)
    response.once('close', () => clearInterval(interval))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  httpServers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('https-fixture-address-unavailable')
  return { origin: `https://127.0.0.1:${address.port}`, bytes: () => transferred }
}

async function createInsecureChromeWrapper(directory: string): Promise<string> {
  const wrapperPath = join(directory, 'chrome-ignore-certificate-errors')
  await writeFile(
    wrapperPath,
    `#!/bin/sh\nexec ${JSON.stringify(executablePath)} --ignore-certificate-errors "$@"\n`,
    { mode: 0o700 },
  )
  return wrapperPath
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('fixture-timeout')
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.dispose()
  await Promise.all(servers.splice(0).map(server => server.close()))
  await Promise.all(
    httpServers.splice(0).map(
      server => new Promise<void>(resolve => server.close(() => resolve())),
    ),
  )
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('browserd Chromium isolation', () => {
  const browserIt = executablePath ? it : it.skip

  browserIt('returns compact observations and measured batch scrolls through the controller and broker', async () => {
    const origin = await createFixture()
    const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-scroll-'))
    directories.push(directory)
    const socketPath = join(directory, 'browserd.sock')
    servers.push(await startBrowserd({ socketPath, secret, executablePath: executablePath! }))
    const client = new BrowserBrokerClient({ socketPath, secret }); clients.push(client)
    const agent = { id: 'scroll-agent', session: { id: 'scroll-session' } }
    const controller = new BrowserSessionController({ broker: client,
      projections: { stateOf: () => ({ openTurnStartSeq: 1, lastTurn: 1 }) },
      maxContexts: 1, maxQueue: 4, leaseTimeoutMs: 180000 })
    const signal = new AbortController().signal
    try {
      const opened = await controller.execute({ operation: 'open', startUrl: `${origin}/compact-scroll` }, agent, signal)
      expect(opened.observation!.elements.map(e => e.name)).toEqual(['Messages'])
      expect(opened.observation!.omittedElements).toBe(1)
      expect(opened.observation!.text).not.toContain('Offscreen history')
      const element = opened.observation!.elements[0]!.index
      const acted = await controller.execute({ operation: 'act', actions: [
        { kind: 'scroll', element, deltaY: 560, observationId: opened.observation!.observationId },
      ] }, agent, signal)
      expect(acted.steps![0]!.action).toMatchObject({ changed: true, scroll: { deltaY: 250 } })
      expect(acted.observation!.observationId).not.toBe(opened.observation!.observationId)
      await expect(controller.execute({ operation: 'scroll', deltaY: 1, element: 999999 }, agent, signal))
        .rejects.toMatchObject({ code: 'browser-element-not-found', recoverable: true })
      const full = await controller.execute({ operation: 'inspect', detail: 'full' }, agent, signal)
      expect(full.observation!.elements.some(e => e.name === 'Hidden diagnostic')).toBe(true)
      expect(full.observation!.text).toContain('Offscreen history')
      const hidden = full.observation!.elements.find(e => e.name === 'Hidden diagnostic')!.index
      await expect(controller.execute({ operation: 'scroll', deltaY: 10, element: hidden }, agent, signal))
        .rejects.toMatchObject({ code: 'browser-element-not-visible', recoverable: true })
      await expect(controller.execute({ operation: 'scroll', deltaY: 10, observationId: opened.observation!.observationId }, agent, signal))
        .rejects.toMatchObject({ code: 'browser-observation-stale' })
    } finally { await controller.dispose() }
  }, 20_000)

  browserIt(
    'shares one Chromium process while isolating Cookie and localStorage per Context',
    async () => {
      const origin = await createFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({
        socketPath,
        secret,
        executablePath: executablePath!,
        idleBrowserMs: 80,
      })
      servers.push(server)
      expect((await stat(socketPath)).mode & 0o777).toBe(0o600)

      let sequence = 0
      const client = new BrowserBrokerClient({
        socketPath,
        secret,
        requestId: () => `e2e-request-${++sequence}`,
      })
      clients.push(client)

      await Promise.all([
        client.open(firstLease, {
          startUrl: `${origin}/?value=first`,
          allowedDomains: ['127.0.0.1'],
        }),
        client.open(secondLease, {
          startUrl: `${origin}/?value=second`,
          allowedDomains: ['127.0.0.1'],
        }),
      ])
      const status = await client.status()
      expect(status).toMatchObject({ browserRunning: true, contexts: 2 })
      expect(status.pid).toEqual(expect.any(Number))

      const [first, second] = await Promise.all([
        client.inspect(firstLease),
        client.inspect(secondLease),
      ])
      expect(first.text).toContain('cookie=lease-value=first')
      expect(first.text).toContain('storage=first')
      expect(first.text).not.toContain('second')
      expect(second.text).toContain('cookie=lease-value=second')
      expect(second.text).toContain('storage=second')
      expect(second.text).not.toContain('first')
      expect(new Set(first.elements.map(element => element.index)).size).toBe(first.elements.length)
      expect(new Set(second.elements.map(element => element.index)).size).toBe(second.elements.length)
      expect(first.elements.map(element => element.index)).not.toContain(777)
      expect(second.elements.map(element => element.index)).not.toContain(777)

      await Promise.all([client.closeLease(firstLease), client.closeLease(secondLease)])
      await expect(client.status()).resolves.toMatchObject({
        browserRunning: true,
        contexts: 0,
        pid: status.pid,
      })
      await new Promise(resolve => setTimeout(resolve, 120))
      await expect(client.status()).resolves.toEqual({ browserRunning: false, contexts: 0 })
    },
    20_000,
  )

  browserIt(
    'shares and persists login cookies through the configured global user data directory',
    async () => {
      const fixture = createHttpServer((request, response) => {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        if (request.url === '/login') {
          response.setHeader('set-cookie', 'session=shared-login; Path=/; Max-Age=86400')
        }
        response.end(`<!doctype html><body>cookies=<script>document.write(document.cookie)</script></body>`)
      })
      httpServers.push(fixture)
      await new Promise<void>((resolve, reject) => {
        fixture.once('error', reject)
        fixture.listen(0, '127.0.0.1', resolve)
      })
      const address = fixture.address()
      if (!address || typeof address === 'string') throw new Error('fixture-address-unavailable')
      const origin = `http://127.0.0.1:${address.port}`
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-persistent-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const userDataDir = join(directory, 'user-data')

      const firstServer = await startBrowserd({
        socketPath,
        secret,
        executablePath: executablePath!,
        userDataDir,
      })
      const firstClient = new BrowserBrokerClient({ socketPath, secret })
      await firstClient.open(firstLease, {
        startUrl: `${origin}/login`,
        allowedDomains: ['127.0.0.1'],
      })
      expect((await firstClient.inspect(firstLease)).text).toContain('session=shared-login')
      await firstClient.open(secondLease, {
        startUrl: `${origin}/profile`,
        allowedDomains: ['127.0.0.1'],
      })
      expect((await firstClient.inspect(secondLease)).text).toContain('session=shared-login')
      await Promise.all([
        firstClient.closeLease(firstLease),
        firstClient.closeLease(secondLease),
      ])
      firstClient.dispose()
      await firstServer.close()

      const secondServer = await startBrowserd({
        socketPath,
        secret,
        executablePath: executablePath!,
        userDataDir,
      })
      servers.push(secondServer)
      const secondClient = new BrowserBrokerClient({ socketPath, secret })
      clients.push(secondClient)
      await secondClient.open(firstLease, {
        startUrl: `${origin}/profile`,
        allowedDomains: ['127.0.0.1'],
      })
      expect((await secondClient.inspect(firstLease)).text).toContain('session=shared-login')
    },
    30_000,
  )

  browserIt(
    'isolates request lanes and remotely cancels only the stalled lease on one socket',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-lanes-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({
        socketPath,
        secret,
        executablePath: executablePath!,
        maxWaitMs: 6_000,
      })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)

      await Promise.all([
        client.open(firstLease, {
          startUrl: `${fixture.origin}/stalled-download-page`,
          allowedDomains: ['127.0.0.1'],
        }),
        client.open(secondLease, {
          startUrl: `${fixture.origin}/`,
          allowedDomains: ['127.0.0.1'],
        }),
      ])
      const first = await client.inspect(firstLease)
      const link = first.elements.find(element => element.name === 'Stalled download')!
      const abort = new AbortController()
      const stalled = client.act(
        firstLease,
        { kind: 'click', element: link.index },
        abort.signal,
      ).then(
        () => undefined,
        error => error as Error,
      )
      await waitUntil(async () => fixture.stalledDownloadRequests === 1)

      const secondInspection = await Promise.race([
        client.inspect(secondLease),
        new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 300)),
      ])
      abort.abort()
      if (secondInspection === undefined) {
        client.dispose()
        await server.close()
      }

      expect(secondInspection).toMatchObject({ url: `${fixture.origin}/` })
      await expect(stalled).resolves.toMatchObject({ message: 'browser-broker-aborted' })
      await waitUntil(async () => fixture.stalledDownloadClosed)
      await expect(client.status()).resolves.toMatchObject({ contexts: 1 })
      await expect(client.inspect(secondLease)).resolves.toMatchObject({ url: `${fixture.origin}/` })
      await expect(client.inspect(firstLease)).rejects.toThrow('browser-lease-not-found')
      await client.closeLease(secondLease)
      await expect(client.inspect(secondLease)).rejects.toThrow('browser-lease-not-found')
    },
    20_000,
  )

  browserIt(
    'reads cancellation while the business admission limit is saturated',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-saturated-control-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({
        socketPath,
        secret,
        executablePath: executablePath!,
        maxPendingRequests: 2,
        maxWaitMs: 6_000,
      })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease, {
        startUrl: `${fixture.origin}/stalled-download-page`,
        allowedDomains: ['127.0.0.1'],
      })
      const inspection = await client.inspect(firstLease)
      const link = inspection.elements.find(element => element.name === 'Stalled download')!
      const abort = new AbortController()
      const stalled = client.act(
        firstLease,
        { kind: 'click', element: link.index },
        abort.signal,
      ).then(() => undefined, error => error as Error)
      await waitUntil(async () => fixture.stalledDownloadRequests === 1)

      abort.abort()

      await expect(stalled).resolves.toMatchObject({ message: 'browser-broker-aborted' })
      await waitUntil(async () => fixture.stalledDownloadClosed, 800)
      await expect(client.status()).resolves.toMatchObject({ contexts: 0 })
    },
    20_000,
  )

  browserIt(
    'reads lease close while the business admission limit is saturated',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-saturated-close-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({
        socketPath,
        secret,
        executablePath: executablePath!,
        maxPendingRequests: 2,
        maxWaitMs: 6_000,
      })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease, {
        startUrl: `${fixture.origin}/stalled-download-page`,
        allowedDomains: ['127.0.0.1'],
      })
      const inspection = await client.inspect(firstLease)
      const link = inspection.elements.find(element => element.name === 'Stalled download')!
      const stalled = client.act(firstLease, { kind: 'click', element: link.index }).then(
        () => undefined,
        error => error as Error,
      )
      await waitUntil(async () => fixture.stalledDownloadRequests === 1)

      await client.closeLease(firstLease)

      await expect(stalled).resolves.toMatchObject({ message: 'browser-broker-aborted' })
      await waitUntil(async () => fixture.stalledDownloadClosed, 800)
      await expect(client.status()).resolves.toMatchObject({ contexts: 0 })
    },
    20_000,
  )

  browserIt(
    'keeps same-lease actions FIFO while other leases remain concurrent',
    async () => {
      const origin = await createFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-fifo-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({
        socketPath,
        secret,
        executablePath: executablePath!,
        maxWaitMs: 2_000,
      })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await Promise.all([
        client.open(firstLease, { startUrl: `${origin}/?value=first`, allowedDomains: ['127.0.0.1'] }),
        client.open(secondLease, { startUrl: `${origin}/?value=second`, allowedDomains: ['127.0.0.1'] }),
      ])

      const order: string[] = []
      const wait = client.act(firstLease, { kind: 'wait', milliseconds: 150 })
        .then(() => { order.push('wait') })
      const inspectSameLease = client.inspect(firstLease)
        .then(() => { order.push('inspect') })
      await expect(client.inspect(secondLease)).resolves.toMatchObject({ url: expect.stringContaining('value=second') })
      await Promise.all([wait, inspectSameLease])

      expect(order).toEqual(['wait', 'inspect'])
    },
    20_000,
  )

  browserIt(
    'lets controller Agent cleanup stop one owner while another owner survives',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-controller-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      const agentA = { id: 'agent-a', session: { id: 'session-a' } }
      const agentB = { id: 'agent-b', session: { id: 'session-b' } }
      const competingAgent = { id: 'agent-c', session: { id: 'session-a' } }
      const states = new Map<object, unknown>([
        [agentA.session, { openTurnStartSeq: 10, lastTurn: 1 }],
        [agentB.session, { openTurnStartSeq: 20, lastTurn: 1 }],
        [competingAgent.session, { openTurnStartSeq: 30, lastTurn: 1 }],
      ])
      const controller = new BrowserSessionController({
        broker: client,
        projections: {
          stateOf(session: object, key: string) {
            return key === 'turnBoundary' ? states.get(session) : undefined
          },
        },
        maxContexts: 2,
        maxQueue: 4,
        leaseTimeoutMs: 180_000,
      })
      const signal = new AbortController().signal
      const [openedA] = await Promise.all([
        controller.execute({
          operation: 'open',
          startUrl: `${fixture.origin}/stalled-download-page`,
          allowedDomains: ['127.0.0.1'],
        }, agentA, signal),
        controller.execute({
          operation: 'open',
          startUrl: `${fixture.origin}/`,
          allowedDomains: ['127.0.0.1'],
        }, agentB, signal),
      ])
      const link = openedA.observation!.elements.find(
        element => element.name === 'Stalled download',
      )!
      await expect(controller.execute(
        { operation: 'focus' }, competingAgent, signal,
      )).rejects.toMatchObject({
        code: 'browser-session-owned-by-another-agent', sessionOpen: true,
      })
      await expect(controller.execute(
        { operation: 'focus' }, agentA, signal,
      )).resolves.toMatchObject({ status: 'ok', action: { dispatched: true } })
      const stalled = controller.execute(
        { operation: 'click', element: link.index }, agentA, signal,
      ).then(() => undefined, error => error as Error)
      await waitUntil(async () => fixture.stalledDownloadRequests === 1)

      const closingA = controller.closeAgent(agentA.id)
      await expect(controller.execute({ operation: 'inspect' }, agentB, signal)).resolves.toMatchObject({
        status: 'ok',
        observation: { url: `${fixture.origin}/` },
      })
      await closingA
      await expect(stalled).resolves.toMatchObject({
        code: 'browser-broker-aborted', sessionOpen: false,
      })
      await waitUntil(async () => fixture.stalledDownloadClosed)
      await expect(client.status()).resolves.toMatchObject({ contexts: 1 })
      await controller.dispose()
    },
    20_000,
  )

  browserIt(
    'reconciles controller status after Chromium disconnect and allows a new claim',
    async () => {
      const fixture = await createPolicyFixture()
      const delegate = new PlaywrightBrowserDriver()
      let disconnect!: () => Promise<void>
      const driver: BrowserDriver = {
        async launch(options) {
          const browser = await delegate.launch(options)
          disconnect = () => browser.close()
          return browser
        },
      }
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-disconnect-status-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({
        socketPath, secret, driver, executablePath: executablePath!,
      })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      const firstAgent = { id: 'agent-before-crash', session: { id: 'session-crash' } }
      const controller = new BrowserSessionController({
        broker: client,
        projections: { stateOf: () => ({ openTurnStartSeq: 10, lastTurn: 1 }) },
        maxContexts: 1,
        maxQueue: 2,
        leaseTimeoutMs: 900_000,
      })
      await controller.execute({
        operation: 'open', startUrl: `${fixture.origin}/`, allowedDomains: ['127.0.0.1'],
      }, firstAgent, new AbortController().signal)
      await disconnect()

      await expect(controller.execute(
        { operation: 'status' }, firstAgent, new AbortController().signal,
      )).resolves.toMatchObject({
        session: { open: false, expiredReason: 'browser-process-disconnected' },
      })
      const replacement = { id: 'agent-after-crash', session: { id: 'session-crash' } }
      await expect(controller.execute({
        operation: 'open', startUrl: `${fixture.origin}/`, allowedDomains: ['127.0.0.1'],
      }, replacement, new AbortController().signal)).resolves.toMatchObject({ status: 'opened' })
      await controller.dispose()
    },
    20_000,
  )

  browserIt(
    'blocks keyboard form submission before a POST reaches the server',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-submit-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease, {
        startUrl: `${fixture.origin}/form`,
        allowedDomains: ['127.0.0.1'],
      })

      await client.act(firstLease, { kind: 'press', key: 'Tab' })
      await expect(client.act(firstLease, { kind: 'press', key: 'Space' })).rejects.toThrow(
        'browser-submit-denied',
      )
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(fixture.submitted).toBe(0)
      await expect(client.inspect(firstLease)).resolves.toMatchObject({ url: `${fixture.origin}/form` })
    },
    20_000,
  )

  browserIt(
    'closes controller session after a fatal page-originated policy violation',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-policy-controller-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      const agent = { id: 'agent-policy', session: { id: 'session-policy' } }
      const controller = new BrowserSessionController({
        broker: client,
        projections: { stateOf: () => ({ openTurnStartSeq: 10, lastTurn: 1 }) },
        maxContexts: 1,
        maxQueue: 2,
        leaseTimeoutMs: 900_000,
      })
      await controller.execute({
        operation: 'open',
        startUrl: `${fixture.origin}/late-submit`,
        allowedDomains: ['127.0.0.1'],
      }, agent, new AbortController().signal)

      await expect(controller.execute(
        { operation: 'wait', milliseconds: 300 }, agent, new AbortController().signal,
      )).rejects.toMatchObject({
        code: 'browser-submit-denied', fatal: true, recoverable: false, sessionOpen: false,
      })
      await expect(controller.execute(
        { operation: 'status' }, agent, new AbortController().signal,
      )).resolves.toMatchObject({ session: { open: false } })
      expect(fixture.submitted).toBe(0)
      await controller.dispose()
    },
    20_000,
  )

  browserIt(
    'blocks redirect targets and popups before their HTTP request is sent',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-navigation-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)

      await client.open(firstLease, {
        startUrl: `${fixture.origin}/`,
        allowedDomains: ['127.0.0.1'],
      })
      await expect(
        client.act(firstLease, { kind: 'navigate', url: `${fixture.origin}/redirect` }),
      ).rejects.toThrow('browser-broker-operation-failed')
      expect(fixture.blockedRequests).toBe(0)

      await client.open(secondLease, {
        startUrl: `${fixture.origin}/popup`,
        allowedDomains: ['127.0.0.1'],
      })
      const inspection = await client.inspect(secondLease)
      const popup = inspection.elements.find(element => element.name === 'Open popup')
      expect(popup).toBeDefined()
      await expect(
        client.act(secondLease, { kind: 'click', element: popup!.index }),
      ).rejects.toThrow('browser-popup-denied')
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(fixture.popupRequests).toBe(0)

      const nativePopupLease = {
        leaseId: 'e2e-native-popup',
        capability: 'e2e-native-popup-capability',
      }
      await client.open(nativePopupLease, {
        startUrl: `${fixture.origin}/native-popup`,
        allowedDomains: ['127.0.0.1'],
      })
      const nativeInspection = await client.inspect(nativePopupLease)
      const nativePopup = nativeInspection.elements.find(element => element.name === 'Native popup')
      expect(nativePopup).toBeDefined()
      await expect(
        client.act(nativePopupLease, { kind: 'click', element: nativePopup!.index }),
      ).rejects.toThrow('browser-popup-denied')
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(fixture.popupRequests).toBe(0)

      const initialPopupLease = {
        leaseId: 'e2e-initial-popup',
        capability: 'e2e-initial-popup-capability',
      }
      await expect(
        client.open(initialPopupLease, {
          startUrl: `${fixture.origin}/initial-popup`,
          allowedDomains: ['127.0.0.1'],
        }),
      ).rejects.toThrow('browser-popup-denied')
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(fixture.popupRequests).toBe(0)
    },
    20_000,
  )

  browserIt(
    'blocks popup requests before dispatch when leases share a persistent profile',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-persistent-popup-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({
        socketPath,
        secret,
        executablePath: executablePath!,
        userDataDir: join(directory, 'user-data'),
      })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)

      await client.open(firstLease, {
        startUrl: `${fixture.origin}/native-popup`,
        allowedDomains: ['127.0.0.1'],
      })
      const inspection = await client.inspect(firstLease)
      const popup = inspection.elements.find(element => element.name === 'Native popup')
      expect(popup).toBeDefined()
      await expect(
        client.act(firstLease, { kind: 'click', element: popup!.index }),
      ).rejects.toThrow('browser-popup-denied')
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(fixture.popupRequests).toBe(0)
    },
    20_000,
  )

  browserIt(
    'blocks cross-domain subresources when leases share a persistent profile',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-persist-resource-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({
        socketPath,
        secret,
        executablePath: executablePath!,
        userDataDir: join(directory, 'user-data'),
      })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)

      await client.open(firstLease, {
        startUrl: `${fixture.origin}/cross-origin-resource`,
        allowedDomains: ['127.0.0.1'],
      })
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(fixture.blockedRequests).toBe(0)
    },
    20_000,
  )

  browserIt(
    'enforces WebSocket domains when leases share a persistent profile',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-persist-ws-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({
        socketPath,
        secret,
        executablePath: executablePath!,
        userDataDir: join(directory, 'user-data'),
      })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)

      await client.open(firstLease, {
        startUrl: `${fixture.origin}/cross-origin-websocket`,
        allowedDomains: ['127.0.0.1'],
      })
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(fixture.blockedWebSockets).toBe(0)

      await client.open(secondLease, {
        startUrl: `${fixture.origin}/same-origin-websocket`,
        allowedDomains: ['127.0.0.1'],
      })
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(fixture.allowedWebSockets).toBe(1)
    },
    20_000,
  )

  browserIt(
    'does not let a disconnected forged client close another connection lease',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-capability-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const owner = new BrowserBrokerClient({ socketPath, secret })
      clients.push(owner)
      await owner.open(firstLease, {
        startUrl: `${fixture.origin}/`,
        allowedDomains: ['127.0.0.1'],
      })

      await new Promise<void>(resolve => {
        const attacker = createConnection(socketPath)
        attacker.once('connect', () => {
          attacker.write(`${JSON.stringify({
            type: 'inspect',
            requestId: 'forged-disconnect',
            secret,
            leaseId: firstLease.leaseId,
            capability: 'forged-capability',
          })}\n`)
          attacker.destroy()
          resolve()
        })
        attacker.once('error', () => resolve())
      })

      await waitUntil(async () => (await owner.status()).contexts === 1)
      await expect(owner.inspect(firstLease)).resolves.toMatchObject({
        url: `${fixture.origin}/`,
      })
    },
    20_000,
  )

  browserIt(
    'does not reuse a trusted element index after DOM replacement',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-index-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease, {
        startUrl: `${fixture.origin}/replace`,
        allowedDomains: ['127.0.0.1'],
      })
      const before = await client.inspect(firstLease)
      const replace = before.elements.find(element => element.name === 'Replace')!
      const oldTarget = before.elements.find(element => element.name === 'Old target')!
      await client.act(firstLease, { kind: 'click', element: replace.index })
      const after = await client.inspect(firstLease)
      const newTarget = after.elements.find(element => element.name === 'New target')!

      expect(newTarget.index).not.toBe(oldTarget.index)
      await expect(client.act(firstLease, {
        kind: 'click', element: newTarget.index, observationId: before.observationId,
      })).rejects.toThrow('browser-observation-stale')
      await expect(
        client.act(firstLease, { kind: 'click', element: oldTarget.index }),
      ).rejects.toThrow('browser-element-not-found')
    },
    20_000,
  )

  browserIt(
    'extracts real control state and waits for SPA and declarative conditions',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-observation-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease, {
        startUrl: `${fixture.origin}/controls`, allowedDomains: ['127.0.0.1'],
      })
      const controls = await client.inspect(firstLease)
      expect(controls.elements.find(element => element.tag === 'textarea')).toMatchObject({
        name: 'Notes label', readonly: true, required: true,
      })
      expect(controls.elements.find(element => element.name === 'Enabled')).toMatchObject({ checked: true })
      expect(controls.elements.find(element => element.name === 'Partial')).toMatchObject({ checked: 'mixed' })
      expect(controls.elements.find(element => element.name === 'Choice')).toMatchObject({
        selectedValue: 'b', multiple: true,
      })
      expect(controls.elements.find(element => element.name === 'Details')).toMatchObject({ expanded: true })

      await client.act(firstLease, { kind: 'navigate', url: `${fixture.origin}/spa` })
      await expect(client.act(firstLease, {
        kind: 'waitFor', selector: '#ready', timeout: 2_000,
      })).resolves.toMatchObject({ dispatched: true })
      await expect(client.act(firstLease, {
        kind: 'waitFor', role: 'button', timeout: 2_000,
      })).resolves.toMatchObject({ dispatched: true })
      await expect(client.act(firstLease, {
        kind: 'waitFor', text: 'SPA Ready', timeout: 2_000,
      })).resolves.toMatchObject({ dispatched: true })
      await expect(client.act(firstLease, {
        kind: 'waitFor', url: `${fixture.origin}/spa`, timeout: 2_000,
      })).resolves.toMatchObject({ dispatched: true })
      await expect(client.act(firstLease, {
        kind: 'waitFor', networkIdle: true, timeout: 2_000,
      })).resolves.toMatchObject({ dispatched: true })
      await expect(client.inspect(firstLease)).resolves.toMatchObject({
        ready: true, elementCount: 1,
      })
    },
    20_000,
  )

  browserIt(
    'reports visible blocking layers and distinguishes covered or hidden controls',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-overlay-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease, {
        startUrl: `${fixture.origin}/overlay`, allowedDomains: ['127.0.0.1'],
      })

      const observation = await client.inspect(firstLease, undefined, 'full')
      expect(observation.blockingLayers).toEqual([
        expect.objectContaining({
          tag: 'div', role: 'dialog', name: 'Login dialog', className: 'beyond-modal-wrap',
        }),
      ])
      expect(observation.elements.filter(element => element.name === 'Shared action')).toEqual([
        expect.objectContaining({ visible: true, inViewport: true, covered: true }),
        expect.objectContaining({ visible: false, inViewport: false, covered: false }),
      ])
      expect(observation.elements.find(element => element.name === 'Continue')).toMatchObject({
        visible: true, inViewport: true, covered: false,
      })
    },
    20_000,
  )

  browserIt(
    'allows an attachment to exceed the former byte budget',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-download-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const downloadRoot = join(directory, 'downloads')
      const server = await startBrowserd({
        socketPath,
        secret,
        executablePath: executablePath!,
        downloadRoot,
      })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease, {
        startUrl: `${fixture.origin}/download`,
        allowedDomains: ['127.0.0.1'],
      })
      const inspection = await client.inspect(firstLease)
      const download = inspection.elements.find(element => element.name === 'Download')!

      const result = await client.act(firstLease, { kind: 'click', element: download.index })
      expect(result.download?.size).toBe(20 * 16 * 1024)
      expect(result.download?.name).not.toMatch(/[\\/]/)
      expect(result.download?.name).not.toBe('..')
      expect(result.download?.path.startsWith(`${downloadRoot}/`)).toBe(true)
      expect((await stat(downloadRoot)).mode & 0o777).toBe(0o700)
      expect((await stat(dirname(result.download!.path))).mode & 0o777).toBe(0o700)
      expect((await stat(result.download!.path)).mode & 0o777).toBe(0o600)
      expect(fixture.downloadBytes).toBe(20 * 16 * 1024)
      await expect(client.status()).resolves.toMatchObject({ contexts: 1 })
    },
    20_000,
  )

  browserIt(
    'delivers a real private screenshot artifact with encoded pixel dimensions',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-screenshot-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const screenshotRoot = join(directory, 'screenshots')
      const server = await startBrowserd({
        socketPath,
        secret,
        executablePath: executablePath!,
        screenshotRoot,
      })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease, {
        startUrl: `${fixture.origin}/`,
        allowedDomains: ['127.0.0.1'],
      })

      const result = await client.screenshot(firstLease, { type: 'png', fullPage: true })
      const bytes = await readFile(result.path)
      expect(result.path.startsWith(`${screenshotRoot}/`)).toBe(true)
      expect(result.size).toBe(bytes.byteLength)
      expect(result.width).toBe(bytes.readUInt32BE(16))
      expect(result.height).toBe(bytes.readUInt32BE(20))
      expect((await stat(screenshotRoot)).mode & 0o777).toBe(0o700)
      expect((await stat(dirname(result.path))).mode & 0o777).toBe(0o700)
      expect((await stat(result.path)).mode & 0o777).toBe(0o600)
    },
    20_000,
  )

  browserIt(
    'allows an octet-stream download without Content-Disposition to finish',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-raw-download-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease, {
        startUrl: `${fixture.origin}/raw-download-page`,
        allowedDomains: ['127.0.0.1'],
      })
      const inspection = await client.inspect(firstLease)
      const download = inspection.elements.find(element => element.name === 'Raw download')!

      const result = await client.act(firstLease, { kind: 'click', element: download.index })
      expect(result.download?.size).toBe(20 * 16 * 1024)
      expect(fixture.rawDownloadBytes).toBe(20 * 16 * 1024)
    },
    20_000,
  )

  browserIt(
    'allows an explicit text download and ordinary HTML pages',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-plain-download-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease, {
        startUrl: `${fixture.origin}/plain-download-page`,
        allowedDomains: ['127.0.0.1'],
      })
      const inspection = await client.inspect(firstLease)
      const download = inspection.elements.find(element => element.name === 'Plain download')!

      const result = await client.act(firstLease, { kind: 'click', element: download.index })
      expect(result.download?.size).toBe(20 * 16 * 1024)
      expect(fixture.plainDownloadBytes).toBe(20 * 16 * 1024)

      await client.open(secondLease, {
        startUrl: `${fixture.origin}/ordinary-link-page`,
        allowedDomains: ['127.0.0.1'],
      })
      const ordinaryPage = await client.inspect(secondLease)
      const ordinaryLink = ordinaryPage.elements.find(element => element.name === 'Ordinary page')!
      await expect(
        client.act(secondLease, { kind: 'click', element: ordinaryLink.index }),
      ).resolves.toMatchObject({ url: `${fixture.origin}/large-html` })
      await expect(client.inspect(secondLease)).resolves.toMatchObject({
        url: `${fixture.origin}/large-html`,
        title: 'ordinary-html',
      })
    },
    20_000,
  )

  browserIt(
    'allows a native HTTP download with an arbitrary MIME type',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-unknown-download-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease, {
        startUrl: `${fixture.origin}/unknown-download-page`,
        allowedDomains: ['127.0.0.1'],
      })
      const inspection = await client.inspect(firstLease)
      const download = inspection.elements.find(element => element.name === 'Unknown download')!

      const result = await client.act(firstLease, { kind: 'click', element: download.index })
      expect(result.download?.size).toBe(20 * 16 * 1024)
      expect(fixture.unknownDownloadBytes).toBe(20 * 16 * 1024)
    },
    20_000,
  )

  browserIt(
    'allows a later download after a fetch from the same URL',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-same-url-download-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease, {
        startUrl: `${fixture.origin}/same-download-page`,
        allowedDomains: ['127.0.0.1'],
      })
      await waitUntil(async () => fixture.sameUrlRequests === 1)
      await client.act(firstLease, { kind: 'wait', milliseconds: 100 })
      const inspection = await client.inspect(firstLease)
      const download = inspection.elements.find(element => element.name === 'Same URL download')!

      const result = await client.act(firstLease, { kind: 'click', element: download.index })
      expect(result.download?.size).toBe(20 * 16 * 1024)
      expect(fixture.sameUrlRequests).toBe(2)
      expect(fixture.sameUrlDownloadBytes).toBe(20 * 16 * 1024)
    },
    20_000,
  )

  browserIt(
    'allows concurrent fetch and download responses for the same URL',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-bd-concurrent-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease, {
        startUrl: `${fixture.origin}/concurrent-download-page`,
        allowedDomains: ['127.0.0.1'],
      })
      await waitUntil(async () => fixture.concurrentRequests === 1)
      const inspection = await client.inspect(firstLease)
      const download = inspection.elements.find(element => element.name === 'Concurrent download')!

      const result = await client.act(firstLease, { kind: 'click', element: download.index })
      expect(result.download?.size).toBe(20 * 16 * 1024)
      expect(fixture.concurrentRequests).toBe(2)
      expect(fixture.concurrentDownloadBytes).toBe(20 * 16 * 1024)
    },
    20_000,
  )

  browserIt(
    'ignores a background 204 while waiting for the action download request',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-bd-background-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease, {
        startUrl: `${fixture.origin}/background-download-page`,
        allowedDomains: ['127.0.0.1'],
      })
      const inspection = await client.inspect(firstLease)
      const link = inspection.elements.find(element => element.name === 'Delayed download')!

      const result = await client.act(firstLease, { kind: 'click', element: link.index })
      expect(result.download).toMatchObject({ name: 'delayed.bin', size: 64 * 1024 })
      expect(fixture.backgroundNoContentRequests).toBe(1)
      expect(fixture.delayedDownloadBytes).toBe(64 * 1024)
      await expect(
        client.act(firstLease, { kind: 'wait', milliseconds: 1 }),
      ).resolves.not.toHaveProperty('download')
    },
    20_000,
  )

  browserIt(
    'allows multiple downloads from one action to complete',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-multiple-download-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease, {
        startUrl: `${fixture.origin}/multi-download-page`,
        allowedDomains: ['127.0.0.1'],
      })
      const inspection = await client.inspect(firstLease)
      const download = inspection.elements.find(element => element.name === 'Multiple downloads')!

      const result = await client.act(firstLease, { kind: 'click', element: download.index })
      expect(result.downloads).toHaveLength(2)
      expect(result.downloads?.map(item => item.size).sort()).toEqual([9, 9])
      expect(fixture.multiDownloadRequests).toBe(2)
    },
    20_000,
  )

  browserIt(
    'allows an HTTPS download to exceed the former byte budget',
    async () => {
      const pageFixture = await createPolicyFixture()
      const downloadFixture = await createHttpsDownloadFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-https-download-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const chromeWrapper = await createInsecureChromeWrapper(directory)
      const server = await startBrowserd({ socketPath, secret, executablePath: chromeWrapper })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      const downloadPage = `${pageFixture.origin}/download?target=${encodeURIComponent(downloadFixture.origin)}`
      await client.open(firstLease, {
        startUrl: downloadPage,
        allowedDomains: ['127.0.0.1'],
      })
      const inspection = await client.inspect(firstLease)
      const download = inspection.elements.find(element => element.name === 'HTTPS download')!

      const result = await client.act(firstLease, { kind: 'click', element: download.index })
      expect(result.download?.size).toBe(20 * 16 * 1024)
      expect(downloadFixture.bytes()).toBe(20 * 16 * 1024)
    },
    20_000,
  )

  browserIt(
    'destroys in-flight proxy resources when the owning connection closes',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-proxy-cleanup-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const owner = new BrowserBrokerClient({ socketPath, secret })
      const observer = new BrowserBrokerClient({ socketPath, secret })
      clients.push(owner, observer)
      await owner.open(firstLease, {
        startUrl: `${fixture.origin}/resource-page`,
        allowedDomains: ['127.0.0.1'],
      })
      await waitUntil(async () => fixture.resourceBytes > 0)

      owner.dispose()
      await waitUntil(async () => (await observer.status()).contexts === 0)
      await waitUntil(async () => fixture.resourceClosed)
      const bytesAfterCleanup = fixture.resourceBytes
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(fixture.resourceBytes).toBe(bytesAfterCleanup)
    },
    20_000,
  )

  browserIt(
    'settles an anchor action when its response has no content',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-no-content-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease, {
        startUrl: `${fixture.origin}/no-content-page`,
        allowedDomains: ['127.0.0.1'],
      })
      const inspection = await client.inspect(firstLease)
      const link = inspection.elements.find(element => element.name === 'No content')!

      await expect(
        client.act(firstLease, { kind: 'click', element: link.index }),
      ).resolves.toMatchObject({ dispatched: true, changed: false })
      await expect(client.status()).resolves.toMatchObject({ contexts: 1 })
    },
    20_000,
  )

  browserIt(
    'settles an action-intent wait when runtime shutdown closes its Context',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-shutdown-intent-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const owner = new BrowserBrokerClient({ socketPath, secret })
      const observer = new BrowserBrokerClient({ socketPath, secret })
      clients.push(owner, observer)
      await owner.open(firstLease, {
        startUrl: `${fixture.origin}/stalled-download-page`,
        allowedDomains: ['127.0.0.1'],
      })
      const inspection = await owner.inspect(firstLease)
      const link = inspection.elements.find(element => element.name === 'Stalled download')!
      const action = owner
        .act(firstLease, { kind: 'click', element: link.index })
        .then(
          () => undefined,
          error => error as Error,
        )

      await waitUntil(async () => fixture.stalledDownloadRequests === 1)
      await observer.shutdown()
      await expect(action).resolves.toMatchObject({ message: 'browser-broker-aborted' })
      await waitUntil(async () => fixture.stalledDownloadClosed)
    },
    20_000,
  )

  browserIt(
    'settles an action-intent wait when its client disconnects',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-abort-intent-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const owner = new BrowserBrokerClient({ socketPath, secret })
      clients.push(owner)
      await owner.open(firstLease, {
        startUrl: `${fixture.origin}/stalled-download-page`,
        allowedDomains: ['127.0.0.1'],
      })
      const inspection = await owner.inspect(firstLease)
      const link = inspection.elements.find(element => element.name === 'Stalled download')!
      const action = owner
        .act(firstLease, { kind: 'click', element: link.index })
        .catch(error => error as Error)

      await waitUntil(async () => fixture.stalledDownloadRequests === 1)
      owner.dispose()
      await expect(action).resolves.toMatchObject({ message: 'browser-broker-client-disposed' })
      await waitUntil(async () => fixture.stalledDownloadClosed)
      await server.close()
    },
    20_000,
  )

  browserIt(
    'cancels an active download and its upstream connection when the owner disconnects',
    async () => {
      const fixture = await createPolicyFixture()
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-download-cleanup-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const owner = new BrowserBrokerClient({ socketPath, secret })
      const observer = new BrowserBrokerClient({ socketPath, secret })
      clients.push(owner, observer)
      await owner.open(firstLease, {
        startUrl: `${fixture.origin}/active-download-page`,
        allowedDomains: ['127.0.0.1'],
      })
      const inspection = await owner.inspect(firstLease)
      const download = inspection.elements.find(element => element.name === 'Active download')!

      const action = owner
        .act(firstLease, { kind: 'click', element: download.index })
        .catch(() => undefined)
      await waitUntil(async () => fixture.activeDownloadBytes > 0)
      owner.dispose()

      await waitUntil(async () => (await observer.status()).contexts === 0)
      await waitUntil(async () => fixture.activeDownloadClosed)
      await action
      const bytesAfterCleanup = fixture.activeDownloadBytes
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(fixture.activeDownloadBytes).toBe(bytesAfterCleanup)
    },
    20_000,
  )

  browserIt(
    'closes a lease immediately when its client disconnects during an action',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-abort-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({
        socketPath,
        secret,
        executablePath: executablePath!,
        idleBrowserMs: 80,
        maxWaitMs: 6_000,
      })
      servers.push(server)
      const worker = new BrowserBrokerClient({ socketPath, secret })
      const observer = new BrowserBrokerClient({ socketPath, secret })
      clients.push(worker, observer)

      await worker.open(firstLease)
      const waiting = worker
        .act(firstLease, { kind: 'wait', milliseconds: 5_000 })
        .catch(() => undefined)
      await new Promise(resolve => setTimeout(resolve, 40))
      worker.dispose()

      await waitUntil(async () => (await observer.status()).contexts === 0, 800)
      await waiting
    },
    20_000,
  )

  it('returns a bounded protocol error for a non-object JSON request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-protocol-e2e-'))
    directories.push(directory)
    const socketPath = join(directory, 'browserd.sock')
    const server = await startBrowserd({ socketPath, secret })
    servers.push(server)

    const response = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(socketPath)
      const timeout = setTimeout(() => {
        socket.destroy()
        reject(new Error('protocol-response-timeout'))
      }, 800)
      socket.setEncoding('utf8')
      socket.once('connect', () => socket.write('null\n'))
      socket.once('data', data => {
        clearTimeout(timeout)
        socket.destroy()
        resolve(data)
      })
      socket.once('error', error => {
        clearTimeout(timeout)
        reject(error)
      })
    })

    expect(JSON.parse(response)).toEqual({
      type: 'error',
      requestId: 'unknown',
      error: { code: 'browser-broker-invalid-request', fatal: false, recoverable: true },
    })
  })

  it('creates the broker socket with the deployment same-user private mode', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-mode-e2e-'))
    directories.push(directory)
    const socketPath = join(directory, 'browserd.sock')
    const server = await startBrowserd({ socketPath, secret, socketMode: 0o600 })
    servers.push(server)

    expect((await stat(socketPath)).mode & 0o777).toBe(0o600)
  })

  it('rolls back the viewer gateway when broker socket startup fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-startup-rollback-'))
    directories.push(directory)
    const socketPath = join(directory, 'browserd.sock')
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>viewer</title>')
    const blocker = createNetServer()
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(socketPath, resolve)
    })
    const portProbe = createNetServer()
    await new Promise<void>((resolve, reject) => {
      portProbe.once('error', reject)
      portProbe.listen(0, '127.0.0.1', resolve)
    })
    const probeAddress = portProbe.address()
    if (!probeAddress || typeof probeAddress === 'string') throw new Error('viewer-port-unavailable')
    const viewerPort = probeAddress.port
    await new Promise<void>(resolve => portProbe.close(() => resolve()))
    try {
      await expect(startBrowserd({
        socketPath,
        secret,
        viewerMode: 'novnc',
        viewerHost: '127.0.0.1',
        viewerPort,
        novncRoot: directory,
      })).rejects.toBeDefined()
      const reusable = createNetServer()
      await new Promise<void>((resolve, reject) => {
        reusable.once('error', reject)
        reusable.listen(viewerPort, '127.0.0.1', resolve)
      })
      await new Promise<void>(resolve => reusable.close(() => resolve()))
    } finally {
      await new Promise<void>(resolve => blocker.close(() => resolve()))
    }
  })

  it('bounds the per-connection JSON-line request queue', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-queue-e2e-'))
    directories.push(directory)
    const socketPath = join(directory, 'browserd.sock')
    const server = await startBrowserd({
      socketPath,
      secret,
      maxPendingRequests: 1,
      maxPendingBytes: 512,
    })
    servers.push(server)
    const response = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(socketPath)
      let received = ''
      const timeout = setTimeout(() => {
        socket.destroy()
        resolve(received)
      }, 500)
      socket.setEncoding('utf8')
      socket.on('data', data => {
        received += data
        if (!received.includes('browser-broker-overloaded')) return
        clearTimeout(timeout)
        socket.destroy()
        resolve(received)
      })
      socket.once('connect', () => {
        socket.write([
          JSON.stringify({ type: 'status', requestId: 'queued-1', secret }),
          JSON.stringify({ type: 'status', requestId: 'queued-2', secret }),
          JSON.stringify({ type: 'status', requestId: 'queued-3', secret }),
          '',
        ].join('\n'))
      })
      socket.once('error', reject)
    })

    expect(response).toContain('browser-broker-overloaded')
  })

  const stoppingIt = executablePath ? it : it.skip
  stoppingIt(
    'stops accepting new connections before waiting for browser shutdown',
    async () => {
      let releaseClose!: () => void
      const closeGate = new Promise<void>(resolve => {
        releaseClose = resolve
      })
      const delegate = new PlaywrightBrowserDriver()
      const driver: BrowserDriver = {
        async launch(options) {
          const browser = await delegate.launch(options)
          return {
            pid: browser.pid,
            isConnected: () => browser.isConnected(),
            onDisconnected: listener => browser.onDisconnected(listener),
            newContext: options => browser.newContext(options),
            async close() {
              await closeGate
              await browser.close()
            },
          }
        },
      }
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-stopping-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({
        socketPath,
        secret,
        driver,
        executablePath: executablePath!,
      })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease)

      const closing = server.close()
      let connectedWhileStopping: boolean
      try {
        connectedWhileStopping = await new Promise<boolean>(resolve => {
          const socket = createConnection(socketPath)
          socket.once('connect', () => {
            socket.destroy()
            resolve(true)
          })
          socket.once('error', () => resolve(false))
        })
        expect(connectedWhileStopping).toBe(false)
      } finally {
        releaseClose()
      }
      await closing
    },
    20_000,
  )

  const disconnectIt = executablePath ? it : it.skip
  disconnectIt(
    'marks a killed Chromium disconnected and restarts on the next lease',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'dsh-browserd-disconnect-e2e-'))
      directories.push(directory)
      const socketPath = join(directory, 'browserd.sock')
      const server = await startBrowserd({ socketPath, secret, executablePath: executablePath! })
      servers.push(server)
      const client = new BrowserBrokerClient({ socketPath, secret })
      clients.push(client)
      await client.open(firstLease)
      const before = await client.status()
      expect(before.pid).toEqual(expect.any(Number))

      process.kill(before.pid!, 'SIGKILL')
      await waitUntil(async () => {
        const status = await client.status()
        return !status.browserRunning && status.contexts === 0
      }, 3_000)
      await client.open(secondLease)
      const after = await client.status()
      expect(after.pid).toEqual(expect.any(Number))
      expect(after.pid).not.toBe(before.pid)
    },
    20_000,
  )
})
