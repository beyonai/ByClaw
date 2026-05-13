// @ts-nocheck
import { getIntl } from '@umijs/max';

export const feedbackTypeMap = {
  praise: 'praise',
  tread: 'tread',
};

export const feedbackTypeOpts = [
  {
    label: getIntl().formatMessage({ id: 'conversationMgr.feedback.like' }),
    key: feedbackTypeMap.praise,
  },
  {
    label: getIntl().formatMessage({ id: 'conversationMgr.feedback.dislike' }),
    key: feedbackTypeMap.tread,
  },
];

export const isHandleStatus = [
  {
    text: getIntl().formatMessage({ id: 'conversationMgr.status.unhandled' }),
    value: 0,
    color: '#A4AAB2',
  },
  {
    text: getIntl().formatMessage({ id: 'conversationMgr.status.handled' }),
    value: 1,
    color: '#00B42A',
  },
];
