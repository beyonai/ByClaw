import { IMessage } from '@/typescript/message';
import { ISession } from '@/typescript/session';
import { createContext } from 'react';

export interface IGlobalContext {
  getMessageList: () => IMessage[];
  totalMesageListSize: number;
  currentSession: null | ISession;
}

const ChatLayoutCompContext = createContext<IGlobalContext>({
  getMessageList: () => [],
  totalMesageListSize: 0,
  currentSession: null,
});

export default ChatLayoutCompContext;
