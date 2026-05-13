// @ts-nocheck
import React from 'react';
import { isNil } from 'lodash';
import { Table, Switch } from 'antd';

import type { IObject } from '../ItemCard2';

import type { ColumnsType } from 'antd/es/table';

export default function ObjectList({
  isReadOnly = false,
  objectList,
  onSwitchChange,
  grantResourceType,
}: {
  isReadOnly?: boolean;
  objectList?: IObject[];
  onSwitchChange: (checked: boolean, record: IObject) => void;
  grantResourceType: 'VIEW' | 'OBJECT';
}) {
  const columns: ColumnsType<IObject> = [
    {
      title: grantResourceType === 'VIEW' ? '对象名称' : '动作名称',
      dataIndex: 'resourceName',
      key: 'resourceName',
      align: 'center',
    },
    {
      title: grantResourceType === 'VIEW' ? '对象描述' : '动作描述',
      dataIndex: 'resourceDesc',
      key: 'resourceDesc',
      align: 'center',
    },
    {
      title: '状态',
      key: 'checkedStatus',
      align: 'center',
      render: (_, record) => {
        return (
          <Switch
            checked={!!record.checkedStatus}
            onChange={(checked: boolean) => onSwitchChange(checked, record)}
            disabled={!!isReadOnly}
          />
        );
      },
    },
  ];

  return <Table columns={columns} dataSource={objectList || []} pagination={false} loading={isNil(objectList)} />;
}
