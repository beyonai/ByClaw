// @ts-nocheck
import React, { useState, useMemo, useCallback } from 'react';

import { Divider, Tag } from 'antd';

import { dataItemTypeMap } from '@/pages/manager/components/PersonnelModel';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import styles from './index.module.less';

const AuthList = ({
  // 数据
  data,
  setData,
  // 页面显示属性
  titleRender,
  titleRowRender,
  btnRender,
  modelRender,
  onlyView = false,
}) => {
  const [visible, setVisible] = useState(false);

  const modelPorps = {
    value: data,
    onCancel: () => setVisible(false),
    onOk: (vals) => {
      setVisible(false);
      setData(vals);
    },
  };

  const { orgData, userData, postData, stationData } = useMemo(
    () => ({
      orgData: data?.filter((item) => item?.type === dataItemTypeMap.org),
      userData: data?.filter((item) => item?.type === dataItemTypeMap.user),
      postData: data?.filter((item) => item?.type === dataItemTypeMap.post),
      stationData: data?.filter((item) => item?.type === dataItemTypeMap.station),
    }),
    [data]
  );

  const itemRender = useCallback(
    (item) => {
      let itemIcon = 'icon-a-Useryonghu';
      switch (item.type) {
        case 'ORG':
          itemIcon = 'icon-a-Chart-graphguanxitu';
          break;
        case 'POST':
          itemIcon = 'icon-a-Addtianjia';
          break;
        case 'STATION':
          itemIcon = 'icon-a-Localyidingwei';
          break;
        default:
      }
      return (
        <Tag
          key={item.id}
          onClose={() => {
            setData((pre) => pre.filter((i) => item.id !== i.id));
          }}
          closable={!onlyView}
          icon={<AntdIcon type={itemIcon} style={{ fontSize: 14 }} />}
          className={styles.selectTag}
        >
          {item.name}
        </Tag>
      );
    },
    [onlyView, setData]
  );

  return (
    <div className={styles.Auth}>
      {titleRowRender?.(data?.length) || (
        <div className={styles.title}>
          <div className={styles.rect} />
          {titleRender}({data?.length})
        </div>
      )}
      <div className={styles.contentWrap}>
        {orgData?.length > 0 && (
          <>
            <div className={styles.content}>{orgData?.map((item) => itemRender(item))}</div>
            <Divider dashed />
          </>
        )}
        {userData?.length > 0 && (
          <>
            <div className={styles.content}>{userData?.map((item) => itemRender(item))}</div>
            <Divider dashed />
          </>
        )}
        {postData?.length > 0 && (
          <>
            <div className={styles.content}>{postData?.map((item) => itemRender(item))}</div>
            <Divider dashed />
          </>
        )}
        {stationData?.length > 0 && (
          <>
            <div className={styles.content}>{stationData?.map((item) => itemRender(item))}</div>
            <Divider dashed />
          </>
        )}
        {!onlyView && btnRender && (
          <div
            className={styles.btn}
            onClick={() => {
              setVisible(true);
            }}
          >
            <AntdIcon type="icon-a-People-plustianjiarenqun" style={{ fontSize: 16 }} />
            {btnRender}
          </div>
        )}
      </div>
      {visible && modelRender?.(modelPorps)}
    </div>
  );
};

export default AuthList;
