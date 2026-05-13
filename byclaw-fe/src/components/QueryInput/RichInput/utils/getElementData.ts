import { ResourceType, ELEMENT_MENTION, ELEMENT_RESOURCE } from './constants';
import { agentTypeMap } from '@/constants/agent';
import { IResourceType } from '../types';

export function getElementDisplayText(params: {
  resourceType: IResourceType;
  data: { name: string; agentName?: string };
  isMarkdown?: boolean;
}) {
  const { resourceType, data, isMarkdown } = params;
  const safeHref = '""';
  if (
    resourceType === ResourceType.user ||
    resourceType === ResourceType.digitalEmployee ||
    resourceType === ResourceType.superAssistant
  ) {
    return isMarkdown ? `[@${data.name}](${safeHref}) ` : `@${data.name} `;
  }
  let { name } = data;
  if (data.agentName) {
    name = `${data.agentName}#${name}`;
  }
  return isMarkdown ? `[#${name}](${safeHref})` : `#${name}`;
}

export default function getElementData(type: IResourceType, data: any) {
  switch (type) {
    case ResourceType.user:
      return {
        userId: data.userId,
        name: data.userName,
        type: ELEMENT_MENTION,
        resourceType: type,
        children: [{ text: getElementDisplayText({ resourceType: type, data: { name: data.userName } }) }],
      };
    case ResourceType.superAssistant: {
      // 超级助手统一表达为真实 DIG_EMPLOYEE，避免再产生 HUMAN_ASSISTANT 这套历史资源类型。
      const superAssistantName = data.resourceName || data.name || `${data.userName}的超级助手`;
      const superAssistantAgentId = data.agentId || data.resourceId || data.defaultDigEmployeeId || data.userId;
      return {
        userId: data.userId,
        name: superAssistantName,
        type: ELEMENT_MENTION,
        resourceType: ResourceType.digitalEmployee,
        agentId: superAssistantAgentId,
        id: superAssistantAgentId,
        resourceId: superAssistantAgentId,
        resourceName: superAssistantName,
        resourceCode: data.resourceCode,
        chatAvatar: data.chatAvatar,
        agentType: data.agentType || agentTypeMap.agent,
        children: [
          {
            text: getElementDisplayText({
              resourceType: ResourceType.digitalEmployee,
              data: { name: superAssistantName },
            }),
          },
        ],
      };
    }
    case ResourceType.digitalEmployee:
      return {
        agentId: data.agentId || data.id || data.resourceCode,
        name: data.name,
        chatAvatar: data.chatAvatar,
        agentType: data.agentType,
        type: ELEMENT_MENTION,
        resourceType: type,
        children: [{ text: getElementDisplayText({ resourceType: type, data }) }],
      };
    case ResourceType.agentTool: {
      let name = data.resourceName;
      if (data.agentName) {
        name = `${data.agentName}#${data.resourceName}`;
      }
      return {
        name,
        isAgentTool: true,
        id: data.resourceId,
        agentId: data.agentId,
        agentName: data.agentName,
        agentType: data.agentType,
        type: ELEMENT_RESOURCE,
        chatAvatar: data.chatAvatar,
        resourceType: data.resourceBizType,
        resourceName: data.resourceName,
        resourceCode: data.resourceCode,
        children: [{ text: getElementDisplayText({ resourceType: type, data: { name, agentName: data.agentName } }) }],
      };
    }
    case ResourceType.knowledgeBase:
    case ResourceType.tool:
    case ResourceType.OBJECT:
    case ResourceType.folder:
    case ResourceType.file:
    case ResourceType.database: {
      let idKeyField = '';
      let nameKeyField = '';
      if (type === ResourceType.knowledgeBase || type === ResourceType.tool || type === ResourceType.OBJECT) {
        idKeyField = 'resourceId';
        nameKeyField = 'resourceName';
      } else if (type === ResourceType.folder || type === ResourceType.file) {
        idKeyField = 'id';
        nameKeyField = 'collectionName';
      } else if (type === ResourceType.database) {
        idKeyField = 'knowledgeBaseId';
        nameKeyField = 'knowledgeBaseName';
      }
      const name = data[nameKeyField || 'name'];
      let resourceType = type;
      // 工具 / 对象：用 resourceBizType 细分
      if (type === ResourceType.tool || type === ResourceType.OBJECT) {
        resourceType = data.resourceBizType;
      }
      return {
        name,
        resourceType,
        id: data[idKeyField || 'id'],
        type: ELEMENT_RESOURCE,
        resourceName: name,
        resourceCode: data.resourceCode,
        // 引用XXX
        children: [{ text: getElementDisplayText({ resourceType: type, data: { name } }) }],
      };
    }
    default:
      return {
        text: String(data),
      };
  }
}
