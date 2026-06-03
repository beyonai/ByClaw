import React from 'react';
import { Badge } from 'antd';
import dayjs from 'dayjs';

export function buildResourceCommonColumns({
  intl,
  activeTab,
  ownerTypeMap,
  resourceStatus,
  getIconSrc,
  showTypeColumn = false,
  showAuthStatus = false,
  authStatusWidth = 80,
  createTimeWidth = 120,
}) {
  const columns = [
    {
      title: intl.formatMessage({ id: 'form.name' }),
      dataIndex: 'resourceName',
      width: '200px',
      render: (v, record) => {
        const iconSrc = getIconSrc ? getIconSrc(record, activeTab) : '';
        return (
          <div style={{ display: 'flex', alignItems: 'center', columnGap: 4, minWidth: 0 }}>
            {/* {iconSrc ? <img src={iconSrc} style={{ width: 20, height: 20, marginRight: 4 }} alt="logo" /> : null} */}
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {v}
            </span>
          </div>
        );
      },
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
      render: (text) => {
        const ownerTypeItem = ownerTypeMap?.find((ele) => ele.value === text);
        if (!ownerTypeItem) return null;
        return ownerTypeItem.text;
      },
    },
  ];

  // if (showTypeColumn) {
  //   columns.push({
  //     title: intl.formatMessage({ id: 'orgMgr.table.type' }),
  //     dataIndex: 'resourceBizType',
  //     width: 80,
  //   });
  // }

  columns.push({
    title: intl.formatMessage({ id: 'orgMgr.digital.status' }),
    dataIndex: 'resourceStatus',
    width: 80,
    render: (text) => {
      const statusItem = resourceStatus?.find((ele) => ele.value === text);
      if (!statusItem) return null;
      return <Badge color={statusItem.color} text={statusItem.text} />;
    },
  });

  // if (showAuthStatus) {
  //   columns.push({
  //     title: intl.formatMessage({ id: 'orgMgr.table.authStatus' }),
  //     dataIndex: 'hasPermission',
  //     width: authStatusWidth,
  //     render: (val) => (
  //       <Badge
  //         color={val ? '#00b42a' : '#7a8799'}
  //         text={
  //           val
  //             ? intl.formatMessage({ id: 'orgMgr.table.hasPermission' })
  //             : intl.formatMessage({ id: 'orgMgr.table.noPermission' })
  //         }
  //       />
  //     ),
  //   });
  // }

  columns.push({
    title: intl.formatMessage({ id: 'orgMgr.digital.createTime' }),
    dataIndex: 'createTime',
    width: createTimeWidth,
    render: (text) => (text ? dayjs(Number(text) || text).format('YYYY-MM-DD HH:mm') : '-'),
  });

  return columns;
}
