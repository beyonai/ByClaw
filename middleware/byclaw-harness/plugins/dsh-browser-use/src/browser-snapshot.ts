import type { BrowserElementDescription, BrowserPageSnapshot } from './browser-runtime.js'

/** Serialized into the page as a closure held ONLY by a private JSHandle.
 * No window property, DOM attribute or model-supplied selector owns node IDs.
 * Keep all browser-side helpers inside this function (no runtime imports).
 */
export function createSnapshotRegistry(config: {
  nextIndex: number
  documentId: string
  interactiveSelector: string
  blockingSelector: string
}) {
  const ids = new WeakMap<Element, number>()
  let observed = new Map<number, Element>()
  let nextIndex = config.nextIndex
  const identity = (element: Element): number => {
    let index = ids.get(element)
    if (index === undefined) { index = nextIndex++; ids.set(element, index) }
    return index
  }
  const clip = (value: string | null | undefined, max: number) => (value ?? '').slice(0, max)
  const parent = (element: Element): Element | null => element.assignedSlot ?? element.parentElement
    ?? (element.getRootNode() instanceof ShadowRoot ? (element.getRootNode() as ShadowRoot).host : null)
  const clippedRect = (element: Element, rect = element.getBoundingClientRect(), includeSelf = false) => {
    let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right)
    let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom)
    for (let ancestor: Element | null = includeSelf ? element : parent(element); ancestor; ancestor = parent(ancestor)) {
      const style = getComputedStyle(ancestor), bounds = ancestor.getBoundingClientRect()
      if (style.display === 'none' || Number(style.opacity) === 0) return { left, right: left, top, bottom: top }
      if (/hidden|clip|auto|scroll/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right) }
      if (/hidden|clip|auto|scroll/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom) }
    }
    return { left, right, top, bottom }
  }
  const scrollable = (element: Element) => {
    const style = getComputedStyle(element)
    return element !== document.scrollingElement && (
      (/auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight)
      || (/auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth))
  }
  const hash = (value: string) => {
    let first = 0x811c9dc5, second = 0x9e3779b9
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i)
      first = Math.imul(first ^ code, 0x01000193) >>> 0
      second = Math.imul(second ^ code, 0x85ebca6b) >>> 0
    }
    return `${value.length}:${first.toString(16)}:${second.toString(16)}`
  }
  const visibility = (element: Element) => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect()
    const visible = style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0
    const clipped = clippedRect(element, rect)
    const inViewport = visible && clipped.bottom > clipped.top && clipped.right > clipped.left
    let hit = inViewport ? document.elementFromPoint(
      Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2)),
      Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2)),
    ) : null
    // elementFromPoint on document returns the host for open shadow roots.
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(
        Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2)),
        Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2)),
      )
      if (!inner || inner === hit) break
      hit = inner
    }
    let ancestor: Node | null = hit
    while (ancestor && ancestor !== element) {
      ancestor = ancestor.parentNode ?? (ancestor instanceof ShadowRoot ? ancestor.host : null)
    }
    return { visible, inViewport, covered: Boolean(hit && !ancestor) }
  }
  const disabled = (element: Element) => {
    for (let e: Element | null = element; e; e = parent(e)) {
      if (e.hasAttribute('inert') || e.getAttribute('aria-disabled') === 'true' || e.matches(':disabled')) return true
    }
    return false
  }
  const describe = (element: Element): BrowserElementDescription => {
    const input = element instanceof HTMLInputElement ? element : undefined
    const select = element instanceof HTMLSelectElement ? element : undefined
    const textarea = element instanceof HTMLTextAreaElement ? element : undefined
    const button = element instanceof HTMLButtonElement ? element : undefined
    const control = input ?? select ?? textarea
    const root = element.getRootNode() as Document | ShadowRoot
    const labelledBy = element.getAttribute('aria-labelledby')?.trim().split(/\s+/)
      .map(id => root.getElementById(id)?.textContent?.trim() ?? '').filter(Boolean).join(' ')
    const labels = control?.labels ? Array.from(control.labels).map(label => label.textContent?.trim() ?? '').filter(Boolean).join(' ') : ''
    const name = element.getAttribute('aria-label')?.trim() || labelledBy || labels
      || element.getAttribute('placeholder')?.trim() || element.getAttribute('title')?.trim()
      || element.getAttribute('name')?.trim() || (control ? '' : (element as HTMLElement).innerText?.trim())
      || (input?.type === 'password' ? '' : input?.value?.trim()) || ''
    const submit = button?.type === 'submit' || input?.type === 'submit' || input?.type === 'image'
    const type = input?.type ?? button?.type
    const role = element.getAttribute('role')
    return {
      stableIndex: identity(element), tag: element.tagName.toLowerCase(), name: clip(name, 256),
      ...(role ? { role: clip(role, 64) } : {}), ...(type ? { type } : {}),
      ...(control && input?.type !== 'password' ? { value: clip(control.value, 512) } : {}),
      disabled: disabled(element),
      clickable: Boolean(button || element.matches('a[href],[role=button],[role=option],[role=tab],[role=menuitem],[role=checkbox],[role=radio]') || (input && ['button', 'submit', 'image', 'checkbox', 'radio'].includes(input.type))),
      editable: Boolean(textarea || (element as HTMLElement).isContentEditable || (input && ['text', 'search', 'email', 'url', 'tel', 'number'].includes(input.type))),
      ...(select ? { options: Array.from(select.options).slice(0, 100).map(o => ({ value: clip(o.value, 512), label: clip(o.label, 256), selected: o.selected, disabled: o.disabled || (o.parentElement instanceof HTMLOptGroupElement && o.parentElement.disabled) })) } : {}),
      submit, keyboardSubmit: submit || Boolean(input?.form && !['button', 'reset'].includes(input.type)),
      ...((input?.type === 'checkbox' || input?.type === 'radio')
        ? { checked: element.getAttribute('aria-checked') === 'mixed' ? 'mixed' as const : input.checked } : {}),
      ...(select ? { selectedValue: clip(select.value, 512) } : {}),
      ...(control ? { readonly: 'readOnly' in control && control.readOnly, required: control.required } : {}),
      ...(input || select ? { multiple: input?.multiple ?? select?.multiple ?? false } : {}),
      ...(input?.type === 'file' ? { accept: clip(input.accept, 512) } : {}),
      ...(['true', 'false'].includes(element.getAttribute('aria-expanded') ?? '')
        ? { expanded: element.getAttribute('aria-expanded') === 'true' } : {}),
      ...visibility(element),
      ...(scrollable(element) ? { scrollable: true, scrollUp: element.scrollTop > 0, scrollDown: element.scrollTop + element.clientHeight < element.scrollHeight - 1 } : {}),
    }
  }
  const collect = (selector: string): Element[] => {
    const result: Element[] = []
    const visit = (root: Document | ShadowRoot) => {
      for (const element of root.querySelectorAll(selector)) result.push(element)
      for (const element of root.querySelectorAll('*')) if (element.shadowRoot) visit(element.shadowRoot)
    }
    visit(document)
    return result
  }
  return {
    scroll(options: { element?: number; deltaY: number; deltaX?: number }) {
      let target = options.element === undefined ? document.scrollingElement : observed.get(options.element)
      if (!target?.isConnected) return { error: 'browser-element-not-found' as const }
      if (options.element !== undefined && !visibility(target).inViewport) return { error: 'browser-element-not-visible' as const }
      // An observed child may anchor its nearest scroll container; never fall back
      // to the document for a stale or invalid explicit index.
      while (target && target !== document.scrollingElement && !scrollable(target)) target = parent(target)
      target ??= document.scrollingElement
      if (!target) return { error: 'browser-element-not-found' as const }
      const beforeX = target.scrollLeft, beforeY = target.scrollTop
      target.scrollBy({ left: options.deltaX ?? 0, top: options.deltaY, behavior: 'instant' })
      const afterX = target.scrollLeft, afterY = target.scrollTop
      return { beforeX, beforeY, afterX, afterY, deltaX: afterX - beforeX, deltaY: afterY - beforeY }
    },
    element(index: number) {
      const element = observed.get(index)
      return element?.isConnected ? element : null
    },
    capture(options: { maxElements: number; maxTextChars: number; observe: boolean; detail?: 'compact' | 'full' }): BrowserPageSnapshot & { nextIndex: number } {
      const compact = options.detail === 'compact'
      const candidates = [...new Set([...collect(config.interactiveSelector), ...collect('*').filter(scrollable)])]
      const selected = (compact ? candidates.filter(element => visibility(element).inViewport) : candidates).slice(0, options.maxElements)
      let optionBudget = 500
      const elements = selected.map(element => {
        const description = describe(element)
        if (!description.options) return description
        const options = description.options.slice(0, optionBudget)
        optionBudget -= options.length
        return { ...description, options }
      })
      const layers = collect(config.blockingSelector).map(element => ({
        element, state: visibility(element), style: getComputedStyle(element),
      }))
      const blockingLayers = layers.filter(({ element, state, style }) =>
        state.inViewport && style.pointerEvents !== 'none' && element.getAttribute('aria-hidden') !== 'true',
      ).slice(0, 20).map(({ element }) => ({
        tag: element.tagName.toLowerCase(),
        ...(element.getAttribute('role') ? { role: clip(element.getAttribute('role'), 64) } : {}),
        name: clip(element.getAttribute('aria-label')?.trim() || element.getAttribute('title')?.trim() || element.textContent?.trim(), 256),
        ...(element.getAttribute('class') ? { className: clip(element.getAttribute('class'), 256) } : {}),
      }))
      let text = ''
      if (!compact) text = clip(document.body?.innerText, options.maxTextChars)
      else {
        const limit = Math.min(6000, options.maxTextChars)
        const visit = (root: Node) => {
          const assigned = root instanceof HTMLSlotElement ? root.assignedNodes({ flatten: true }) : []
          for (const node of assigned.length ? assigned : root.childNodes) {
            if (text.length >= limit) break
            if (node instanceof Element) {
              if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'].includes(node.tagName)) continue
              if (node.shadowRoot) visit(node.shadowRoot)
              else visit(node)
            } else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
              const element = (node as Text).assignedSlot ?? node.parentElement
                ?? (node.parentNode instanceof ShadowRoot ? node.parentNode.host : null)
              if (!element) continue
              const style = getComputedStyle(element)
              if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) continue
              const range = document.createRange()
              const appendVisible = (start: number, end: number) => {
                if (start >= end || text.length >= limit) return
                if (end - start === 1 && /\s/.test(node.textContent![start]!)) {
                  if (text && !/\s$/.test(text)) text += ' '
                  return
                }
                range.setStart(node, start); range.setEnd(node, end)
                const rect = range.getBoundingClientRect(), bounds = clippedRect(element, rect, true)
                if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return
                if (end - start === 1 || (bounds.left <= rect.left && bounds.right >= rect.right
                  && bounds.top <= rect.top && bounds.bottom >= rect.bottom)) {
                  text += node.textContent!.slice(start, Math.min(end, start + limit - text.length))
                } else {
                  const middle = start + Math.floor((end - start) / 2)
                  appendVisible(start, middle); appendVisible(middle, end)
                }
              }
              appendVisible(0, node.textContent.length)
              if (text && !text.endsWith('\n')) text += '\n'
            }
          }
        }
        if (document.body) visit(document.body)
        text = text.slice(0, limit)
      }
      const url = clip(location.href, 4096), title = clip(document.title, 512)
      const stateFingerprint = hash(JSON.stringify([
        config.documentId, url, title, elements, scrollX, scrollY,
        candidates.filter(scrollable).map(e => [identity(e), e.scrollLeft, e.scrollTop]),
        selected.map(e => [clip(e.getAttribute('href'), 4096), e.getAttribute('aria-selected')]),
        blockingLayers,
        layers.slice(0, 20).map(({ element, state, style }) => [identity(element), state, style.pointerEvents,
          clip(element.getAttribute('class'), 256), element.getAttribute('aria-modal'), element.getAttribute('aria-hidden')]),
      ]))
      if (options.observe) observed = new Map(selected.map(e => [identity(e), e]))
      const doc = document.scrollingElement
      return { url, title, text, elements, blockingLayers, stateFingerprint, contentFingerprint: hash(text), nextIndex,
        scroll: { up: (doc?.scrollTop ?? 0) > 0, down: Boolean(doc && doc.scrollTop + doc.clientHeight < doc.scrollHeight - 1) },
        omittedElements: candidates.length - selected.length }
    },
  }
}
