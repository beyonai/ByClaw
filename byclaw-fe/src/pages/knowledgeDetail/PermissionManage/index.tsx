import InfiniteScrollTable from '@/components/InfiniteScrollTable';
import { grantType } from '@/constants/knowledgeCenter';
import useKnowledgeStore from '@/models/useKnowledgeStore';
import { Button } from 'antd';
import React, { ForwardedRef, forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import styles from './index.module.less';
// @ts-ignore
import { useIntl, useSearchParams } from '@umijs/max';
import classNames from 'classnames';

export interface PermissionManageRef {
  getPermissionList: (params: Record<string, any>) => void;
}

interface IProps {
  searchValue?: string;
  baseInfo: any;
}

const PermissionManage = (props: IProps, ref: ForwardedRef<PermissionManageRef>) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { searchValue = '', baseInfo } = props;

  const [searchParams] = useSearchParams();
  const objId = searchParams.get('objId');

  const intl = useIntl();

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { getPriviledgeList, priviledgeData, setState } = useKnowledgeStore();
  const { list = [], pagination } = priviledgeData;

  const getPermissionList = (params: Record<string, any>) => {
    getPriviledgeList({
      pageIndex: pagination.pageIndex,
      pageSize: pagination.pageSize,
      grantObjId: objId, // 知识库objId
      keyWord: searchValue, // 关键字搜索
      ...params,
    });
  };

  useEffect(() => {
    getPermissionList({
      pageIndex: pagination?.pageIndex ?? 1,
      pageSize: pagination?.pageSize ?? 12,
    });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      getPermissionList,
    }),
    [getPermissionList]
  );

  const columns = [
    {
      title: intl.formatMessage({ id: 'permissionManage.member' }),
      dataIndex: 'memberName',
      render: (text: string) => (
        <div className={styles.tableTitle}>
          <div className={styles.icon}>{text?.slice(text?.length - 2, text?.length)}</div>
          {text}
        </div>
      ),
    },
    {
      title: intl.formatMessage({ id: 'permissionManage.addedBy' }),
      dataIndex: 'createdBy',
    },
    {
      title: intl.formatMessage({ id: 'permissionManage.permission' }),
      dataIndex: 'grantType',
      width: 200,
      render: (v: string) => {
        return grantType.find((it) => it.value === v)?.label;
      },
    },
  ];
  return (
    <div className={classNames(styles.permissionManageContainer, 'full-width full-height')}>
      <div className={styles.title}>
        {intl.formatMessage({ id: 'permissionManage.company' })}
        <div />
      </div>
      <div className={styles.tableContainer}>
        <InfiniteScrollTable
          next={() => {
            getPermissionList({ pageIndex: pagination?.pageIndex + 1 });
          }}
          hasMore={list?.length < pagination?.total}
          columns={columns}
          dataSource={list}
          rowKey="privilegeGrantId"
          rowSelection={{
            type: 'checkbox',
            selectedRowKeys,
            onChange: (selectedRowKeys: React.Key[]) => {
              setSelectedRowKeys(selectedRowKeys);
            },
          }}
          scrollDivId="permissionManageTable"
        />
      </div>
      <div className={styles.footContainer}>
        {intl.formatMessage({ id: 'permissionManage.selectedCount' }, { count: selectedRowKeys.length })}
        <Button type="primary">{intl.formatMessage({ id: 'permissionManage.modifyPermission' })}</Button>
      </div>
    </div>
  );
};

export default forwardRef(PermissionManage);
