// @ts-nocheck
import React, { useEffect } from 'react';
import { Modal, Spin } from 'antd';
import { useIntl } from '@umijs/max';

import ObjectList from '../../../components/BaseListModal/ObjectList';
import { queryRelResourceInfo } from '@/pages/manager/service/DigitalEmployeeMgr';

import type { IObject } from '../../../components/BaseListModal/ItemCard2';

const RelResourceInfoModal = ({
  item,
  open,
  isReadOnly = true,
  onClose,
  onOk,
}: {
  item: any;
  open: boolean;
  isReadOnly?: boolean;
  onClose: () => void;
  onOk: (item: any) => void;
}) => {
  const [myObjectList, setMyObjectList] = React.useState<IObject[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  const onSwitchChange = React.useCallback(
    (checked: boolean, record: IObject) => {
      setMyObjectList((prev) => {
        const targetItem = prev?.find((it) => it.resourceId === record.resourceId);
        if (targetItem) {
          targetItem.checkedStatus = checked;

          return [...prev];
        }

        return prev;
      });
    },
    [item]
  );

  const getObjectList = React.useCallback(() => {
    if (!item?.resourceId) return Promise.reject(item);
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
            checkedStatus: (item?.activeResourceIds || []).includes(`${it.resourceId}`),
          }));

          const newItem = {
            ...item,
            myRelResourceInfo,
          };

          return newItem;
        }
        return item;
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [item]);

  useEffect(() => {
    getObjectList().then((newItem) => {
      onOk(newItem);
      setMyObjectList(newItem.myRelResourceInfo);
    });
  }, [getObjectList]);

  const intl = useIntl();
  return (
    <Modal
      centered
      destroyOnHidden
      open={open}
      onCancel={onClose}
      title={intl.formatMessage({ id: 'employeeDetail.relatedResourceInfo' })}
      width={800}
      onOk={() => {
        onOk({
          ...item,
          myRelResourceInfo: myObjectList,
        });
        onClose();
      }}
      footer={isReadOnly ? null : undefined}
    >
      <Spin spinning={isLoading}>
        <ObjectList
          isReadOnly={isReadOnly}
          objectList={myObjectList}
          onSwitchChange={onSwitchChange}
          grantResourceType={item?.grantResourceType}
        />
      </Spin>
    </Modal>
  );
};

export default RelResourceInfoModal;
