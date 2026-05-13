// @ts-nocheck
import { POST, GET } from '@/service/common/request';

const withCustomHandle = {
  responseCfg: {
    customHandle: true,
  },
};

export function handleFeedbackMsg(askMsgId: any) {
  return POST('/byaiService/system/message/handleFeedbackMsg', { askMsgId }, withCustomHandle);
}

export function messageFeedbackAssign(params: any) {
  return POST('/byaiService/operations/digEmployee/messageFeedbackAssign', params);
}

// 获取会话列表
export function getMessageList(params: any) {
  return POST('/byaiService/system/message/list', {
    ...params,
  });
}

// 获取来源渠道
export function getProject(params: any) {
  return GET('/byaiService/system/message/projectIdList', {
    ...params,
  });
}

// 获取来源终端
export function getAccessTerminal(params: any) {
  return GET('/byaiService/system/message/accessTerminalList', {
    ...params,
  });
}

// 获取反馈类型
export function getContentFeedbackType(params: any) {
  return GET('/byaiService/system/message/getContentFeedbackType', {
    ...params,
  });
}

// 获取超级助手列表
export function getSuassList(params: any) {
  return POST('/byaiService/system/message/getSuassList', {
    ...params,
  });
}

// 获取数字员工列表
export function getAgentList(params: any) {
  return POST('/byaiService/system/message/getAgentList', {
    ...params,
  });
}
