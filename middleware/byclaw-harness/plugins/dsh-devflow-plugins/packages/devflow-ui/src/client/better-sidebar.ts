/**
 * Optional compatibility boundary for deployments whose visible side panel is
 * provided by dsh-better-sidebar instead of the Harness right-Sidebar shell.
 *
 * The foundation is an ecosystem plugin, so Devflow deliberately imports none
 * of its runtime values. This local structural slice is the complete contract
 * used by the bridge below.
 */
import type { ComponentType, ReactNode } from 'react'

/** Cordis service name published by dsh-better-sidebar. */
export const BETTER_SIDEBAR = 'betterSidebar'

/** Session scope supplied to a Better Sidebar page. */
export interface BetterSidebarScope {
  readonly sessionId: string
}

/** Props supplied to one registered Better Sidebar page. */
export interface BetterSidebarTabProps {
  readonly scope: BetterSidebarScope
  readonly visible: boolean
}

/** Descriptor fields used by the Devflow compatibility page. */
export interface BetterSidebarTabDescriptor {
  readonly id: string
  readonly title: string | (() => string)
  readonly icon?: ReactNode | ((size: number) => ReactNode)
  readonly order?: number
  readonly single?: boolean
  readonly component: ComponentType<BetterSidebarTabProps>
}

/** Optional registry surface provided by dsh-better-sidebar. */
export interface BetterSidebarService {
  registerTab(descriptor: BetterSidebarTabDescriptor): () => void
}
