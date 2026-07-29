import type { ReactNode } from 'react';
import type { FileBrowserItem } from '@/service/fileBrowser';

export interface FileTreeItem extends FileBrowserItem {
  key: string;
  title: ReactNode;
  isLeaf: boolean;
  className?: string;
  children?: FileTreeItem[];
}

export type FileCategoryKey = 'root' | 'session' | 'shared' | 'project' | 'log';
export type FileCopyTargetType = 'session' | 'shared';
export type FileActionKey =
  | 'upload'
  | 'createFolder'
  | 'createSiblingFolder'
  | 'preview'
  | 'download'
  | 'rename'
  | 'delete'
  | 'saveToKnowledge'
  | 'saveToSessionFiles'
  | 'saveToSharedFiles';

export interface FileCategoryItem {
  key: FileCategoryKey;
  titleId: string;
  path: string;
  ensure?: boolean;
  adminVipOnly?: boolean;
  uploadUnderConstruction?: boolean;
}

export const ROOT_FILE_PATH = '/';
export const DISPLAY_FILE_PATH_PREFIX = '/by';
export const BYKC_FILE_PATH = '/.bykc/';
export const SESSION_FILE_PATH = '/.sessions/';
export const SHARED_FILE_PATH = '/.shared/';
export const PROJECT_FILE_PATH = '/.project/';
export const LOG_FILE_PATH = '/.log/';
export const OPENCLAW_FILE_PATH = '/.openclaw/';
export const UIAGENT_FILE_PATH = '/.uiagent/';

export const PROTECTED_ROOT_DIRECTORY_PATHS = new Set([
  BYKC_FILE_PATH,
  LOG_FILE_PATH,
  OPENCLAW_FILE_PATH,
  PROJECT_FILE_PATH,
  SESSION_FILE_PATH,
  SHARED_FILE_PATH,
  UIAGENT_FILE_PATH,
]);

export const FILE_CATEGORIES: FileCategoryItem[] = [
  {
    key: 'session',
    titleId: 'fileBrowser.category.session',
    path: SESSION_FILE_PATH,
    ensure: true,
  },
  {
    key: 'shared',
    titleId: 'fileBrowser.category.shared',
    path: SHARED_FILE_PATH,
    ensure: true,
  },
  {
    key: 'project',
    titleId: 'fileBrowser.category.project',
    path: PROJECT_FILE_PATH,
    ensure: true,
    uploadUnderConstruction: true,
  },
  {
    key: 'log',
    titleId: 'fileBrowser.category.log',
    path: LOG_FILE_PATH,
    ensure: true,
    adminVipOnly: true,
  },
  {
    key: 'root',
    titleId: 'fileBrowser.category.root',
    path: ROOT_FILE_PATH,
    adminVipOnly: true,
  },
];

export function getVisibleFileCategories(hasAdminVipPermission: boolean) {
  return FILE_CATEGORIES.filter((category) => hasAdminVipPermission || !category.adminVipOnly);
}
