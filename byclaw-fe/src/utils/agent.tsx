import { getLocale } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import { agentMap, agentTypeMap, specialAgentCode } from '@/constants/agent';
import { IAgent, IAgentCache } from '@/typescript/agent';
import { getPublicPath } from '@/utils';
import { isBase64, spliceOrigin, getFileUrl } from '@/utils/file';
import { get, trimStart, chain, concat, pick } from 'lodash';
import { getToken, getssoToken } from '@/utils/auth';
import { generateUniqueId } from '@/utils/math';
import type { IFile } from '@/typescript/file';
import React from 'react';

export const getDefaultAgentAvatar = () => {
  return 'beyond/logout.png';
};

export const getDefaultAssistantAvatar = () => {
  return 'beyond/logo256.svg';
};

export const getAgentAvatarUrl = (iconUrl: string) => {
  if (!iconUrl || iconUrl === 'default') {
    return `${getPublicPath()}${getDefaultAssistantAvatar()}`;
  }
  if (iconUrl.startsWith(getPublicPath())) {
    return iconUrl;
  }
  if (iconUrl.startsWith('beyond/')) {
    return `${getPublicPath()}${iconUrl}`;
  }
  if (iconUrl.startsWith('http')) {
    return iconUrl;
  }
  if (isBase64(iconUrl)) {
    return iconUrl;
  }

  let ossUrl = trimStart(iconUrl, '/');
  if (ossUrl.startsWith('byaiService')) {
    ossUrl = `/${ossUrl}`;
  } else {
    ossUrl = `/byaiService/${ossUrl}`;
  }

  return ossUrl;
};

export const getAvatarUrl = (url?: string) => {
  if (!url || url === 'default') return `${getPublicPath()}${getDefaultAssistantAvatar()}`;

  if (url.startsWith('http')) {
    return url;
  }

  if (url.startsWith('/')) {
    return `/byaiService${url}`;
  }

  return `${getPublicPath()}${url}`;
};

export function getAgentChatAvatar(iconUrl?: string, defaultIconUrl?: string, style?: React.CSSProperties) {
  let avatarUrl = defaultIconUrl || `${getPublicPath()}${getDefaultAgentAvatar()}`;

  if (iconUrl) {
    if (iconUrl.startsWith('icon-')) {
      return <AntdIcon type={iconUrl} />;
    }

    avatarUrl = getAgentAvatarUrl(iconUrl);
  }

  return (
    <img
      src={avatarUrl}
      alt="logo"
      style={{ width: '100%', height: '100%', borderRadius: '50%', ...(style || {}) }}
      onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
        if (e.target instanceof HTMLImageElement) {
          e.target.src = defaultIconUrl || `${getPublicPath()}${getDefaultAgentAvatar()}`;
        }
      }}
    />
  );
}

export function agentHandler(item: IAgent) {
  const { agentType, avatar, resourceCode, id } = item;

  let myAvatar = getDefaultAgentAvatar();
  if (avatar && avatar !== 'default') {
    myAvatar = avatar;
  }

  let myAgentType = agentType;

  if (!myAgentType || [agentTypeMap.mcpAgent, agentTypeMap.dbAgent].includes(myAgentType as any)) {
    myAgentType = agentTypeMap.agent;
  }

  switch (resourceCode) {
    case specialAgentCode.searchAndQuery:
      myAgentType = agentTypeMap.searchAndQuery;
      break;
    case specialAgentCode.functionCloud:
      myAgentType = agentTypeMap.functionCloud;
      break;
    case specialAgentCode.dataCloud:
      myAgentType = agentTypeMap.dataCloud;
      break;
    default:
      break;
  }

  if (item.agentDevType?.toLowerCase() === 'openclaw') {
    myAgentType = agentTypeMap.openclaw;
  }

  return {
    ...item,
    name: item.resourceName || item.name || '',
    agentType: myAgentType,
    agentId: `${id || resourceCode || ''}`,

    chatAvatar: myAvatar,
    category: 'all',

    ...get(agentMap, myAgentType, {}),
  };
}

export function isSandboxAgent(agent?: IAgent) {
  return agent?.createType === 'FROM_SANDBOX';
}

export const getAgentPath = (agentInfo: IAgentCache) => {
  const { agentType, integrationType } = agentInfo;

  if (isSandboxAgent(agentInfo)) {
    return '/sandbox';
  }

  const item = get(agentMap, `${agentType}`);

  // 有些场景如果不升级chatbi 2.4.9以上的话，会存在integrationType不为PAGE的情况，需要跳转到/chatBI
  if ([agentTypeMap.chatbi, agentTypeMap.writer].includes(agentType as any)) {
    if (integrationType === 'PAGE') {
      return item?.path;
    }
    return item?.customPath || item?.path;
  }

  if (item?.path && item?.path !== get(agentMap, `${agentTypeMap.agent}.path`)) {
    return item.path;
  }

  return get(agentMap, `${agentTypeMap.agent}.path`);
};

export const getWriterEditorUrl = (props: any) => {
  const { sessionId, docId, templateId, messageId, generateType = 'edit' } = props;

  const url = new URL(`${window.location.origin}/aiwrite/write`);
  const { searchParams } = url;
  searchParams.append('pageSource', 'beyond');
  searchParams.append('generateType', generateType);

  searchParams.append('docId', `${docId || ''}`);
  searchParams.append('templateId', `${templateId || ''}`);
  searchParams.append('messageId', `${messageId || ''}`);
  searchParams.append('sessionId', `${sessionId || ''}`);

  searchParams.append('language', `${getLocale()}`);

  return url.toString();
};

export const getWriterPPTUrl = (props: any) => {
  const { sessionId, pptId, templateId, messageId, generateType = 'edit' } = props;

  const url = new URL(`${window.location.origin}/aiwrite/pptWrite`);
  const { searchParams } = url;
  searchParams.append('pageSource', 'beyond');
  searchParams.append('generateType', generateType);

  searchParams.append('pptId', `${pptId || ''}`);
  searchParams.append('templateId', `${templateId || ''}`);
  searchParams.append('messageId', `${messageId || ''}`);
  searchParams.append('sessionId', `${sessionId || ''}`);

  searchParams.append('language', `${getLocale()}`);

  return url.toString();
};

export const getWriterMaterialUrl = (props: any) => {
  const { outlineId, docId, searchEnabled = false, title = '我的素材' } = props;

  const url = new URL(`${window.location.origin}/aiwrite/outlineMaterialIframe`);
  const { searchParams } = url;
  searchParams.append('pageSource', 'beyond');
  searchParams.append('outlineId', outlineId);
  searchParams.append('searchEnabled', searchEnabled);
  searchParams.append('docId', docId);

  searchParams.append('title', title);

  searchParams.append('language', `${getLocale()}`);

  return url.toString();
};

export const canJumpAgent = (agent: IAgent) => {
  if (agent?.grantType) return true;

  if (!!agent?.agentHomeUrl) {
    return false;
  }
  return true;
};

export const agentHomeUrlHandler = (
  agent: Pick<IAgentCache, 'agentHomeUrl' | 'id' | 'resourceCode'>,
  sessionId?: string,
  nextSessionIFileCache?: IFile[]
) => {
  const { agentHomeUrl, id, resourceCode } = agent || {};

  if (!agentHomeUrl) return '';

  try {
    const myUrl = chain(agentHomeUrl)
      .replace('{beyond-token}', getToken())
      .replace('{sso-token}', getssoToken())
      .value();

    const protocolRegex = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;
    let urlWithProtocol = myUrl;
    if (!protocolRegex.test(myUrl)) {
      urlWithProtocol = `http://${myUrl}`;
    }

    const srcObj = new URL(urlWithProtocol);

    if (!agentHomeUrl.includes('{beyond-token}')) {
      srcObj.searchParams.append('beyondtoken', getToken());
    }

    const uniqueId = generateUniqueId();

    const files: Array<{
      fileId: number;
      fileName: string;
      fileType: string;
      fileUrl: string;
    }> = [];
    concat([], nextSessionIFileCache || []).forEach((item) => {
      if (item.queryFile) {
        files.push({
          ...(pick(item.queryFile, ['fileId', 'fileName', 'fileType']) as {
            fileId: number;
            fileName: string;
            fileType: string;
          }),
          fileUrl: spliceOrigin(getFileUrl(item?.queryFile?.fileUrl || '')),
        });
      }
    });

    srcObj.searchParams.append('uuid', uniqueId);
    srcObj.searchParams.append('objectId', `${id}`);
    srcObj.searchParams.append('resourceCode', resourceCode || '');
    srcObj.searchParams.append('sessionId', `${sessionId}`);
    srcObj.searchParams.append('files', btoa(encodeURIComponent(JSON.stringify(files))));
    srcObj.searchParams.append('language', `${getLocale()}`);

    return srcObj.toString();
  } catch (e) {
    console.error('agentHomeUrlHandler error', agentHomeUrl, e);
    return '';
  }
};
