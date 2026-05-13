import AntdIcon from '@/components/AntdIcon';
import useKnowledgeStore from '@/models/useKnowledgeStore';
import { DownOutlined } from '@ant-design/icons';
import { Button, Modal, Tree } from 'antd';
import classNames from 'classnames';
// @ts-ignore
import { useIntl } from '@umijs/max';
import React, { useEffect, useMemo, useState } from 'react';
import styles from './index.module.less';

type MoveModalProp = {
  visible: boolean;
  onCancel: () => void;
  onOk: () => void;
  onAdd: (val: string) => void;
  // info: any;
  baseInfo?: any;
};

type FlatNode = {
  id: number;
  parentId: number | null;
  name: string;
};

type TreeData = {
  title: string;
  value: number;
  key: number;
  children?: TreeData[];
};

const flatToTree = (flatList: FlatNode[]): TreeData[] => {
  const map = new Map<number, TreeData>();
  const result: TreeData[] = [];

  // 创建所有节点的映射
  flatList.forEach((item) => {
    map.set(item.id, { ...item, children: [] });
  });

  // 构建树形结构
  flatList.forEach((item) => {
    const node = map.get(item.id);
    if (!node) return;

    if (item.parentId === null || item.parentId === 0) {
      result.push(node);
    } else {
      const parent = map.get(item.parentId);
      if (parent && !parent.children) {
        parent.children = [node];
      } else if (parent && parent.children) {
        parent.children.push(node);
      }
    }
  });

  return result;
};

const MoveModal: React.FC<MoveModalProp> = (props: MoveModalProp) => {
  const { visible, onCancel, onOk, onAdd, baseInfo } = props;

  const intl = useIntl();
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);

  const { getCatalogTree, catalogTree } = useKnowledgeStore();

  const treeData = useMemo(
    () =>
      flatToTree(
        catalogTree.map((item) => ({
          ...item,
          icon: <AntdIcon type="icon-wenjianjialanse" style={{ fontSize: 24 }} />,
          title: item.name,
          key: item.id,
        }))
      ),
    [catalogTree]
  );

  useEffect(() => {
    if (baseInfo) {
      getCatalogTree({
        datasetId: baseInfo.resourceSourcePkId,
      });
    }
  }, [baseInfo]);

  const onSelect = (selectedKeys: React.Key[], info: any) => {
    console.log('selected', selectedKeys, info);
    setSelectedKeys(selectedKeys);
  };

  const onExpand = (expandedKeys: React.Key[]) => {
    console.log('onExpand', expandedKeys);
    setExpandedKeys(expandedKeys);
  };

  return (
    <Modal
      open={visible}
      title={intl.formatMessage({ id: 'directoryManage.moveTo' })}
      onCancel={onCancel}
      onOk={onOk}
      width={720}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button
            onClick={() => {
              onAdd(`${selectedKeys?.[0] || ''}`);
            }}
            type="link"
            icon={<AntdIcon type="icon-a-Folder-pluswenjianjia-tianjia" style={{ fontSize: 18 }} />}
          >
            {intl.formatMessage({ id: 'directoryManage.newFolder' })}
          </Button>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button onClick={onCancel}>{intl.formatMessage({ id: 'common.cancel' })}</Button>
            <Button type="primary" onClick={onOk}>
              {intl.formatMessage({ id: 'common.confirm' })}
            </Button>
          </div>
        </div>
      }
    >
      <div className={classNames(styles.container, 'overflow-auto hideThumb')}>
        <Tree
          className={styles.tree}
          treeData={treeData}
          onSelect={onSelect}
          selectedKeys={selectedKeys}
          expandedKeys={expandedKeys}
          onExpand={onExpand}
          blockNode
          showIcon
          switcherIcon={<DownOutlined />}
        />
      </div>
    </Modal>
  );
};

export default MoveModal;
