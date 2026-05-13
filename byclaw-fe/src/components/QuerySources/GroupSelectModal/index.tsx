import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Checkbox, Spin, Input, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import VirtualList from 'rc-virtual-list';
import { useDispatch, useIntl } from '@umijs/max';
import { SourceRootIdMap, SourceTreeNodeTypeMap } from '../const';
import {
  getSkillList,
  getEnterpriseKnowledgeBaseList,
  getPersonalKnowledgeBaseList,
  batchSaveSelectedResources,
} from '../services';
import type { KnowledgeSource, SourceRootId, SourceTreeNode, SourceTreeNodeId } from '../types';
import useGlobal from '@/hooks/useGlobal';
import { getBusinessIdByNodeId, getDirTypeByRootId } from '../utils';

export interface GroupSelectModalProps {
  visible: boolean;
  groupId: SourceRootId | null;
  checkedIds: SourceTreeNodeId[];
  onCancel: () => void;
  onOk: (checkedIds: SourceTreeNodeId[]) => void;
  afterOpenChange?: (visible: boolean) => void;
}

/** 虚拟列表单行高度，需与样式一致 */
const ITEM_HEIGHT = 32;

const GroupSelectModal: React.FC<GroupSelectModalProps> = (props) => {
  const { visible, groupId, onCancel, onOk } = props;

  const [selectedIds, setSelectedIds] = useState<SourceTreeNodeId[]>([]);
  const [dataSource, setDataSource] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');

  const { agentId, sessionId, setSessionId } = useGlobal();
  const dispatch = useDispatch();
  const intl = useIntl();
  const qryList = useCallback(async () => {
    setLoading(true);
    let promise: Promise<{ list: KnowledgeSource[] }> | undefined;
    if (groupId === SourceRootIdMap.skills) {
      promise = getSkillList();
    }
    if (groupId === SourceRootIdMap.knowledgeBases) {
      promise = getPersonalKnowledgeBaseList();
    }
    if (groupId === SourceRootIdMap.enterpriseKnowledgeBases) {
      promise = getEnterpriseKnowledgeBaseList();
    }
    const result = await promise;
    if (!result) return null;
    setDataSource(result.list);
    setLoading(false);
    return result.list;
  }, [groupId]);

  const isSkillGroup = groupId === SourceRootIdMap.skills;

  type SkillTreeNode = SourceTreeNode & { children?: SkillTreeNode[] };

  const buildSkillTree = useCallback((list: KnowledgeSource[]): SkillTreeNode[] => {
    if (!list || !list.length) return [];

    const nodeMap = new Map<number, SkillTreeNode>();

    list.forEach((item) => {
      const dirId = item.dirId as number | undefined;
      if (dirId === undefined || dirId === null) return;
      nodeMap.set(dirId, {
        id: item.id,
        title: item.title,
        type: SourceTreeNodeTypeMap.skill,
        rootId: SourceRootIdMap.skills,
        sourceData: item,
        children: [],
      });
    });

    list.forEach((item) => {
      const dirId = item.dirId as number | undefined;
      const parentDirId = item.parentDirId as number | undefined;
      if (dirId === undefined || dirId === null) return;
      if (parentDirId === undefined || parentDirId === null || parentDirId === -1) return;
      const parentNode = nodeMap.get(parentDirId);
      const node = nodeMap.get(dirId);
      if (parentNode && node) {
        parentNode.children = parentNode.children || [];
        parentNode.children.push(node);
      }
    });

    nodeMap.forEach((node) => {
      if (node.children && node.children.length > 0) {
        node.type = SourceTreeNodeTypeMap.folder;
      }
    });

    const roots: SkillTreeNode[] = [];
    list.forEach((item) => {
      const dirId = item.dirId as number | undefined;
      const parentDirId = item.parentDirId as number | undefined;
      if (dirId === undefined || dirId === null) return;
      const node = nodeMap.get(dirId);
      if (!node) return;
      if (parentDirId === undefined || parentDirId === null || parentDirId === -1 || !nodeMap.has(parentDirId)) {
        roots.push(node);
      }
    });

    return roots;
  }, []);

  useEffect(() => {
    if (!groupId || !visible) {
      setDataSource([]);
      return;
    }
    setSearchKeyword('');
    setSelectedIds(props.checkedIds);
    qryList();
  }, [groupId, visible]);

  /** 技能树：完整树结构 */
  const fullSkillTree = useMemo<SkillTreeNode[]>(() => {
    if (!isSkillGroup) return [];
    return buildSkillTree(dataSource);
  }, [isSkillGroup, dataSource, buildSkillTree]);

  /** 技能树：根据搜索关键词过滤后的树，仅保留命中节点及其祖先 */
  const filteredSkillTree = useMemo<SkillTreeNode[]>(() => {
    if (!isSkillGroup) return [];
    const kw = searchKeyword.trim().toLowerCase();
    if (!kw) return fullSkillTree;

    const filterNodes = (nodes: SkillTreeNode[]): SkillTreeNode[] => {
      const result: SkillTreeNode[] = [];
      nodes.forEach((node) => {
        const children = node.children ? filterNodes(node.children) : undefined;
        const isMatch = (node.title ?? '').toLowerCase().includes(kw);
        if (isMatch || (children && children.length > 0)) {
          result.push({
            ...node,
            children,
          });
        }
      });
      return result;
    };

    return filterNodes(fullSkillTree);
  }, [isSkillGroup, fullSkillTree, searchKeyword]);

  /** 转为 antd Tree 的 treeData（key/title/children/isLeaf） */
  const skillTreeData = useMemo<DataNode[]>(() => {
    const toDataNodes = (nodes: SkillTreeNode[]): DataNode[] =>
      nodes.map((node) => ({
        key: node.id,
        title: node.title ?? '',
        isLeaf: node.type !== SourceTreeNodeTypeMap.folder,
        children: node.children?.length ? toDataNodes(node.children) : undefined,
      }));
    return toDataNodes(filteredSkillTree);
  }, [filteredSkillTree]);

  const collectSkillLeafIds = useCallback((nodes: SkillTreeNode[]): SourceTreeNodeId[] => {
    const result: SourceTreeNodeId[] = [];
    const traverse = (nodeList: SkillTreeNode[]) => {
      nodeList.forEach((node) => {
        if (node.type !== SourceTreeNodeTypeMap.folder) {
          result.push(node.id as SourceTreeNodeId);
        }
        if (node.children && node.children.length > 0) {
          traverse(node.children);
        }
      });
    };
    traverse(nodes);
    return result;
  }, []);

  /** 全树叶子 id 集合，onCheck 时只保留叶子 id */
  const allSkillLeafIdsSet = useMemo(
    () => new Set(collectSkillLeafIds(fullSkillTree)),
    [fullSkillTree, collectSkillLeafIds]
  );

  /** 根据搜索关键词过滤后的列表（全选仅作用于该列表） */
  const filteredList = useMemo(() => {
    if (isSkillGroup) {
      // 技能在弹窗中使用树结构，这里的 filteredList 仅用于统计和确定叶子节点数量
      return dataSource;
    }
    const kw = searchKeyword.trim().toLowerCase();
    if (!kw) return dataSource;
    return dataSource.filter((item) => (item.title ?? '').toLowerCase().includes(kw));
  }, [dataSource, searchKeyword, isSkillGroup]);

  const filteredIds = useMemo<SourceTreeNodeId[]>(() => {
    if (isSkillGroup) {
      return collectSkillLeafIds(filteredSkillTree);
    }
    return filteredList.map((item) => item.id);
  }, [isSkillGroup, filteredList, filteredSkillTree, collectSkillLeafIds]);

  const filteredCount = filteredIds.length;

  /** 当前筛选结果中已选中的 id 集合，用于全选/半选状态 */
  const filteredSelectedSet = useMemo(() => {
    const set = new Set(selectedIds);
    return new Set(filteredIds.filter((id) => set.has(id)));
  }, [selectedIds, filteredIds]);

  const selectedCountInFiltered = filteredSelectedSet.size;

  /** 全选：仅针对当前搜索结果 */
  const isAllFilteredSelected = filteredCount > 0 && selectedCountInFiltered === filteredCount;
  const isSomeFilteredSelected = selectedCountInFiltered > 0 && selectedCountInFiltered < filteredCount;

  const handleSelectAllFiltered = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedIds(filteredIds);
      } else {
        setSelectedIds([]);
      }
    },
    [filteredIds]
  );

  const modalTitle = useMemo(() => {
    if (groupId === SourceRootIdMap.skills) {
      return intl.formatMessage({ id: 'querySources.groupSelectModal.title.skills' });
    }
    if (groupId === SourceRootIdMap.knowledgeBases) {
      return intl.formatMessage({ id: 'querySources.groupSelectModal.title.personalKnowledgeBase' });
    }
    if (groupId === SourceRootIdMap.enterpriseKnowledgeBases) {
      return intl.formatMessage({ id: 'querySources.groupSelectModal.title.enterpriseKnowledgeBase' });
    }
    return '';
  }, [groupId, intl]);

  const handleOk = async () => {
    setConfirmLoading(true);
    let finnalSelectedIds = selectedIds;
    if (isSkillGroup) {
      const allLeafIds = collectSkillLeafIds(buildSkillTree(dataSource));
      finnalSelectedIds = selectedIds.filter((id) => allLeafIds.includes(id));
    }

    const dirType = getDirTypeByRootId(
      groupId as Extract<SourceRootId, 'knowledgeBases' | 'enterpriseKnowledgeBases' | 'skills'>
    );
    const newSessionId = await batchSaveSelectedResources({
      agentId,
      sessionId,
      dirType,
      resourceIds: finnalSelectedIds.map((id) => getBusinessIdByNodeId(id)),
    });
    if (newSessionId && `${newSessionId}` !== `${sessionId}`) {
      dispatch({
        type: 'session/addSession',
        payload: {
          sessionId: `${newSessionId}`,
          sessionName: intl.formatMessage(
            { id: 'querySources.groupSelectModal.newSessionName' },
            { timestamp: new Date().getTime() }
          ),
        },
      });
      setSessionId?.(`${newSessionId}`);
    }
    setConfirmLoading(false);
    onOk(finnalSelectedIds);
  };

  const toggleItem = useCallback((id: SourceTreeNodeId) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  }, []);

  const [skillExpandedKeys, setSkillExpandedKeys] = useState<React.Key[]>([]);

  useEffect(() => {
    if (isSkillGroup && visible && fullSkillTree.length) {
      const rootKeys = fullSkillTree.map((node) => node.id);
      setSkillExpandedKeys(rootKeys);
    }
  }, [isSkillGroup, visible, fullSkillTree]);

  const handleSkillTreeCheck = useCallback(
    (checkedKeys: React.Key[] | { checked: React.Key[]; halfChecked: React.Key[] }) => {
      const keys = Array.isArray(checkedKeys) ? checkedKeys : checkedKeys.checked;
      const next = (keys as SourceTreeNodeId[]).filter((k) => allSkillLeafIdsSet.has(k));
      setSelectedIds(next);
    },
    [allSkillLeafIdsSet]
  );

  return (
    <Modal
      open={visible}
      onCancel={onCancel}
      onOk={handleOk}
      destroyOnHidden
      centered
      title={modalTitle}
      confirmLoading={confirmLoading}
      afterOpenChange={props.afterOpenChange}
      okButtonProps={{
        disabled: loading,
      }}
      styles={{
        body: {
          paddingRight: 8,
        },
      }}
    >
      <Spin spinning={loading}>
        {/* 顶部栏：左侧全选，右侧搜索 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 8,
            flexWrap: 'wrap',
          }}
        >
          <Checkbox
            checked={isAllFilteredSelected}
            indeterminate={isSomeFilteredSelected && !isAllFilteredSelected}
            onChange={(e) => handleSelectAllFiltered(e.target.checked)}
            disabled={filteredCount === 0}
          >
            {intl.formatMessage({ id: 'querySources.groupSelectModal.selectAll' })}
          </Checkbox>
          <Input.Search
            allowClear
            placeholder={intl.formatMessage({ id: 'querySources.groupSelectModal.keywordPlaceholder' })}
            onSearch={setSearchKeyword}
            style={{ width: 200 }}
          />
        </div>
        {/* 内容区域：技能分组使用 antd Tree（自带 virtual），其它分组使用虚拟列表 */}
        {isSkillGroup ? (
          <Tree
            checkable
            blockNode
            height={Math.floor(window.innerHeight / 2)}
            treeData={skillTreeData}
            checkedKeys={selectedIds}
            onCheck={handleSkillTreeCheck}
            expandedKeys={skillExpandedKeys}
            onExpand={(keys) => setSkillExpandedKeys(keys)}
          />
        ) : (
          <VirtualList data={filteredList} height={window.innerHeight / 2} itemHeight={ITEM_HEIGHT} itemKey="id">
            {(item) => (
              <div
                key={item.id}
                style={{
                  height: ITEM_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--ant-color-border-secondary)',
                }}
                onClick={() => toggleItem(item.id)}
              >
                <Checkbox checked={selectedIds.includes(item.id)}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </span>
                </Checkbox>
              </div>
            )}
          </VirtualList>
        )}
      </Spin>
    </Modal>
  );
};

export default GroupSelectModal;
