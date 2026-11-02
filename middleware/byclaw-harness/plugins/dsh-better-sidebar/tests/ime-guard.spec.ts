// @vitest-environment jsdom
/**
 * IME-composition guard tests.
 *
 * The guard registers document CAPTURE-phase keydown/keyup listeners that
 * stopPropagation() while an input method is composing (isComposing or the
 * legacy keyCode 229). These tests pin:
 *
 * 1. the pure decision (`isImeComposition`);
 * 2. the native-listener path — a bubble listener on `document` and a
 *    target-phase listener on the input must NOT see composition keys, but
 *    must see every other key;
 * 3. the React-synthetic path — a React `onKeyDown` handler (delegated at
 *    the root container) must not fire for composition keys, proving the
 *    document-capture listener wins the ordering race against React's
 *    delegation (the mechanism that inlined third-party UI, e.g. Univer's
 *    InputNumber, uses to hijack ArrowUp/ArrowDown);
 * 4. the disposer restores normal flow (HMR-safe).
 *
 * Events are dispatched on a deep element (an `<input>` in `document.body`)
 * exactly like the browser does, so capture-phase blocking behaves like in
 * production — dispatching on `document` itself would run all listeners in
 * the target phase where stopPropagation does not stop same-node listeners.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { isImeComposition, registerImeGuard } from '../src/client/ime-guard.ts'

/** Build a KeyboardEvent the way jsdom allows: keyCode/isComposing via defineProperty. */
function keyEvent(
  type: 'keydown' | 'keyup',
  init: { key: string; isComposing?: boolean; keyCode?: number; bubbles?: boolean },
): KeyboardEvent {
  const event = new KeyboardEvent(type, { key: init.key, bubbles: init.bubbles ?? true, cancelable: true })
  if (init.isComposing !== undefined) {
    Object.defineProperty(event, 'isComposing', { value: init.isComposing })
  }
  if (init.keyCode !== undefined) {
    Object.defineProperty(event, 'keyCode', { value: init.keyCode })
  }
  return event
}

describe('isImeComposition', () => {
  it('treats isComposing as composition', () => {
    expect(isImeComposition({ isComposing: true, keyCode: 0 })).toBe(true)
  })

  it('treats keyCode 229 as composition (legacy engines without isComposing)', () => {
    expect(isImeComposition({ isComposing: false, keyCode: 229 })).toBe(true)
  })

  it('treats both signals together as composition', () => {
    expect(isImeComposition({ isComposing: true, keyCode: 229 })).toBe(true)
  })

  it('lets ordinary keys through', () => {
    expect(isImeComposition({ isComposing: false, keyCode: 40 })).toBe(false)
    expect(isImeComposition({ isComposing: false, keyCode: 0 })).toBe(false)
  })
})

describe('registerImeGuard — native listeners', () => {
  let input: HTMLInputElement
  let dispose: (() => void) | undefined
  const seen: string[] = []

  const onDocumentBubble = (event: Event): void => {
    seen.push(`document:${event.type}`)
  }
  const onInputTarget = (event: Event): void => {
    seen.push(`input:${event.type}`)
  }

  beforeEach(() => {
    input = document.createElement('input')
    document.body.appendChild(input)
    seen.length = 0
    document.addEventListener('keydown', onDocumentBubble)
    document.addEventListener('keyup', onDocumentBubble)
    input.addEventListener('keydown', onInputTarget)
    input.addEventListener('keyup', onInputTarget)
  })

  afterEach(() => {
    dispose?.()
    dispose = undefined
    document.removeEventListener('keydown', onDocumentBubble)
    document.removeEventListener('keyup', onDocumentBubble)
    input.removeEventListener('keydown', onInputTarget)
    input.removeEventListener('keyup', onInputTarget)
    input.remove()
  })

  it('lets ordinary keys reach document bubble and input target listeners', () => {
    dispose = registerImeGuard()
    input.dispatchEvent(keyEvent('keydown', { key: 'ArrowDown' }))
    input.dispatchEvent(keyEvent('keyup', { key: 'ArrowDown' }))
    expect(seen).toEqual(['input:keydown', 'document:keydown', 'input:keyup', 'document:keyup'])
  })

  it('blocks composition keys (isComposing) from every downstream listener', () => {
    dispose = registerImeGuard()
    input.dispatchEvent(keyEvent('keydown', { key: 'ArrowDown', isComposing: true }))
    input.dispatchEvent(keyEvent('keyup', { key: 'ArrowDown', isComposing: true }))
    expect(seen).toEqual([])
  })

  it('blocks composition keys signalled by keyCode 229 only', () => {
    dispose = registerImeGuard()
    input.dispatchEvent(keyEvent('keydown', { key: 'ArrowDown', keyCode: 229 }))
    expect(seen).toEqual([])
  })

  it('still blocks after the composition signal is gone (guard is per-event)', () => {
    dispose = registerImeGuard()
    input.dispatchEvent(keyEvent('keydown', { key: 'ArrowDown', isComposing: true }))
    input.dispatchEvent(keyEvent('keydown', { key: 'ArrowDown', isComposing: false }))
    expect(seen).toEqual(['input:keydown', 'document:keydown'])
  })

  it('disposer restores normal flow', () => {
    dispose = registerImeGuard()
    input.dispatchEvent(keyEvent('keydown', { key: 'ArrowDown', isComposing: true }))
    expect(seen).toEqual([])
    dispose()
    dispose = undefined
    input.dispatchEvent(keyEvent('keydown', { key: 'ArrowDown', isComposing: true }))
    expect(seen).toEqual(['input:keydown', 'document:keydown'])
  })
})

describe('registerImeGuard — React synthetic path', () => {
  let container: HTMLDivElement
  let root: Root
  let input: HTMLInputElement
  let dispose: (() => void) | undefined
  const seen: string[] = []

  const onReactKeyDown = (): void => {
    seen.push('react:keydown')
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(createElement('input', { 'data-testid': 'ime-target', onKeyDown: onReactKeyDown }))
    })
    input = container.querySelector('input') as HTMLInputElement
    seen.length = 0
  })

  afterEach(() => {
    dispose?.()
    dispose = undefined
    act(() => { root.unmount() })
    container.remove()
  })

  it('baseline: React onKeyDown receives composition keys when the guard is absent', () => {
    input.dispatchEvent(keyEvent('keydown', { key: 'ArrowDown', isComposing: true }))
    expect(seen).toEqual(['react:keydown'])
  })

  it('guard blocks React synthetic onKeyDown during composition (capture beats delegation)', () => {
    dispose = registerImeGuard()
    input.dispatchEvent(keyEvent('keydown', { key: 'ArrowDown', isComposing: true }))
    expect(seen).toEqual([])
    // Ordinary keys still flow through React after the guard is in place.
    input.dispatchEvent(keyEvent('keydown', { key: 'ArrowDown', isComposing: false }))
    expect(seen).toEqual(['react:keydown'])
  })

  it('disposer restores the React synthetic path', () => {
    dispose = registerImeGuard()
    input.dispatchEvent(keyEvent('keydown', { key: 'ArrowDown', isComposing: true }))
    expect(seen).toEqual([])
    dispose()
    dispose = undefined
    input.dispatchEvent(keyEvent('keydown', { key: 'ArrowDown', isComposing: true }))
    expect(seen).toEqual(['react:keydown'])
  })
})
