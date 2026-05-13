import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Tree, Input, Button, Checkbox, Dropdown, Modal, message } from 'antd';
import { DeleteOutlined, EllipsisOutlined } from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import { useIntl, useDispatch } from '@umijs/max';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import { arrayToTree } from '@/pages/manager/utils/managerUtils';
import styles from './index.module.less';

type OrgFlat = {
  orgId: number;
  orgName: string;
  parentOrgId: number;
  orgIndex?: number;
  isLeaf?: boolean;
};

type Props = {
  treeData: any;
  selectedOrg: OrgFlat | null;
  setSelectedOrg: (org: OrgFlat) => void;
  onSelect: (orgId: number) => void;
  canEdit: boolean;
  setVisible: (v: boolean) => void;
  setType: (t: string) => void;
  setInfo: (info: Record<string, unknown>) => void;
  getTree: () => void;
  setTreeData: (data: OrgFlat[]) => void;
  setSearchValue: (v: string) => void;
  onChange: (e: { target: { checked: boolean } }) => void;
};

function mapToDataNodes(nodes: any[]): DataNode[] {
  return (nodes || []).map((n) => ({
    key: String(n.orgId),
    title: n.orgName,
    data: n,
    children: n.children?.length ? mapToDataNodes(n.children) : undefined,
  }));
}

const OrganizationTree: React.FC<Props> = ({
  treeData,
  selectedOrg,
  onSelect,
  canEdit,
  setVisible,
  setType,
  setInfo,
  setSearchValue,
  onChange,
  setTreeData,
  setSelectedOrg,
}) => {
  const dispatch = useDispatch();
  const intl = useIntl();
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);

  const treeNodes = useMemo(() => {
    const tree = arrayToTree(treeData || [], { sortKey: 'orgIndex' });
    return mapToDataNodes(tree);
  }, [treeData]);

  useEffect(() => {
    const rootKeys = treeNodes.map((n) => n.key);
    setExpandedKeys(rootKeys);
  }, [treeNodes]);

  const handleSelect = useCallback(
    (_keys: React.Key[], info: any) => {
      const key = info?.node?.key;
      if (key !== null && key !== undefined) onSelect(Number(key));
    },
    [onSelect]
  );

  const handleExpand = useCallback((expanded: React.Key[]) => {
    setExpandedKeys(expanded);
  }, []);

  // 处理确认操作
  const handleConfirm = () => {
    dispatch({
      type: 'orgMgr/delOrg',
      payload: {
        orgId: selectedOrg?.orgId,
      },
      success: () => {
        message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
        setTreeData(treeData.filter((item: any) => item.orgId !== selectedOrg?.orgId));
        setSelectedOrg?.(
          treeData
            ?.filter((item: any) => item.orgId !== selectedOrg?.orgId)
            ?.find((item: any) => item.parentOrgId === -1) || null
        );
      },
      fail: (res: any) => {
        message.error(`${intl.formatMessage({ id: 'orgTree.deleteOrg' })}: ${res.msg}`);
      },
    });
  };

  const dropdownItems = [
    {
      key: 'delete',
      label: (
        <div className={styles.deleteBtn}>
          <DeleteOutlined /> {intl.formatMessage({ id: 'orgTree.deleteOrg' })}
        </div>
      ),
    },
  ];

  const titleRender = useCallback(
    (node: any) => {
      const isActive = String(selectedOrg?.orgId) === String(node.key);
      return (
        <div className={isActive ? styles.nodeActive : styles.node}>
          <div className={styles.nodeMain}>
            <AntdIcon type="icon-zuzhitubiao" className={styles.nodeIcon} />
            <span className={isActive ? styles.nodeTextActive : styles.nodeText}>{node.title}</span>
          </div>
          {isActive && (
            <Dropdown
              menu={{
                items: dropdownItems,
                onClick: ({ key }) => {
                  if (key === 'delete') {
                    Modal.confirm({
                      title: intl.formatMessage({ id: 'orgTree.deleteOrg' }),
                      content: intl.formatMessage({
                        id: 'orgTree.deleteConfirm',
                      }),
                      onOk: () => {
                        handleConfirm();
                      },
                    });
                  } else if (key === 'dataPermission') {
                    // TODO: 处理数据权限设置逻辑
                    console.log('数据权限设置', selectedOrg);
                  }
                },
              }}
            >
              <div
                className={styles.actionIcon}
                style={{
                  visibility: String(node.key) === String(selectedOrg?.orgId) ? 'visible' : 'hidden',
                }}
              >
                <EllipsisOutlined />
              </div>
            </Dropdown>
          )}
        </div>
      );
    },
    [selectedOrg?.orgId]
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.title}>{intl.formatMessage({ id: 'orgTree.title' })}</div>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          {canEdit && (
            <Button
              size="small"
              className={styles.addBtn}
              onClick={() => {
                setVisible(true);
                setType('add');
                setInfo(
                  selectedOrg?.orgId !== null && selectedOrg?.orgId !== undefined
                    ? { parentOrgId: selectedOrg.orgId }
                    : { parentOrgId: -1 }
                );
              }}
            >
              <AntdIcon type="icon-a-Plusjia" />
              {intl.formatMessage({ id: 'orgTree.createDept' })}
            </Button>
          )}
          <Checkbox className={styles.myOrg} onChange={onChange}>
            {intl.formatMessage({ id: 'orgTree.my' })}
          </Checkbox>
        </div>
      </div>
      <Input
        allowClear
        className={styles.search}
        placeholder={intl.formatMessage({ id: 'orgTree.searchPlaceholder' })}
        suffix={<AntdIcon type="icon-a-Searchsousuo" />}
        onChange={(e) => setSearchValue(e.target.value)}
      />
      <Tree
        className={styles.tree}
        blockNode
        treeData={treeNodes}
        titleRender={titleRender}
        expandedKeys={expandedKeys}
        onExpand={handleExpand}
        selectedKeys={
          selectedOrg?.orgId !== null && selectedOrg?.orgId !== undefined ? [String(selectedOrg.orgId)] : []
        }
        onSelect={handleSelect}
        switcherIcon={<AntdIcon type="icon-a-Down-onexia1" className={styles.switcherIcon} />}
      />
    </div>
  );
};

export default OrganizationTree;
