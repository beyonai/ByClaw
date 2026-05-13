import { MentionElementType } from './elements/mention';
import getElementData from './utils/getElementData';

const agentCache = new Map<React.Key, MentionElementType>();

export function setAgentCache(data: ReturnType<typeof getElementData>) {
  if (data.agentId) {
    agentCache.set(data.agentId, data as MentionElementType);
  }
}

export function getAgentCache(agentId: React.Key) {
  return agentCache.get(agentId);
}

export default agentCache;
