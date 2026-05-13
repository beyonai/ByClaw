import React, { useState, useEffect } from 'react';
import { connect } from 'dva';
import { Tree, Input, Tooltip, Modal, Dropdown, message } from 'antd';
import { DeleteOutlined, EllipsisOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import styles from './index.module.less';

const { confirm, error } = Modal;

const PostTree = ({ dispatch, treeData, selectedPost, onSelect, setInfo, setShowInfo, setType, onRefresh }) => {
  const intl = useIntl();
  const [expandedKeys, setExpanedKeys] = useState(['default', 'position']);
  const [keyword, setKeyword] = useState('');
  const [isRefresh, setIsRefresh] = useState(false); // 是否刷新请求列表

  // 岗位删除
  const postDelete = () => {
    dispatch({
      type: 'postManage/postDelete',
      payload: {
        positionId: selectedPost,
      },
      success: () => {
        message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
        onRefresh({ keyword }, true);
      },
      fail: (res) => {
        error({
          title: intl.formatMessage({ id: 'postTree.deletePost' }),
          content: res?.msg,
        });
      },
    });
  };

  const dropdownItems = [
    {
      key: 'delete',
      label: (
        <div className={styles.deleteBtn}>
          <DeleteOutlined />
          <span style={{ marginLeft: 5 }}>{intl.formatMessage({ id: 'postTree.deletePost' })}</span>
        </div>
      ),
      danger: true,
    },
  ];

  const titleRender = (nodeData) => {
    const { noAction, positionName: title } = nodeData;

    return (
      <div className={styles.treeNode}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            columnGap: 2,
            alignItems: 'center',
          }}
        >
          <AntdIcon
            className={styles.iconTree}
            type={
              title === intl.formatMessage({ id: 'postManage.positions' }) ||
              title === intl.formatMessage({ id: 'postManage.default' })
                ? 'icon-a-Peoplesrenqun'
                : 'icon-a-Avatartouxiang'
            }
          />
          <div style={{ flex: 1, width: 0, height: 24 }}>
            <Tooltip title={title}>
              <span
                title=""
                style={{
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  display: 'inline-block',
                  width: '100%',
                  wordBreak: 'break-all',
                  color: '#14161a',
                }}
              >
                {title}
              </span>
            </Tooltip>
          </div>
          {!noAction && (
            <Dropdown
              overlayClassName={styles.dropdownWrap}
              menu={{
                items: dropdownItems,
                onClick: () => {
                  confirm({
                    title: intl.formatMessage({ id: 'postTree.deletePost' }),
                    content: intl.formatMessage({
                      id: 'postTree.deleteConfirm',
                    }),
                    onOk: () => {
                      postDelete();
                    },
                  });
                },
              }}
            >
              <div
                className={styles.actionIcon}
                style={{
                  visibility: nodeData.positionId === selectedPost && !nodeData.userId ? 'visible' : 'hidden',
                }}
              >
                <EllipsisOutlined />
              </div>
            </Dropdown>
          )}
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (isRefresh) {
      onRefresh({ keyword }, false);
      setIsRefresh(false);
    }
  }, [isRefresh]);

  return (
    <div className={styles.treeContainer}>
      <div className={styles.header}>
        <span className={styles.title}>{intl.formatMessage({ id: 'postTree.title' })}</span>
        <AntdIcon
          className={styles.iconAdd}
          type="icon-a-Plusjia"
          onClick={() => {
            setShowInfo(true);
            setType('add');
            setInfo({});
          }}
        />
      </div>
      <Input
        suffix={<AntdIcon type="icon-a-Searchsousuo" onClick={() => setIsRefresh(true)} />}
        placeholder={intl.formatMessage({ id: 'postTree.searchPlaceholder' })}
        onChange={(e) => setKeyword(e.target.value)}
        value={keyword}
        className={styles.searchInput}
        onPressEnter={() => {
          setIsRefresh(true);
        }}
      />
      <div style={{ flex: 1, overflow: 'auto', height: 0 }}>
        <Tree
          treeData={treeData}
          titleRender={titleRender}
          onSelect={(selectedKeys, e) => {
            if (selectedKeys?.[0]) {
              onSelect(selectedKeys[0], e);
            }
          }}
          fieldNames={{
            title: 'positionName',
            key: 'positionId',
            children: 'children',
          }}
          defaultExpandAll
          blockNode
          switcherIcon={<AntdIcon className={styles.iconSwitch} type="icon-a-Down-onexia1" />}
          selectedKeys={selectedPost ? [selectedPost] : []}
          expandedKeys={expandedKeys}
          onExpand={(keys) => {
            setExpanedKeys(keys);
          }}
        />
      </div>
    </div>
  );
};

export default connect()(PostTree);
