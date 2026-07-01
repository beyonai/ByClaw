import type { ReactNode } from 'react';
import type { FileBrowserItem } from '@/service/fileBrowser';

export interface FileTreeItem extends FileBrowserItem {
  key: string;
  title: ReactNode;
  isLeaf: boolean;
  className?: string;
  children?: FileTreeItem[];
}

export type FileCategoryKey = 'root' | 'session' | 'shared' | 'log';
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
}

export const ROOT_FILE_PATH = '/';
export const DISPLAY_FILE_PATH_PREFIX = '/by';
export const BYKC_FILE_PATH = '/.bykc/';
export const SESSION_FILE_PATH = '/.sessions/';
export const SHARED_FILE_PATH = '/.shared/';
export const LOG_FILE_PATH = '/.log/';
export const OPENCLAW_FILE_PATH = '/.openclaw/';
export const UIAGENT_FILE_PATH = '/.uiagent/';

export const PROTECTED_ROOT_DIRECTORY_PATHS = new Set([
  BYKC_FILE_PATH,
  LOG_FILE_PATH,
  OPENCLAW_FILE_PATH,
  SESSION_FILE_PATH,
  SHARED_FILE_PATH,
  UIAGENT_FILE_PATH,
]);
