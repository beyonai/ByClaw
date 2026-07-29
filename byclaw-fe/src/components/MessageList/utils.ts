import dayjs from 'dayjs';
import { ResourceTypeMap } from '@/constants/resource';
import type { IState as useEmployeesIState } from '@/models/useEmployees';
import { agentMap } from '@/constants/agent';
import { IAgentType } from '@/typescript/agent';
import { getIntl } from '@umijs/max';
import type { IMessage } from '@/typescript/message';

export function getDisplayDateTime(dateTime: string | number) {
  const createTimeDayjsObj = dayjs(Number(dateTime) ? Number(dateTime) : dateTime);
  const isSameDay = createTimeDayjsObj.isSame(dayjs(), 'day');
  const isSameYear = createTimeDayjsObj.isSame(dayjs(), 'year');

  if (isSameDay) {
    return createTimeDayjsObj.format('HH:mm');
  }

  if (!isSameYear) {
    const formatStr = getIntl().formatMessage({ id: 'common.dateFormatFull' });
    return createTimeDayjsObj.format(formatStr);
  }
  const formatStr = getIntl().formatMessage({ id: 'common.dateFormatMDHm' });
  return createTimeDayjsObj.format(formatStr);
}

export function getResponseAgentInfo(
  agentDatas: Pick<useEmployeesIState, 'employeesList' | 'agentList'>,
  metadata?: string
) {
  if (!metadata) {
    return null;
  }
  const { agentList, employeesList } = agentDatas;
  try {
    let agentId: string | undefined;
    let isSuperAssistant = false;
    const metaObj = JSON.parse(metadata);
    const { resourceId, resourceType, agentId: agentIdInMetadata } = metaObj;
    if (agentIdInMetadata) {
      agentId = agentIdInMetadata;
    } else if (resourceId && resourceType === ResourceTypeMap.digitalEmployee) {
      agentId = resourceId;
    }
    isSuperAssistant = resourceType === ResourceTypeMap.superAssistant;

    if (!agentId) {
      return null;
    }
    let name: string | undefined;
    let resourceDesc: string | undefined;
    let agentType: string | undefined;
    let chatAvatar: string | undefined;
    let resourceCode: string | undefined;
    const defaultAgentInfo = agentList.find((item) => `${item.agentId}` === `${agentId}`);
    if (defaultAgentInfo) {
      ({ agentType, name, resourceDesc, resourceCode } = defaultAgentInfo);
      ({ chatAvatar } = agentMap[agentType as keyof typeof agentMap] as { chatAvatar: string });
    }
    if (!defaultAgentInfo) {
      const agentInfo = employeesList?.find(
        (item) => `${item.id}` === `${agentId}` || `${item.resourceCode}` === `${agentId}`
      );
      if (!agentInfo) {
        return null;
      }

      const { agentId: myAgentId } = agentInfo;
      if (agentId === resourceCode) {
        agentId = myAgentId;
      }

      ({ agentType, name, chatAvatar, resourceDesc, resourceCode } = agentInfo);
    }
    return {
      name,
      chatAvatar,
      agentId,
      resourceDesc,
      resourceCode,
      isSuperAssistant,
      agentType: agentType as IAgentType,
    };
  } catch (e) {
    return null;
  }
}

export type ResponseAgentInfo = NonNullable<ReturnType<typeof getResponseAgentInfo>>;

type MentionableAgentInfo = Partial<ResponseAgentInfo> & {
  agentId?: string;
  name?: string;
  resourceDesc?: string;
};

export function getResponseAgentInfoByMessage(
  agentDatas: Pick<useEmployeesIState, 'employeesList' | 'agentList'>,
  message?: Pick<IMessage, 'metadata' | 'agentId' | 'resourceList'> & {
    agentCode?: string;
    agentName?: string;
  }
) {
  const inlineDigitalEmployee = (message?.resourceList || []).find(
    (item) => `${item.resourceType}` === ResourceTypeMap.digitalEmployee
  );

  if (inlineDigitalEmployee) {
    const resourceAgentId = inlineDigitalEmployee.resourceId || inlineDigitalEmployee.resourceCode;
    if (resourceAgentId) {
      const agentInfo = getResponseAgentInfo(
        agentDatas,
        JSON.stringify({
          agentId: resourceAgentId,
        })
      );
      return {
        ...agentInfo,
        agentId: `${agentInfo?.agentId || resourceAgentId}`,
        name: inlineDigitalEmployee.resourceName || agentInfo?.name || `${resourceAgentId}`,
        chatAvatar: inlineDigitalEmployee.chatAvatar || agentInfo?.chatAvatar,
        resourceDesc: agentInfo?.resourceDesc || '',
        resourceCode: inlineDigitalEmployee.resourceCode || agentInfo?.resourceCode,
        isSuperAssistant: agentInfo?.isSuperAssistant || false,
        agentType: agentInfo?.agentType,
      };
    }
  }

  const messageAgentId = message?.agentId || message?.agentCode;
  if (messageAgentId) {
    const agentInfo = getResponseAgentInfo(
      agentDatas,
      JSON.stringify({
        agentId: messageAgentId,
      })
    );
    if (agentInfo) {
      return {
        ...agentInfo,
        name: message?.agentName || agentInfo.name,
      };
    }
  }

  return getResponseAgentInfo(agentDatas, message?.metadata);
}

export function getDigitalEmployeeMentionItem(agentInfo?: MentionableAgentInfo | null) {
  const agentId = agentInfo?.agentId;
  if (!agentId) return null;

  const name = agentInfo.name || agentInfo.resourceDesc || `${agentId}`;

  return {
    ...agentInfo,
    agentId: `${agentId}`,
    id: `${agentId}`,
    resourceId: `${agentId}`,
    resourceName: name,
    name,
  };
}
