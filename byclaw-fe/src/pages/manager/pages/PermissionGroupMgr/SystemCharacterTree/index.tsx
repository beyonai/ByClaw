import React, { useState, useEffect } from 'react';
import { Tree, Tooltip, message } from 'antd';
import { head } from 'lodash';
import { useIntl, connect } from '@umijs/max';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import styles from './index.module.less';

const SystemCharacterTree = ({ dispatch, onLeafSelect }: { dispatch: any; onLeafSelect?: (info: any) => void }) => {
  const intl = useIntl();

  const [expandedKeys, setExpanedKeys] = useState<any[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<any[]>([]);

  const [defaultList, setDefaultList] = useState<any[]>([]); // 默认列表

  // 岗位列表查询
  const getPostList = () => {
    // 默认列表
    dispatch({
      type: 'postManage/getPostDefaultList',
      payload: {
        // orgId: 1,
        // pageIndex: 1,
        // pageSize: 1000,
        // keyword: payload?.keyword || '',
        // userType: 'ORD_USER',
        standType: 'USER_TYPE',
      },
      success: (res: { data?: any[] }) => {
        const { data } = res;
        const _default = (data || []).map((item: any) => ({
          ...item,
          positionName: item.standDisplayValue || item.paramName || item.paramDesc,
          positionId: `${item.id || item.paramId}${item.standCode || item.paramValue || item.paramEnName}`,
          positionDesc: item.standDesc,
          positionUserType: item.standCode || item.paramValue || item.paramEnName,
          noAction: true,
        }));
        setDefaultList(_default);

        onLeafSelect?.(head(_default));
        setSelectedKeys([head(_default)?.positionId]);
      },
      fail: (res: { msg: string }) => {
        message.warning(res?.msg);
      },
    });
  };

  const titleRender = (nodeData: { noAction: boolean; positionName: string; positionId: string }) => {
    const { positionName: title, positionId } = nodeData;

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
                  color: selectedKeys.includes(positionId) ? '#006cca' : '#475366',
                  fontWeight: selectedKeys.includes(positionId) ? 700 : 'unset',
                }}
              >
                {title}
              </span>
            </Tooltip>
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    getPostList();
  }, []);

  return (
    <div className={styles.treeContainer}>
      {/* <Input
        suffix={(
          <AntdIcon
            type="icon-a-Searchsousuo"
            onClick={() => {

            }}
          />
        )}
        placeholder={intl.formatMessage({ id: 'postTree.searchPlaceholder' })}
        onChange={e => setKeyword(e.target.value)}
        value={keyword}
        className={styles.searchInput}
        onPressEnter={() => {

        }}
      /> */}
      <div style={{ flex: 1, overflow: 'auto', height: 0 }}>
        <Tree
          treeData={defaultList}
          titleRender={titleRender}
          onSelect={(selectedKeys: any[]) => {
            const target = defaultList.find((item: any) => item.positionId === selectedKeys?.[0]);
            if (target) {
              onLeafSelect?.(target);
            }
            setSelectedKeys(selectedKeys);
          }}
          fieldNames={{
            title: 'positionName',
            key: 'positionId',
            children: 'children',
          }}
          defaultExpandAll
          blockNode
          switcherIcon={<AntdIcon className={styles.iconSwitch} type="icon-a-Down-onexia1" />}
          selectedKeys={selectedKeys}
          expandedKeys={expandedKeys}
          onExpand={(keys) => {
            setExpanedKeys(keys);
          }}
        />
      </div>
    </div>
  );
};

export default connect()(SystemCharacterTree);
