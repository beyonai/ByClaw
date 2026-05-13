import { Descendant, BaseEditor } from 'slate';
import { ReactEditor } from 'slate-react';
import { HistoryEditor } from 'slate-history';
import { IChatModeType } from '@/constants/query';
import { IAgentType } from '@/typescript/agent';
import { MentionElementType } from './elements/mention';
import { ResourceElementType } from './elements/resource';
import { EditableElementType } from './elements/editable';
import { ResourceType } from './utils/constants';

export type IResourceType = (typeof ResourceType)[keyof typeof ResourceType];

export type ParagraphElementType = {
  type: 'paragraph';
  children: Descendant[];
};

export type CustomElement = MentionElementType | ResourceElementType | EditableElementType | ParagraphElementType;

export type IEditor = BaseEditor & ReactEditor & HistoryEditor;

declare module 'slate' {
  interface CustomTypes {
    Editor: IEditor;
    Element: CustomElement;
  }
}

// 定义 Resource 类型，避免循环依赖
// 这个类型应该与 utils/index.ts 中 getNodeResourceData 的返回类型保持一致
export type Resource = {
  id: string;
  resourceType: IResourceType;
  resourceId: string;
  resourceName: string;
  resourceCode?: string;
  chatAvatar?: string;
};

export interface PayloadType {
  text: string;
  displayText: string;
  agentId?: string;
  agentType?: string;
  resourceList: Resource[];
}

export interface DefaultValueSchema {
  text?: string;
  resourceList?: Resource[];
}
export interface Props {
  inAgentRoute?: boolean;
  style?: React.CSSProperties;
  agentId?: string;
  agentType?: IAgentType;
  chatMode?: IChatModeType;
  onChange?: (payload: PayloadType) => void;
  onSend?: (payload: PayloadType) => void;
  isInputAtBottom?: boolean;
  defaultPlaceholder?: string;
  onPasteFiles?: (files: File[]) => void;
  canSend?: (payload: { text: string }) => boolean;
  canQuote: boolean;
  resourceAgentIds?: string;
}

export interface MentionTriggerInfo {
  type: '@' | '#';
  inputText: string;
  position: {
    left: number;
    top: number;
  };
}
