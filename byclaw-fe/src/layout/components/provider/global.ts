import React, { createContext } from 'react';
import { IAgentCache } from '@/typescript/agent';
import { EventEmitter$Cls } from '@/utils/eventEmitter';
import type { IAgentFileUploadConf } from '@/hooks/useAgentUploadFileConfig';

import { LayoutMode } from '@/constants/system';

export const Platform = {
  mobile: 'h5',
  pc: 'pc',
} as const;

export type IPlatform = (typeof Platform)[keyof typeof Platform];

export interface IGlobalContext {
  platform: IPlatform;
  sessionId: string;
  setSessionId?: React.Dispatch<React.SetStateAction<string>>;
  agentId: string;
  setAgentId?: React.Dispatch<React.SetStateAction<string>>;
  agentInfo?: IAgentCache;
  EventEmitter: EventEmitter$Cls;
  uploadFileConfig?: IAgentFileUploadConf;

  layoutMode?: (typeof LayoutMode)[keyof typeof LayoutMode];
}

const GlobalContext = createContext<IGlobalContext>({
  platform: Platform.pc,
  sessionId: '',
  agentId: '',
  layoutMode: LayoutMode.common,

  /**
   * EventEmitter不要设置初始值，我们需要保证用到的Provider由此至终都只有一个实例。
   * 如果在这里设置初始值（new EventEmitter$Cls()），那么实际上就有了两个实例
   * 这可能会导致某些监听事件失效，除非用到的所有函数组件useEffect都把EventEmitter传到deps中
   * 如果因为没有初始值导致的报错，那么就在开发阶段修复
   */
} as IGlobalContext);

export default GlobalContext;
