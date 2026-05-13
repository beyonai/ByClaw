import dayjs from 'dayjs';
import { get } from 'lodash';
// @ts-ignore
import { getIntl } from '@umijs/max';

import { SSEMessageType } from '@/constants/message';

export function getDisplayDateTime(dateTime: string | number) {
  const intl = getIntl();
  const createTimeDayjsObj = dayjs(Number(dateTime) ? Number(dateTime) : dateTime);
  const isSameDay = createTimeDayjsObj.isSame(dayjs(), 'day');
  const isSameYear = createTimeDayjsObj.isSame(dayjs(), 'year');

  if (isSameDay) {
    return createTimeDayjsObj.format('HH:mm');
  }
  if (!isSameYear) {
    return createTimeDayjsObj.format(intl.formatMessage({ id: 'notice.messageList.dateFormat.full' }));
  }
  return createTimeDayjsObj.format(intl.formatMessage({ id: 'notice.messageList.dateFormat.short' }));
}

function getContentTypeCfgMap() {
  const intl = getIntl();
  return {
    [`${[SSEMessageType.noticeTodo]}`]: {
      name: intl.formatMessage({ id: 'notice.messageList.type.todo' }),
      icon: 'icon-notification-bing',
      theme: '#FFB65D',
    },
    [`${[SSEMessageType.noticeShare]}`]: {
      name: intl.formatMessage({ id: 'notice.messageList.type.share' }),
      icon: 'icon-notification-bing',
      theme: '#6AA1FF',
    },
    [`${[SSEMessageType.noticeSmartOffice]}`]: {
      name: intl.formatMessage({ id: 'notice.messageList.type.smartOffice' }),
      icon: 'icon-notification-bing',
      theme: '#6AA1FF',
    },
    [`${[SSEMessageType.noticeApproval]}`]: {
      name: intl.formatMessage({ id: 'notice.messageList.type.approval' }),
      icon: 'icon-notification-bing',
      theme: '#6AA1FF',
    },
    [`${[SSEMessageType.noticeWelfare]}`]: {
      name: intl.formatMessage({ id: 'notice.messageList.type.welfare' }),
      icon: 'icon-notification-bing',
      theme: '#6AA1FF',
    },
    [`${[SSEMessageType.noticeTask]}`]: {
      name: intl.formatMessage({ id: 'notice.messageList.type.task' }),
      icon: 'icon-notification-bing',
      theme: '#6AA1FF',
    },
    default: {
      name: intl.formatMessage({ id: 'notice.messageList.type.default' }),
      icon: 'icon-notification-bing',
      theme: '#6AA1FF',
    },
  };
}

export function getNoticeName(contentTypeList: SSEMessageType[] = []) {
  const contentTypeCfgMap = getContentTypeCfgMap();
  const t =
    contentTypeList.find((ct) => {
      return get(contentTypeCfgMap, `${ct}`);
    }) || 'default';

  return get(contentTypeCfgMap, `${t}`);
}
