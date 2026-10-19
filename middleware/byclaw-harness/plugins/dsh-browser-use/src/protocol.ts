import type { GoalTicket } from './goal-control.js'
export const BROWSER_BROKER_MAX_FRAME_BYTES = 1024 * 1024

export interface BrowserLeaseCredentials {
  readonly leaseId: string
  readonly capability: string
}

export interface BrowserOpenOptions {
  /** Trusted DSH session identity used only for private viewer routing. */
  readonly viewerSessionId?: string
  readonly startUrl?: string
  readonly allowedDomains?: readonly string[]
  readonly allowSubmit?: boolean
}

export interface BrowserWaitForCondition {
  readonly selector?: string
  readonly role?: string
  readonly text?: string
  readonly url?: string
  readonly networkIdle?: boolean
  readonly timeout?: number
}

export interface BrowserScreenshotOptions {
  readonly type?: 'png' | 'jpeg'
  readonly fullPage?: boolean
  readonly element?: number
  readonly clip?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly quality?: number
}

export type BrowserAction =
  | ({ readonly kind: 'scroll'; readonly observationId?: string } & BrowserScrollOptions)
  | { readonly kind: 'focus' }
  | { readonly kind: 'navigate'; readonly url: string; readonly observationId?: string }
  | { readonly kind: 'click'; readonly element: number; readonly observationId?: string }
  | { readonly kind: 'fill'; readonly element: number; readonly value: string; readonly observationId?: string }
  | { readonly kind: 'select'; readonly element: number; readonly value: string; readonly observationId?: string }
  | { readonly kind: 'press'; readonly key: string }
  | { readonly kind: 'wait'; readonly milliseconds: number }
  | ({ readonly kind: 'waitFor' } & BrowserWaitForCondition)

export interface BrowserElement {
  readonly clickable?: boolean
  readonly editable?: boolean
  readonly submit?: boolean
  readonly scrollUp?: boolean
  readonly scrollDown?: boolean
  readonly options?: readonly { value: string; label: string; disabled: boolean; selected: boolean }[]

  readonly scrollable?: boolean
  readonly index: number
  readonly tag: string
  readonly role?: string
  readonly name: string
  readonly type?: string
  readonly value?: string
  readonly disabled: boolean
  readonly checked?: boolean | 'mixed'
  readonly selectedValue?: string
  readonly readonly?: boolean
  readonly required?: boolean
  readonly multiple?: boolean
  readonly accept?: string
  readonly expanded?: boolean
  readonly visible?: boolean
  readonly inViewport?: boolean
  readonly covered?: boolean
}

export interface BrowserBlockingLayer {
  readonly tag: string
  readonly role?: string
  readonly name: string
  readonly className?: string
}

export interface BrowserInspection {
  readonly semanticToken?: string
  readonly scroll?: { up: boolean; down: boolean }
  readonly omittedElements?: number
  readonly url: string
  readonly title: string
  readonly text: string
  readonly elements: readonly BrowserElement[]
  readonly blockingLayers?: readonly BrowserBlockingLayer[]
  readonly ready?: boolean
  readonly elementCount?: number
  readonly observationId?: string
}

export interface BrowserActionResult {
  readonly scroll?: BrowserScrollResult
  readonly changed: boolean
  readonly dispatched?: boolean
  readonly textDrift?: boolean
  readonly url?: string
  readonly download?: {
    readonly name: string
    readonly path: string
    readonly size: number
  }
  readonly downloads?: readonly {
    readonly name: string
    readonly path: string
    readonly size: number
  }[]
}

export interface BrowserScreenshot {
  readonly mimeType: 'image/png' | 'image/jpeg'
  readonly width: number
  readonly height: number
  readonly size: number
  readonly sha256: string
  readonly path: string
}

export interface BrowserBrokerStatus {
  readonly browserRunning: boolean
  readonly contexts: number
  readonly pid?: number
}

interface BrowserBrokerRequestBase {
  readonly requestId: string
  readonly secret: string
}

interface BrowserBrokerLeaseRequestBase extends BrowserBrokerRequestBase, BrowserLeaseCredentials {}

export interface BrowserBrokerOpenRequest extends BrowserBrokerLeaseRequestBase {
  readonly type: 'open'
  readonly options: BrowserOpenOptions
}

export interface BrowserBrokerInspectRequest extends BrowserBrokerLeaseRequestBase {
  readonly type: 'inspect'
  readonly detail?: 'compact' | 'full'
}

export interface BrowserScrollOptions {
  readonly element?: number
  readonly deltaY: number
  readonly deltaX?: number
}

export interface BrowserScrollResult {
  readonly beforeX: number
  readonly beforeY: number
  readonly afterX: number
  readonly afterY: number
  readonly deltaX: number
  readonly deltaY: number
}

export interface BrowserBrokerProbeRequest extends BrowserBrokerLeaseRequestBase {
  readonly type: 'probe'
}

export interface BrowserBrokerActRequest extends BrowserBrokerLeaseRequestBase {
  readonly type: 'act'
  readonly action: BrowserAction
  readonly semanticToken?: string
  readonly ticket?: GoalTicket
}

export interface BrowserBrokerScreenshotRequest extends BrowserBrokerLeaseRequestBase {
  readonly type: 'screenshot'
  readonly options?: BrowserScreenshotOptions
}

export interface BrowserBrokerCloseRequest extends BrowserBrokerLeaseRequestBase {
  readonly type: 'close'
}

export interface BrowserBrokerStatusRequest extends BrowserBrokerRequestBase {
  readonly type: 'status'
}

export interface BrowserBrokerShutdownRequest extends BrowserBrokerRequestBase {
  readonly type: 'shutdown'
}

export interface BrowserBrokerCancelRequest extends BrowserBrokerRequestBase {
  readonly type: 'cancel'
  readonly targetRequestId: string
  readonly leaseId?: string
  readonly capability?: string
}

export type BrowserGoalCommand =
  | { command: 'start'; runId: string; maxRunMs: number; maxPauseMs: number }
  | { command: 'state'; runId: string }
  | { command: 'finish'; runId: string }
  | { command: 'progress'; runId: string; decisions: number; actions: number }
  | { command: 'check'; runId: string; generation: number; semanticToken: string }
  | { command: 'pause' | 'resume' | 'cancel'; runId: string; generation: number }
export interface BrowserBrokerGoalRequest extends BrowserBrokerLeaseRequestBase {
  readonly type: 'goal'
  readonly control: BrowserGoalCommand
}

export type BrowserBrokerRequest =
  | BrowserBrokerGoalRequest
  | BrowserBrokerOpenRequest
  | BrowserBrokerProbeRequest
  | BrowserBrokerInspectRequest
  | BrowserBrokerActRequest
  | BrowserBrokerScreenshotRequest
  | BrowserBrokerCloseRequest
  | BrowserBrokerStatusRequest
  | BrowserBrokerShutdownRequest
  | BrowserBrokerCancelRequest

export interface BrowserBrokerOkResponse {
  readonly type: 'ok'
  readonly requestId: string
  readonly result: unknown
}

export interface BrowserBrokerErrorResponse {
  readonly type: 'error'
  readonly requestId: string
  readonly error: {
    readonly code: string
    readonly detail?: string
    readonly fatal?: boolean
    readonly recoverable?: boolean
  }
}

export type BrowserBrokerResponse = BrowserBrokerOkResponse | BrowserBrokerErrorResponse
