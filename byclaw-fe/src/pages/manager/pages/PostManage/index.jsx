// import React, { useEffect, useState } from 'react';
import React, { useState, useEffect } from 'react';
import { message } from 'antd';
import { connect } from 'dva';
import { useIntl } from '@umijs/max';
import { uniqBy } from 'lodash';
import { KeepAlive } from 'react-activation';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import PostTree from './components/PostTree';
import PostInfo from './components/PostInfo';
import PostInfoModal from './components/PostInfoModal';
import PostList from './components/PostList';
import styles from './index.module.less';

const PostManage = ({ dispatch }) => {
  const intl = useIntl();
  const [selectedPost, setSelectedPost] = useState(null); // 选择的岗位
  const [showInfo, setShowInfo] = useState(false); // 详情面板
  const [type, setType] = useState('add');
  const [info, setInfo] = useState({}); // 详细信息-详情面板
  const [infoLook, setInfoLook] = useState({}); // 详细信息-列表面板
  const [collapsed, setCollapsed] = useState(false);
  const [defaultList] = useState([]); // 默认列表
  const [postList, setPostList] = useState([]); // 岗位列表

  const treeData = React.useMemo(() => {
    return [
      {
        positionName: intl.formatMessage({ id: 'postManage.positions' }),
        positionId: 'position',
        children: postList,
        disabled: true,
      },
    ];
  }, [postList]);

  // 岗位列表查询
  const getPostList = (payload = {}, isDelete) => {
    // 默认列表
    // dispatch({
    //   type: 'postManage/getPostDefaultList',
    //   payload: {
    //     // orgId: 1,
    //     // pageIndex: 1,
    //     // pageSize: 1000,
    //     // keyword: payload?.keyword || '',
    //     // userType: 'ORD_USER',
    //     standType: 'USER_TYPE',
    //   },
    //   success: res => {
    //     const { data } = res;
    //     const _default = (data || []).map(item => ({
    //       ...item,
    //       positionName: item.standDisplayValue,
    //       positionId: `${item.id}${item.standCode}`,
    //       positionDesc: item.standDesc,
    //       positionUserType: item.standCode,
    //       noAction: true,
    //     }));
    //     setDefaultList(_default);
    //   },
    //   fail: res => {
    //     message.warning(res?.msg);
    //   },
    // });
    // 职务列表
    dispatch({
      type: 'postManage/getPostList',
      payload: {
        pageIndex: 1,
        pageSize: 999,
        ...payload,
      },
      success: (res) => {
        const { data: resData = {} } = res || {};
        const rows = resData.rows || resData.list || [];
        setPostList(uniqBy(rows, 'positionId'));
        if (!selectedPost || isDelete) {
          if (rows.length) {
            setSelectedPost(rows[0]?.positionId);
            setInfoLook(rows[0]);
          }
        }
      },
      fail: (res) => {
        message.warning(res?.msg);
      },
    });
  };

  useEffect(() => {
    getPostList();
  }, []);

  return (
    <div className={styles.container}>
      {!collapsed && (
        <PostTree
          treeData={treeData}
          selectedPost={selectedPost}
          onSelect={(val) => {
            // const node = treeData.find(item => item.orgId === val);
            setSelectedPost(val);
            const current = [...postList, ...defaultList].find((i) => i.positionId === val);
            setInfo(current);
            setInfoLook(current);
          }}
          setShowInfo={setShowInfo}
          setType={setType}
          setInfo={setInfo}
          onRefresh={(params, isDelete) => {
            getPostList(params, isDelete);
          }}
        />
      )}
      <div className={styles.content}>
        <div className={styles.trigger} onClick={() => setCollapsed(!collapsed)}>
          <div className={styles.triggerTop} />
          <div
            style={{
              background: '#e6ebf0',
              height: 50,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {collapsed ? <RightOutlined /> : <LeftOutlined />}
          </div>
          <div className={styles.triggerBottom} />
        </div>
        <div className={styles.infoContainer}>
          <div className={styles.organization}>
            <PostInfo info={infoLook} setShowInfo={setShowInfo} setType={setType} setInfo={setInfo} />
          </div>
          <div className={styles.member}>
            <PostList selectedPost={selectedPost} record={info} />
          </div>
        </div>
      </div>
      {showInfo && (
        <PostInfoModal
          visible={showInfo}
          type={type}
          info={info}
          setInfoLook={setInfoLook}
          onCancel={() => {
            setShowInfo(false);
          }}
          onOk={() => {
            setShowInfo(false);
            getPostList();
          }}
        />
      )}
    </div>
  );
};

const ConnectedPostManage = connect()(PostManage);

// 对外导出时增加 KeepAlive 缓存，类似 TodoList
export default () => {
  return (
    <KeepAlive
      cacheKey="PostManage"
      wrapperProps={{ style: { width: '100%', height: '100%' } }}
      contentProps={{ style: { width: '100%', height: '100%' } }}
      when={() => {
        // 当访问员工详情页时，缓存岗位管理页面
        return window.location.pathname.includes('/manager/resource/employeeDetail');
      }}
    >
      <ConnectedPostManage />
    </KeepAlive>
  );
};
