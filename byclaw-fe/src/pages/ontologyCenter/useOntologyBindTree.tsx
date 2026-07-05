// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { DatabaseOutlined, FolderOutlined, TableOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { findDetailsById } from '@/pages/manager/service/DigitalEmployeeMgr';
import { bindOntologySave, getOntologySceneDetails, listOntologyScenes } from '@/service/ontology';
import styles from './BindOntologyDrawer.module.less';

const getData = (res: any) => res?.data ?? res ?? [];

const toArray = (value: any) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const next = value.records || value.rows || value.list || value.items || value.data || [];
  return Array.isArray(next) ? next : [];
};

const firstValue = (source: any, keys: string[]) => {
  if (!source) return undefined;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
  }
  return undefined;
};

const getObjectCode = (object: any) => firstValue(object, ['objectCode', 'object_code', 'code']);
const getObjectName = (object: any) => firstValue(object, ['objectName', 'object_name', 'name']);
const getObjectDesc = (object: any) => firstValue(object, ['objectDesc', 'object_desc', 'description', 'desc']);
const getSceneId = (scene: any) => firstValue(scene, ['sceneId', 'scene_id', 'id', 'code']);
const getSceneName = (scene: any) => firstValue(scene, ['sceneName', 'scene_name', 'name']);
const getSceneDesc = (scene: any) => firstValue(scene, ['sceneDesc', 'scene_desc', 'description', 'desc']);
const getViewCode = (view: any) => firstValue(view, ['viewCode', 'view_code', 'code']);
const getViewName = (view: any) => firstValue(view, ['viewName', 'view_name', 'name']);
const getViewDesc = (view: any) => firstValue(view, ['description', 'viewDesc', 'view_desc', 'desc']);
const getViewObjectCodes = (view: any) => {
  const raw = firstValue(view, ['objectCodes', 'object_codes', 'objectCodeList', 'objectList', 'objects']);
  return toArray(raw)
    .map((item: any) => (typeof item === 'string' ? item : getObjectCode(item)))
    .filter(Boolean);
};

const ICONS: Record<string, any> = {
  scene: <FolderOutlined style={{ color: '#f7ba1e' }} />,
  view: <TableOutlined style={{ color: '#0f6e56' }} />,
  object: <DatabaseOutlined style={{ color: '#185fa5' }} />,
  base: <DatabaseOutlined style={{ color: '#378add' }} />,
};
const leafTitle = (name: string, type: string, typeLabel: string, onClick?: () => void) => (
  <span className={styles.bindTreeNodeTitle}>
    <span className={styles.bindTreeNodeNameWrap}>
      {ICONS[type]}
      <span className={styles.bindTreeNodeNameGap} />
      {onClick ? (
        <span
          className={`${styles.bindTreeNodeName} ${styles.bindTreeNodeNameClickable}`}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          {name}
        </span>
      ) : (
        <span className={styles.bindTreeNodeName}>{name}</span>
      )}
    </span>
    <span className={styles.bindTreeTypeTag}>
      <span className={styles.bindTreeTypeTagText}>{typeLabel}</span>
    </span>
  </span>
);

const entryToKey = (e: any) => {
  if (e.objectCode && e.viewCode) return `vobj:${e.sceneId}:${e.viewCode}:${e.objectCode}`;
  if (e.objectCode) return `sobj:${e.sceneId}:${e.objectCode}`;
  if (e.viewCode) return `view:${e.sceneId}:${e.viewCode}`;
  if (e.sceneId) return `scene:${e.sceneId}`;
  return 'base';
};

const descendants = (key: string, map: Record<string, any>): string[] => {
  const out: string[] = [];
  const walk = (k: string) => {
    (map[k]?.childKeys || []).forEach((c: string) => {
      out.push(c);
      walk(c);
    });
  };
  walk(key);
  return out;
};

const ancestors = (key: string, map: Record<string, any>): string[] => {
  const out: string[] = [];
  let cur = map[key]?.parentKey;
  while (cur) {
    out.push(cur);
    cur = map[cur]?.parentKey;
  }
  return out;
};

const sortedKey = (arr: string[]) => [...arr].sort().join('|');

/**
 * 本体绑定树的可复用逻辑：从 datacloud 构建整库可勾选树、按当前员工 relOntology 预勾选、
 * 复选级联（勾父选全子、取消保留祖先）、计算选中叶子、覆盖式保存。供绑定抽屉与 sider 复用。
 */
export function useOntologyBindTree({
  enabled,
  baseId,
  ownerType,
  baseName,
  digitalEmployeeId,
  onTitleClick,
  initialCheckedKeys,
}: {
  enabled: boolean;
  baseId?: string;
  ownerType?: string;
  baseName?: string;
  digitalEmployeeId?: string | number;
  onTitleClick?: (meta: any) => void;
  initialCheckedKeys?: string[];
}) {
  const intl = useIntl();
  const t = (id: string, v?: any) => intl.formatMessage({ id }, v);
  const typeLabel = (type: 'ontology' | 'scene' | 'view' | 'object') => t(`common.resourceType.${type}`);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [treeData, setTreeData] = useState<any[]>([]);
  const [nodeMap, setNodeMap] = useState<Record<string, any>>({});
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  const [initialKeys, setInitialKeys] = useState<string[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);

  const preselect = useCallback(
    async (map: Record<string, any>) => {
      if (!digitalEmployeeId) return [];
      try {
        const res: any = await findDetailsById({ resourceId: String(digitalEmployeeId) });
        const detail = getData(res) || {};
        const relOntology = detail.relOntology || [];
        const keys = new Set<string>();
        relOntology
          .filter((e: any) => `${e.ontologyBaseCode}` === `${baseId}`)
          .forEach((e: any) => {
            let cur: string | null = map[entryToKey(e)] ? entryToKey(e) : null;
            while (cur) {
              keys.add(cur);
              cur = map[cur]?.parentKey;
            }
          });
        return Array.from(keys);
      } catch {
        return [];
      }
    },
    [digitalEmployeeId, baseId]
  );

  useEffect(() => {
    if (!enabled || !baseId) return;
    setLoading(true);
    setCheckedKeys([]);
    const map: Record<string, any> = {};
    const baseKey = 'base';
    map[baseKey] = {
      key: baseKey,
      level: 'BASE',
      parentKey: null,
      childKeys: [],
      baseId,
      baseName: baseName || baseId,
    };
    // 节点名点击 → 回传该节点 meta（供右侧详情抽屉使用）
    const tc = (k: string) => (onTitleClick ? () => onTitleClick(map[k]) : undefined);

    listOntologyScenes({ ownerType, baseId })
      .then(async (res) => {
        const scenes = toArray(getData(res));
        const details = await Promise.all(
          scenes
            .map((s) => ({ scene: s, sceneId: getSceneId(s) }))
            .filter(({ sceneId }) => !!sceneId)
            .map(({ scene, sceneId }) =>
              getOntologySceneDetails({ ownerType, baseId, sceneId })
                .then((r) => ({ scene, sceneId, detail: getData(r) }))
                .catch(() => ({ scene, sceneId, detail: {} }))
            )
        );

        const sceneNodes: any[] = [];
        details.forEach(({ scene, sceneId, detail }) => {
          const sceneKey = `scene:${sceneId}`;
          const sceneName = getSceneName(scene);
          // 场景直属对象：只来自场景详情的对象列表；视图内 objectCodes 只作为视图子节点展示，不提升到场景下。
          const sceneObjects = toArray(firstValue(detail, ['objects', 'objectList', 'objectInfos']));
          const views = toArray(firstValue(detail, ['views', 'viewList', 'viewInfos']));
          const objByCode: Record<string, any> = {};
          sceneObjects.forEach((o: any) => {
            const objectCode = getObjectCode(o);
            if (objectCode) objByCode[objectCode] = o;
          });

          map[sceneKey] = {
            key: sceneKey,
            level: 'SCENE',
            parentKey: baseKey,
            childKeys: [],
            sceneId,
            sceneName,
            sceneDesc: getSceneDesc(scene),
          };
          map[baseKey].childKeys.push(sceneKey);
          const sceneChildren: any[] = [];

          views.forEach((v: any) => {
            const viewCode = getViewCode(v);
            if (!viewCode) return;
            const viewName = getViewName(v);
            const viewKey = `view:${sceneId}:${viewCode}`;
            map[viewKey] = {
              key: viewKey,
              level: 'VIEW',
              parentKey: sceneKey,
              childKeys: [],
              sceneId,
              sceneName,
              viewCode,
              viewName,
              viewDesc: getViewDesc(v),
            };
            map[sceneKey].childKeys.push(viewKey);
            const viewChildren: any[] = [];
            getViewObjectCodes(v).forEach((code: string) => {
              const o = objByCode[code] || { objectCode: code };
              const okey = `vobj:${sceneId}:${viewCode}:${code}`;
              map[okey] = {
                key: okey,
                level: 'OBJECT_IN_VIEW',
                parentKey: viewKey,
                childKeys: [],
                sceneId,
                sceneName,
                viewCode,
                viewName,
                objectCode: code,
                objectName: getObjectName(o),
                objectDesc: getObjectDesc(o),
              };
              map[viewKey].childKeys.push(okey);
              viewChildren.push({
                key: okey,
                title: leafTitle(getObjectName(o) || code, 'object', typeLabel('object'), tc(okey)),
              });
            });
            sceneChildren.push({
              key: viewKey,
              title: leafTitle(viewName || viewCode, 'view', typeLabel('view'), tc(viewKey)),
              children: viewChildren,
            });
          });

          sceneObjects.forEach((o: any) => {
            const objectCode = getObjectCode(o);
            if (!objectCode) return;
            const objectName = getObjectName(o);
            const okey = `sobj:${sceneId}:${objectCode}`;
            map[okey] = {
              key: okey,
              level: 'OBJECT_IN_SCENE',
              parentKey: sceneKey,
              childKeys: [],
              sceneId,
              sceneName,
              objectCode,
              objectName,
              objectDesc: getObjectDesc(o),
            };
            map[sceneKey].childKeys.push(okey);
            sceneChildren.push({
              key: okey,
              title: leafTitle(objectName || objectCode, 'object', typeLabel('object'), tc(okey)),
            });
          });

          sceneNodes.push({
            key: sceneKey,
            title: leafTitle(sceneName || sceneId, 'scene', typeLabel('scene'), tc(sceneKey)),
            children: sceneChildren,
          });
        });

        const root = [
          {
            key: baseKey,
            title: leafTitle(baseName || baseId, 'base', typeLabel('ontology'), tc(baseKey)),
            children: sceneNodes,
          },
        ];
        setTreeData(root);
        setNodeMap(map);
        setExpandedKeys([baseKey, ...sceneNodes.map((n) => n.key)]);
        const pre = Array.isArray(initialCheckedKeys) ? initialCheckedKeys : await preselect(map);
        setCheckedKeys(pre);
        setInitialKeys(pre);
      })
      .catch(() => {
        setTreeData([]);
        setNodeMap({});
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, baseId, ownerType, digitalEmployeeId, initialCheckedKeys]);

  const onCheck = (_: any, info: any) => {
    const key = info.node.key;
    const set = new Set(checkedKeys);
    if (info.checked) {
      // 勾选：连同所有后代与所有祖先一起选中（父节点跟随选中）
      [key, ...descendants(key, nodeMap), ...ancestors(key, nodeMap)].forEach((k) => set.add(k));
    } else {
      // 取消：只取消该节点及其后代，保留祖先
      [key, ...descendants(key, nodeMap)].forEach((k) => set.delete(k));
    }
    setCheckedKeys(Array.from(set));
  };

  const dirty = useMemo(() => sortedKey(checkedKeys) !== sortedKey(initialKeys), [checkedKeys, initialKeys]);

  const selectedNodes = useMemo(
    () =>
      checkedKeys
        .map((k) => nodeMap[k])
        .filter(Boolean)
        .map((n) => ({
          level: n.level,
          sceneId: n.sceneId,
          sceneName: n.sceneName,
          sceneDesc: n.sceneDesc,
          viewCode: n.viewCode,
          viewName: n.viewName,
          viewDesc: n.viewDesc,
          objectCode: n.objectCode,
          objectName: n.objectName,
          objectDesc: n.objectDesc,
        })),
    [checkedKeys, nodeMap]
  );

  const isClearing = dirty && initialKeys.length > 0 && checkedKeys.length === 0;

  const save = async (options: { confirmClear?: boolean } = {}) => {
    if (!digitalEmployeeId) {
      message.error(t('resource.noDefaultDigitalEmployee'));
      return false;
    }
    // 保存全部勾选节点（含被自动选中的父节点），每个节点都入资源表 + 写资源关系
    const nodes = selectedNodes;
    setSaving(true);
    try {
      const res: any = await bindOntologySave({
        digitalEmployeeId: `${digitalEmployeeId}`,
        ownerType,
        baseId,
        baseName,
        nodes,
        confirmClear: options.confirmClear,
      });
      if (res && res.code !== undefined && res.code !== 0 && res.code !== 200) {
        message.error(res.msg || res.message || t('common.operationFailed'));
        return false;
      }
      message.success(t('common.saveSuccess'));
      setInitialKeys(checkedKeys);
      window.dispatchEvent(new CustomEvent('ontologyBindSaved', { detail: { baseId } }));
      return true;
    } catch (e: any) {
      message.error(typeof e === 'string' ? e : e?.message || t('common.operationFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    loading,
    saving,
    treeData,
    nodeMap,
    checkedKeys,
    selectedNodes,
    initialKeys,
    isClearing,
    onCheck,
    expandedKeys,
    setExpandedKeys,
    dirty,
    save,
  };
}
