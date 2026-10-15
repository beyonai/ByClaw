/**
 * The slice of the Harness right-Sidebar contract this plugin consumes.
 *
 * `@deepseek-ai/dsh-client-ui-sidebar-right` is published, but its tarball
 * declares no dependency beyond `@deepseek-ai/cordis` while its `.d.ts` imports
 * `dsh-client-ui-dockkit` and `dsh-client-ui-layout/client`, which reach on to
 * `dsh-brand`, `dsh-client-ui-theme`, `dsh-client-ui-settings`, and the host
 * package `dsh-host-webserver`. Consuming it means pinning that whole graph
 * here, and under `skipLibCheck` every member of it left unpinned degrades to
 * `any` with no diagnostic. The stable service and slot boundary is restated
 * instead. A divergence from the Harness package's client contract is a defect
 * in this copy.
 *
 * The restatement is narrower than the original on purpose: it declares what
 * the board reads and omits the rest. The original's other three seats
 * (`rightbar.session`, `sidebar.right.pane.tab.title`,
 * `sidebar.right.tab.menu.item`) and its `sidebarRight` copy namespace are
 * absent because nothing here registers into them; the per-member narrowings
 * are noted at each declaration.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComponentType } from 'react'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SlotHookFactory } from '@deepseek-ai/dsh-client-ui-slots'

/** One entry box contributed to the Sidebar's start page. */
export interface SidebarRightGuideEntry {
  readonly order: number
  readonly title: () => string
  readonly description?: () => string
  readonly icon?: ComponentType<IconProps>
}

/**
 * Static identity and copy for one page type.
 *
 * The original also carries `patterns`, `priority`, and `canOpen`, by which a
 * resource type claims addresses. The board is a page type, opened by kind.
 */
export interface SidebarRightTabDefinition {
  readonly id: string
  readonly kind: string
  readonly title: (address: string) => string
  readonly guide?: readonly SidebarRightGuideEntry[]
}

/** Registration face provided by the official right-Sidebar plugin. */
export interface SidebarRightTabRegistry {
  register(definition: SidebarRightTabDefinition): () => void
}

/**
 * What one tab may do to the surface holding it.
 *
 * Automation consumes page navigation; `close` has no consumer here.
 */
export interface SidebarRightTabActions {
  openTab(kind: string, options?: {
    readonly params?: { readonly subscriptionId?: string; readonly runId?: string; readonly planId?: string }
  }): void
  /**
   * Open a resource in the Sidebar.
   * @param address - a `dsh-resource://` address.
   * @param options - placement; omitted opens a tab beside this one.
   */
  openResource(address: string, options?: { readonly replaceTab?: boolean }): void
}

/**
 * Live presentation facts the Devflow page reads from its tab occurrence.
 *
 * The original also carries `panel`, and its `tab` extends the docking kit's
 * `TabRecord` with `signal`. Navigation is restated for Automation crosslinks.
 */
export interface SidebarRightTabInfo {
  readonly sidebar: {
    readonly expanded: boolean
    readonly fullscreen: boolean
  }
  readonly tab: {
    readonly navigation: { readonly revision: number; readonly params: unknown }
    readonly visible: boolean
    readonly actions: SidebarRightTabActions
  }
}

/** Hook the official slot host supplies to every tab body. */
export type UseSidebarRightTabInfo = () => SidebarRightTabInfo

/** Slot-level hook factory declaration owned by the official right Sidebar. */
interface SidebarRightTabInjected {
  hooks: {
    tabInfo: SlotHookFactory<'sidebar.right.pane.tab', UseSidebarRightTabInfo>
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SessionStandardProps {
    /** Session whose right-Sidebar surface contains this tab. */
    sessionId: SessionId
  }

  interface SlotMap {
    /**
     * Key-dispatched tab bodies in the official right Sidebar.
     *
     * `hookContext` is the docking-kit-typed `TabHookContext` in the original,
     * and reaches only a slot hook factory. The board registers a body, never a
     * factory, so the context type never reaches this plugin's code and is left
     * unrestated.
     */
    'sidebar.right.pane.tab': {
      kind: 'keyed'
      scope: 'session'
      hookContext: unknown
      inject: SidebarRightTabInjected
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Official right-Sidebar tab-type registry. */
    sidebarRightTabs: SidebarRightTabRegistry
  }
}

/** Type-level assertion that the restated service is carried by a Cordis context. */
export type SidebarRightContext = Pick<Context, 'sidebarRightTabs'>
