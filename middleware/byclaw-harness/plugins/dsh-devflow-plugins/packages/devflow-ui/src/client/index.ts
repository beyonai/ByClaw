/**
 * Devflow board plugin, browser half.
 *
 * The board is a page type in the Harness right Sidebar. Its definition is
 * registered in `ctx.sidebarRightTabs`; its body occupies the keyed
 * `sidebar.right.pane.tab` seat under the same implementation id. Board data
 * still travels through this plugin's own read face and is scoped only by the
 * session id supplied by the official session-scoped slot.
 *
 * The plugin issues no mutations: card moves belong to the model tools and the
 * `/devflow` intervention plane.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createElement } from 'react'
import { IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { BETTER_SIDEBAR, type BetterSidebarService, type BetterSidebarTabProps } from './better-sidebar.ts'
import { createBoardBinding } from './binding.ts'
import type { BoardBinding } from './binding.ts'
import {
  createDevflowBoardPage, createDevflowBoardScopedPage, type DevflowBoardPageDeps,
} from './DevflowBoardTab.tsx'
import { watchChanges } from './changes.ts'
import { en, NS, zh, type DevflowKey } from './locales.ts'
import type { SidebarRightTabDefinition } from './sidebar-right.ts'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Devflow board copy. */
    'devflow': DevflowKey
  }
}

/** This implementation's unique identity and keyed body registration key. */
export const BOARD_TAB_ID = '@zhchxiao123/dsh-devflow-ui'

/** Page kind named by `ctx.sidebarRight.openTab`. */
export const BOARD_TAB_KIND = 'devflow'

/** Stable page identity used by the optional dsh-better-sidebar bridge. */
export const BETTER_SIDEBAR_TAB_ID = 'dsh-devflow:board'

export { createBoardSource, createDetailSource } from './board.ts'
export type { DevflowBoardSnapshot, DevflowBoardSource, DevflowDetailSnapshot, DevflowDetailSource } from './board.ts'
export type { DevflowBoardTabProps, DevflowBoardPageDeps } from './DevflowBoardTab.tsx'

/** Required browser services, including the official right-Sidebar registry. */
export const inject = ['sessions', 'slots', 'locale', 'sidebarRightTabs']

/**
 * Define the Devflow page and its entry on the Sidebar guide.
 * @param ctx - client context carrying the locale service.
 * @returns the static tab-type definition.
 */
export function boardTabDefinition(ctx: ClientContext): SidebarRightTabDefinition {
  const t = ctx.locale.bind(NS)
  return {
    id: BOARD_TAB_ID,
    kind: BOARD_TAB_KIND,
    title: () => t('panel.title'),
    guide: [{
      order: 20,
      title: () => t('panel.title'),
      description: () => t('guide.description'),
      icon: IconBranchOutlineRegular,
    }],
  }
}

/**
 * Register the official Sidebar page, its dictionaries, and its live read
 * bindings.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-devflow: dictionaries')
  // Session navigation moved from `ctx.sessions` to the workspace view owner
  // (`@deepseek-ai/dsh-client-ui-workspace`). Looked up by name rather than
  // injected so the board never waits on it; absent, a click does nothing.
  const openSession = (id: string): void => {
    const workspace = ctx.get('uiWorkspace') as { openSession(id: SessionId): void } | undefined
    workspace?.openSession(id as SessionId)
  }
  const bindings = new Map<string, { binding: BoardBinding; watchers: number }>()

  const entryFor = (sessionId: string): { binding: BoardBinding; watchers: number } => {
    const existing = bindings.get(sessionId)
    if (existing !== undefined) return existing
    const created = { binding: createBoardBinding(ctx, sessionId), watchers: 0 }
    bindings.set(sessionId, created)
    return created
  }
  const watch = (sessionId: string): (() => void) => {
    const entry = entryFor(sessionId)
    entry.watchers += 1
    void entry.binding.refresh()
    return () => { entry.watchers -= 1 }
  }
  const refreshVisible = (): void => {
    for (const entry of bindings.values()) {
      if (entry.watchers > 0) void entry.binding.refresh()
    }
  }

  ctx.effect(() => watchChanges(refreshVisible), 'ui-devflow: change stream')
  ctx.effect(() => ctx.sidebarRightTabs.register(boardTabDefinition(ctx)), 'ui-devflow: Sidebar tab type')

  const pageDeps: DevflowBoardPageDeps = {
    bindingFor: sessionId => entryFor(sessionId).binding,
    watch,
    openSession,
    t: ctx.locale.bind(NS),
  }
  const page = createDevflowBoardPage(pageDeps)
  const scopedPage = createDevflowBoardScopedPage(pageDeps)
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: BOARD_TAB_ID,
    locale: NS,
  }, page)), 'ui-devflow: Sidebar tab body')

  // Some deployments replace the visible Harness Sidebar with the ecosystem
  // dsh-better-sidebar foundation. Keep the official registration above as
  // the canonical path, and mirror the same page into that optional registry
  // whenever its service appears. The service is intentionally not an inject
  // dependency: a missing optional foundation must never hold Devflow pending.
  ctx.effect(() => {
    let service: BetterSidebarService | undefined
    let unregister: (() => void) | undefined
    const sync = (): void => {
      const next = ctx.get(BETTER_SIDEBAR) as BetterSidebarService | undefined
      if (next === service) return
      unregister?.()
      unregister = undefined
      service = next
      if (next === undefined) return
      const BetterSidebarPage = ({ scope, visible }: BetterSidebarTabProps) => createElement(scopedPage, {
        sessionId: scope.sessionId,
        visible,
        fullscreen: false,
      })
      try {
        unregister = next.registerTab({
          id: BETTER_SIDEBAR_TAB_ID,
          title: () => ctx.locale.bind(NS)('panel.title'),
          icon: size => createElement(IconBranchOutlineRegular, { size }),
          order: 60,
          single: true,
          component: BetterSidebarPage,
        })
      } catch (error) {
        ctx.logger.warn(`ui-devflow: Better Sidebar refused the board page: ${String(error)}`)
      }
    }
    const stopWatching = ctx.on('internal/service', (name: string) => {
      if (name === BETTER_SIDEBAR) sync()
    })
    sync()
    return () => {
      stopWatching()
      unregister?.()
    }
  }, 'ui-devflow: Better Sidebar bridge')
}
