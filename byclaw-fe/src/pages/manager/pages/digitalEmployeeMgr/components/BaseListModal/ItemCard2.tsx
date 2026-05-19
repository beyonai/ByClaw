// @ts-nocheck
/* eslint-disable no-nested-ternary */
import React, { useMemo, useRef, useState } from 'react';
import { Button, Divider, Tag } from 'antd';
import { connect, useIntl } from '@umijs/max';
import { useHover } from 'ahooks';
import dayjs from 'dayjs';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import classnames from 'classnames';
import styles from './index.module.less';
import { queryRelResourceInfo } from '@/pages/manager/service/DigitalEmployeeMgr';

import ObjectList from './ObjectList';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import Ellipsis from '@/pages/manager/components/Ellipsis';

export type IObject = {
  resourceId: string;
  systemCode: string;
  resourceSourcePkId: null;
  resourceBizType: 'OBJECT';
  resourceType: string;
  resourceName: string;
  resourceDesc: string;
  avatar: null;
  sample: null;
  tags: null;
  resourceVersionId: null;
  hostType: null;
  catalogId: number;
  manOrgId: null;
  manUserId: null;
  indexList: null;
  createBy: number;
  createTime: string; // "2025-12-10 11:32:25",
  updateBy: number;
  updateTime: string; // "2025-12-10 11:32:52",
  comAcctId: number;
  resourceStatus: number;
  resourceDVerid: null;
  resourceRVerid: null;
  resourceCode: null;
  publishTime: null;
  shelfTime: null;
  unshelfTime: null;
  authStatus: null;
  publishPortal: number;
  parentResourceId: string;

  checkedStatus?: boolean;
};

const OperBtn = (props: {
  isAdd: boolean;
  isSelected: boolean;
  handleSelect: (item: any) => void;
  handleRemove: (item: any) => void;
  getObjectList: () => Promise<IObject[]>;
  item: any;
}) => {
  const { isAdd, isSelected, handleSelect, handleRemove, item, getObjectList } = props;

  const intl = useIntl();

  const ref = useRef(null);
  const isHovering = useHover(ref);

  const [addLoading, setAddLoading] = useState(false);

  if (isSelected) {
    return (
      <Button
        className={classnames(styles.actionButton, {
          [styles.isAdd]: isAdd && !isHovering,
        })}
        danger={isHovering}
        ref={ref}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          handleRemove(item);
        }}
        size="small"
      >
        {isHovering ? intl.formatMessage({ id: 'itemCard.remove' }) : intl.formatMessage({ id: 'itemCard.added' })}
      </Button>
    );
  }
  return (
    <Button
      className={classnames(styles.actionButton, styles.notAdd)}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();

        setAddLoading(true);
        getObjectList()
          .then((newItem) => {
            handleSelect(newItem);
          })
          .finally(() => {
            setAddLoading(false);
          });
      }}
      loading={addLoading}
      size="small"
    >
      {intl.formatMessage({ id: 'common.add' })}
    </Button>
  );
};

const ItemCard = ({
  item,
  isSelected,
  isPlugin,
  isDataset,
  baseListOpt,
  handleSelect,
  handleRemove,
  onUpdateItem,
}: any) => {
  const intl = useIntl();

  const [expland, setExpland] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // 知识库、数据库的id区分
  const idKey = isDataset ? 'id' : 'baseId';

  const selectedIds = useMemo(() => baseListOpt.map((it) => it.pluginMachineId), [baseListOpt, idKey]);

  const avatarIconType = useMemo(
    () => (isDataset ? 'icon-chuangjianfangshi-wendangku' : 'icon-chajiantubiao'),
    [isDataset, isPlugin]
  );

  const getObjectList = React.useCallback(() => {
    if (Array.isArray(item.myRelResourceInfo)) {
      return Promise.resolve(item);
    }

    setIsLoading(true);
    return queryRelResourceInfo({
      resourceId: item.resourceId,
    })
      .then((res) => {
        const { code, data } = res;
        if (code === 0) {
          const myRelResourceInfo = (data || []).map((it) => ({
            ...it,
            checkedStatus: Array.isArray(item.activeResourceIds)
              ? item.activeResourceIds.includes(`${it.resourceId}`)
              : true,
          }));

          const newItem = {
            ...item,
            myRelResourceInfo,
          };
          onUpdateItem(newItem);
          return newItem;
        }
        return item;
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [item, onUpdateItem]);

  const onSwitchChange = React.useCallback(
    (checked: boolean, record: IObject) => {
      const targetItem = item.myRelResourceInfo?.find((it) => it.resourceId === record.resourceId);
      if (targetItem) {
        targetItem.checkedStatus = checked;
        onUpdateItem({
          ...item,
          myRelResourceInfo: [...item.myRelResourceInfo],
        });
      }
    },
    [item, onUpdateItem]
  );

  return (
    <div
      className={classnames(styles.cardItemWrap, {
        [styles.expand]: expland,
      })}
      style={{
        paddingBottom: expland ? '8px' : '0',
        marginBottom: expland ? '8px' : '0',
      }}
    >
      <div
        className={classnames(styles.cardItem, 'pointer')}
        onClick={() => {
          if (!expland && !isLoading) {
            getObjectList();
          }
          setExpland(!expland);
        }}
      >
        <AntdIcon type={avatarIconType} style={{ fontSize: '36px', marginRight: 12 }} />
        <div style={{ flex: 1 }}>
          <div className={styles.title}>
            {item.resourceName}
            {item.tags && JSON.parse(item.tags)?.map((it) => <Tag key={it}>{it}</Tag>)}
          </div>
          <div className={styles.desc} style={{ marginBottom: '8px' }}>
            <Ellipsis lines={1} tooltip>
              {item.description || intl.formatMessage({ id: 'itemCard.noDescription' })}
            </Ellipsis>
          </div>
          <div>
            <span>@{item.createUserName || '-'}</span>
            {item.createTime && (
              <span style={{ marginLeft: 12 }}>
                {intl.formatMessage({ id: 'itemCard.createdAt' })}{' '}
                {item.createTime ? dayjs(item.createTime).format('YYYY-MM-DD HH:mm') : null}
              </span>
            )}
          </div>
        </div>
        <div style={{ height: '28px', padding: '0 12px' }} className="ub ub-ac gap8">
          <OperBtn
            isAdd={selectedIds.includes(item.id)}
            isSelected={isSelected}
            handleSelect={handleSelect}
            handleRemove={handleRemove}
            item={item}
            getObjectList={getObjectList}
          />
          <div>{expland ? <UpOutlined /> : <DownOutlined />}</div>
        </div>
      </div>
      <div style={{ padding: '0 12px', maxHeight: '170px', overflow: 'auto', display: expland ? 'block' : 'none' }}>
        <ObjectList
          onSwitchChange={onSwitchChange}
          objectList={item.myRelResourceInfo}
          grantResourceType={item?.grantResourceType}
        />
      </div>
      {!expland && <Divider style={{ margin: '8px 0' }} />}
    </div>
  );
};

export default connect(({ employeeMgr }: any) => ({
  baseListOpt: employeeMgr.baseListOpt,
}))(ItemCard);
