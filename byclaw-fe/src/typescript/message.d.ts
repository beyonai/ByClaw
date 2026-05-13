import {
  IMessageState,
  SSEEventStatus,
  SSEMessageType,
} from '@/constants/message';

import type { IAgentType } from '@/typescript/agent';
import type { IFile } from './file';
import { RichInputResourceList } from '@/components/QueryInput/RichInput';

// type IChatBI = {
//   analysisReport?: string
// }

type IResourceFromItem = any;
type IQueryCollectedState = 'collected' | 'uncollect' | 'changing';

export type IMessageListItem = {
  content: {
    substance: unknown;
    text?: string;
    parentOrderId?: string;
    orderId?: string;
    sourceAgentType?: string;
  };
  contentType: SSEMessageType;
  status: SSEEventStatus;
  objectType?: 'function_response' | 'tool_call'; // 'function_response'-工具类回答
  agentId?: string;
};

export type IResComIdsListItem = {
  content: {
    substance?: unknown;
    resComId: string
  };
  contentType: SSEMessageType;
  status: SSEEventStatus;
};

export type NewIMessageListItem = {
  messageIdx: number;
  children: NewIMessageListItem[];
  isCollapsed?: boolean;
  messageLoadingStatus?: number; // 1: 已完成, 2: 进行中
} & IMessageListItem;

type IThink = {
  thinkList?: IMessageListItem[]; // 思考过程
  thinkDone?: boolean;
  thinkCollapse?: boolean;
};

export type IExtParams = {
  extendsMsgItemList?: IMessageListItem[];
  [key in string]: unknown;
};

export type IFileList = {
  imageList?: IFile[];
  fileList?: IFile[];
  citeMsgList?: IMessage[];
};

export type IMessageStatus = {
  isHide?: boolean;
  shouldDelete?: boolean;
};

export type IResComIds = {
  resComIds?: Array<IResComIdsListItem>
}

export type ICollectInfo = {
  isCollected?: boolean;
  collectIds?: string[]; // "contentType_objectId"[]
}

export type IMessage = {
  creatorId: string,
  creatorName?: string,
  fromBeyond: boolean;
  fromOtherUser?: boolean;
  metadata?: string;

  text?: string; // markdown文本
  suggest?: string[]; // 推荐问题

  msgId: string;
  messageId?: string;
  queryMsgId?: string;
  answerMsgId?: string;
  messageList?: Array<IMessageListItem>; // 各类消息

  messageState: IMessageState;

  messageTip?: string; // error信息
  traceback?: string; // error详细信息
  metadata?: string;

  resourceFrom?: IResourceFromItem[];
  relatedQuestions?: string[];

  agentType?: IAgentType;
  agentId?: string;

  sessionId?: string;
  usage?: '1' | '2' | '3' | '4' | '5'; // 1-用户 2-大模型 3-追问、清楚上下文 4-转发消息 5-交互消息（建群、踢人等）
  msgStatus?: '0' | '1'; // 1:正在输入，0:已结束 

  extParams?: IExtParams;

  // 如果消息经过SSE更新了，这个updateKey就会更新。
  updateKey?: string;
  resComState?: boolean;

  // 富文本输入框，这次问题涉及到的资源列表
  resourceList?: RichInputResourceList;

  createTime: string;

  isHistoryMsg?: boolean;
  queryCollectedState?: IQueryCollectedState; // 设置为常用问题

  cancelSSE?: () => void;
} & IMessageStatus & IFileList & IThink & IResComIds & ICollectInfo;
