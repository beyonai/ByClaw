import React from 'react';
import { Badge } from 'antd';
import dayjs from 'dayjs';

type IntlLike = {
  formatMessage: (descriptor: { id: string }, values?: Record<string, unknown>) => string;
};

type CommonOption = {
  value: string | number | boolean;
  text: React.ReactNode;
  color?: string;
};

type ResourceRecord = Record<string, unknown>;

type BuildResourceCommonColumnsParams = {
  intl: IntlLike;
  activeTab?: string;
  ownerTypeMap?: CommonOption[];
  resourceStatus?: CommonOption[];
  getIconSrc?: (record: ResourceRecord, activeTab?: string) => string;
  showTypeColumn?: boolean;
  showAuthStatus?: boolean;
  authStatusWidth?: number;
  createTimeWidth?: number;
};

export function buildResourceCommonColumns(params: BuildResourceCommonColumnsParams) {
  const { intl, ownerTypeMap, resourceStatus } = params;
  const columns = [
    {
      title: intl.formatMessage({ id: 'form.name' }),
      dataIndex: 'resourceName',
      width: '200px',
      render: (v: React.ReactNode) =>
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', columnGap: 4, minWidth: 0 } },
          React.createElement(
            'span',
            {
              style: {
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            },
            v
          )
        ),
    },
    {
      title: intl.formatMessage({ id: 'form.desc' }),
      dataIndex: 'resourceDesc',
      width: 180,
    },
    {
      title: intl.formatMessage({ id: 'orgMgr.digital.ownerType' }),
      dataIndex: 'ownerType',
      width: 60,
      render: (text: CommonOption['value']) => {
        const ownerTypeItem = ownerTypeMap?.find((ele) => ele.value === text);
        if (!ownerTypeItem) return null;
        return ownerTypeItem.text;
      },
    },
    {
      title: intl.formatMessage({ id: 'orgMgr.digital.status' }),
      dataIndex: 'resourceStatus',
      width: 80,
      render: (text: CommonOption['value']) => {
        const statusItem = resourceStatus?.find((ele) => ele.value === text);
        if (!statusItem) return null;
        return React.createElement(Badge, { color: statusItem.color, text: statusItem.text });
      },
    },
    {
      title: intl.formatMessage({ id: 'orgMgr.digital.createUserName' }),
      dataIndex: 'createUserName',
      width: 120,
    },
    {
      title: intl.formatMessage({ id: 'orgMgr.digital.createTime' }),
      dataIndex: 'createTime',
      width: 120,
      render: (text: string | number) => (text ? dayjs(Number(text) || text).format('YYYY-MM-DD HH:mm') : '-'),
    },
  ];

  return columns;
}
