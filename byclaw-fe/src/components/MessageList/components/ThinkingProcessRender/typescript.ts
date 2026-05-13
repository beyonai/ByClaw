import type { NewIMessageListItem } from '@/typescript/message';

export interface TreeNode extends NewIMessageListItem {
  [k: string]: any;
  isCollapsed: boolean;
  shouldOpen?: boolean;
}
