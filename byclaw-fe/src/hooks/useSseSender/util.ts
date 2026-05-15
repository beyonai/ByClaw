import { get, isPlainObject, set, isString } from 'lodash';

import { formatSSEDate as formatAgentSSEDate } from './agent/util';
import { isTextContentType } from '@/utils/messgae';

import { SSEEventStatus, SSEMessageType } from '@/constants/message';
import type { IMessageListItem, IResComIdsListItem } from '@/typescript/message';
import { isJSON } from '@/utils/json';

const textHandler = (sseDataObj: any, msgEvent?: string) => {
  const content = get(sseDataObj, 'choices.0.delta.content', '');

  let substance = content;
  try {
    if (!isString(substance)) {
      substance = JSON.stringify(substance);
    }
  } catch (e) {
    console.error(e);
  }

  const payload = {
    message: {
      contentType: sseDataObj.contentType || SSEMessageType.text,
      content: {
        substance,
      },
    },
  };

  const orderId = get(sseDataObj, 'orderId') || '';
  const parentOrderId = get(sseDataObj, 'parentOrderId') || '';

  if (orderId) {
    set(payload, 'message.content.orderId', `${orderId}`);
  }
  if (parentOrderId) {
    set(payload, 'message.content.parentOrderId', `${parentOrderId}`);
  }

  switch (msgEvent) {
    case 'answerStart':
      set(payload, 'message.status', SSEEventStatus.start);
      break;
    case 'answerDelta':
      set(payload, 'message.status', SSEEventStatus.query);
      break;
    case 'answerEnd':
      set(payload, 'message.status', SSEEventStatus.done);
      break;
    default:
      set(payload, 'message.status', SSEEventStatus.done);
      break;
  }

  return payload;
};

const formHandler = (sseDataObj: any) => {
  const content = get(sseDataObj, 'choices.0.delta.content', '');
  const stepId = get(sseDataObj, 'stepId');
  return {
    message: {
      contentType: SSEMessageType.form,
      content: formatAgentSSEDate(content, stepId),
      status: SSEEventStatus.done,
    },
  };
};

const thinkTaskUserInputHandler = (sseDataObj: any) => {
  const contentType = get(sseDataObj, 'contentType');
  const content = get(sseDataObj, 'choices.0.delta.content', '');
  let substance: unknown = content;
  try {
    substance = JSON.parse(content);
  } catch (e) {
    // 忽略解析错误，substance 保持为默认值
  }
  // stepId 可能在 SSE 根上，也可能在表单 JSON 内
  const stepId =
    get(sseDataObj, 'stepId') ??
    (isPlainObject(substance) ? get(substance, 'stepId') : undefined) ??
    (isPlainObject(substance) ? get(substance, 'taskStepId') : undefined);

  const sourceAgentType = get(sseDataObj, 'sourceAgentType');

  return {
    message: {
      contentType,
      content: { substance, stepId, sourceAgentType },
      status: SSEEventStatus.done,
    },
  };
};

const approvalFormHandler = (sseDataObj: any) => {
  const content = get(sseDataObj, 'choices.0.delta.content', '');

  return {
    message: {
      contentType: SSEMessageType.approvalForm,
      content: formatAgentSSEDate(content),
      status: SSEEventStatus.done,
    },
  };
};

const botHandler = (sseDataObj: any) => {
  const contentType = get(sseDataObj, 'contentType');
  const stepId = get(sseDataObj, 'stepId');
  const content = get(sseDataObj, 'choices.0.delta.content', '');
  const taskId = get(sseDataObj, 'taskId');
  let substance = content;
  try {
    substance = JSON.parse(content);
  } catch (e) {
    // 忽略解析错误，substance 保持为默认值
  }

  return {
    message: {
      contentType,
      content: { substance, stepId, stepTaskId: taskId },
      status: SSEEventStatus.done,
    },
  };
};

const thinkRewriteQuestionHandler = (sseDataObj: any) => {
  const contentType = get(sseDataObj, 'contentType');
  const metadata = get(sseDataObj, 'metadata');
  const sourceAgentType = get(sseDataObj, 'agentId');

  const content = get(sseDataObj, 'choices.0.delta.content', '');

  let substance = content;
  try {
    substance = JSON.parse(content);
  } catch (e) {
    // 忽略解析错误，substance 保持为默认值
  }

  return {
    message: {
      contentType,
      content: { substance, metadata, sourceAgentType },
      status: SSEEventStatus.done,
    },
  };
};

const sseTypeHandler = (sseDataObj: any) => {
  const contentType = get(sseDataObj, 'contentType');
  const content = get(sseDataObj, 'choices.0.delta.content', '');

  const sourceAgentType = get(sseDataObj, 'sourceAgentType');

  let substance = content;
  try {
    substance = JSON.parse(content);
  } catch (e) {
    // 忽略解析错误，substance 保持为默认值
  }

  return {
    message: {
      contentType,
      content: {
        substance,
        sourceAgentType,
        orderId: `${get(sseDataObj, 'orderId') || ''}`,
        parentOrderId: `${get(sseDataObj, 'parentOrderId') || ''}`,
      },
      status: SSEEventStatus.done,
    },
  };
};

function jsonBlockHandler(sseDataObj: any) {
  const contentType = get(sseDataObj, 'contentType');
  const content = get(sseDataObj, 'choices.0.delta.content', '');

  let substance = content;
  try {
    substance = JSON.parse(content);
  } catch (e) {
    // 忽略解析错误，substance 保持为默认值
  }

  return {
    message: {
      contentType,
      content: { substance },
    },
  };
}

function thinkStatusTitleHandler(sseDataObj: any) {
  const contentType = get(sseDataObj, 'contentType');
  const title = get(sseDataObj, 'choices.0.delta.content', '');
  const { status } = sseDataObj;

  const payload = {
    message: {
      contentType,
      content: {
        substance: {
          title,
          status,
        },
      },
    },
  };

  const orderId = get(sseDataObj, 'orderId') || '';
  const parentOrderId = get(sseDataObj, 'parentOrderId') || '';

  if (orderId) {
    set(payload, 'message.content.orderId', `${orderId}`);
  }
  if (parentOrderId) {
    set(payload, 'message.content.parentOrderId', `${parentOrderId}`);
  }

  return payload;
}

// eslint-disable-next-line
const sseTypeHandlerMap = new Map<string, (sseDataObj: any, msgEvent?: string) => any>([
  [`${SSEMessageType.text}`, textHandler],
  [`${SSEMessageType.thinkText}`, textHandler],
  [`${SSEMessageType.form}`, formHandler],
  [`${SSEMessageType.approvalForm}`, approvalFormHandler],
  [`${SSEMessageType.botCard}`, botHandler],
  [`${SSEMessageType.thinkTaskUserInput}`, thinkTaskUserInputHandler],
  [`${SSEMessageType.application}`, thinkTaskUserInputHandler],
  [`${SSEMessageType.slientHandler}`, thinkTaskUserInputHandler],
  [`${SSEMessageType.thinkRewriteQuestion}`, thinkRewriteQuestionHandler],
  [`${SSEMessageType.jsonBlock}`, jsonBlockHandler],
  [`${SSEMessageType.thinkStatusTitle}`, thinkStatusTitleHandler],
]);

export const answerDeltaHandler = (sseDataObj: any, msgEvent?: string): { message?: Partial<IMessageListItem> } => {
  const contentType = get(sseDataObj, 'contentType');
  if (!contentType) {
    return {};
  }

  const handler = sseTypeHandlerMap.get(`${contentType}`) || sseTypeHandler;

  const res = handler?.(sseDataObj, msgEvent);

  Object.assign(res.message, {
    objectType: get(sseDataObj, 'objectType'),
    agentId: get(sseDataObj, 'agentId'),
  });

  return res;
};

export const reasoningLogHandler = (sseDataObj: any, msgEvent?: string) => {
  const mySseDataObj = { ...sseDataObj };

  const contentType = get(mySseDataObj, 'contentType');
  if (!contentType) {
    return {};
  }

  if (`${contentType}` === `${SSEMessageType.text}`) {
    set(mySseDataObj, 'contentType', `${SSEMessageType.thinkText}`);
  }

  const payload = answerDeltaHandler(mySseDataObj);

  switch (msgEvent) {
    case 'reasoningLogStart':
      set(payload, 'message.status', SSEEventStatus.start);
      break;
    case 'reasoningLogDelta':
      set(payload, 'message.status', SSEEventStatus.query);
      break;
    case 'reasoningLogEnd':
      set(payload, 'message.status', SSEEventStatus.done);
      break;
    default:
      set(payload, 'message.status', SSEEventStatus.done);
      break;
  }

  let isDone = false;
  // 特殊处理json
  if (isTextContentType(contentType)) {
    const content = get(mySseDataObj, 'choices.0.delta.content', '');
    isDone = isJSON(content);
  }

  if (isDone) {
    set(payload, 'message.status', SSEEventStatus.done);
  }

  return payload;
};

export const resComIdsHandler = (resComId: string, contentType: SSEMessageType): IResComIdsListItem | null => {
  if (!resComId || !contentType) return null;

  return {
    contentType,
    content: { resComId },
    status: SSEEventStatus.done,
  };
};
