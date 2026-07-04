// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { DatabaseOutlined, FolderOutlined, TableOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { findDetailsById } from '@/pages/manager/service/DigitalEmployeeMgr';
import { bindOntologySave, getOntologySceneDetails, listOntologyScenes } from '@/service/ontology';

const getData = (res: any) => res?.data ?? res ?? [];

const ICONS: Record<string, any> = {
  scene: <FolderOutlined style={{ color: '#f7ba1e' }} />,
  view: <TableOutlined style={{ color: '#0f6e56' }} />,
  object: <DatabaseOutlined style={{ color: '#185fa5' }} />,
  base: <DatabaseOutlined style={{ color: '#378add' }} />,
};
const leafTitle = (name: string, type: string, onClick?: () => void) => (
  <span>
    {ICONS[type]}{' '}
    {onClick ? (
      <span
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {name}
      </span>
    ) : (
      name
    )}
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
}: {
  enabled: boolean;
  baseId?: string;
  ownerType?: string;
  baseName?: string;
  digitalEmployeeId?: string | number;
  onTitleClick?: (meta: any) => void;
}) {
  const intl = useIntl();
  const t = (id: string, v?: any) => intl.formatMessage({ id }, v);

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
        const scenes = (getData(res) as any[]) || [];
        const details = await Promise.all(
          scenes.map((s) =>
            getOntologySceneDetails({ ownerType, baseId, sceneId: s.sceneId })
              .then((r) => ({ scene: s, detail: getData(r) }))
              .catch(() => ({ scene: s, detail: {} }))
          )
        );

        const sceneNodes: any[] = [];
        details.forEach(({ scene, detail }) => {
          const sceneId = scene.sceneId;
          const sceneKey = `scene:${sceneId}`;
          const objects = detail?.objects || [];
          const views = detail?.views || [];
          const objByCode: Record<string, any> = {};
          objects.forEach((o: any) => (objByCode[o.objectCode] = o));
          const inViewCodes = new Set<string>();
          views.forEach((v: any) => (v.objectCodes || []).forEach((c: string) => inViewCodes.add(c)));

          map[sceneKey] = {
            key: sceneKey,
            level: 'SCENE',
            parentKey: baseKey,
            childKeys: [],
            sceneId,
            sceneName: scene.sceneName,
            sceneDesc: scene.sceneDesc,
          };
          map[baseKey].childKeys.push(sceneKey);
          const sceneChildren: any[] = [];

          views.forEach((v: any) => {
            const viewKey = `view:${sceneId}:${v.viewCode}`;
            map[viewKey] = {
              key: viewKey,
              level: 'VIEW',
              parentKey: sceneKey,
              childKeys: [],
              sceneId,
              sceneName: scene.sceneName,
              viewCode: v.viewCode,
              viewName: v.viewName,
              viewDesc: v.description,
            };
            map[sceneKey].childKeys.push(viewKey);
            const viewChildren: any[] = [];
            (v.objectCodes || []).forEach((code: string) => {
              const o = objByCode[code] || { objectCode: code };
              const okey = `vobj:${sceneId}:${v.viewCode}:${code}`;
              map[okey] = {
                key: okey,
                level: 'OBJECT_IN_VIEW',
                parentKey: viewKey,
                childKeys: [],
                sceneId,
                sceneName: scene.sceneName,
                viewCode: v.viewCode,
                viewName: v.viewName,
                objectCode: code,
                objectName: o.objectName,
                objectDesc: o.objectDesc,
              };
              map[viewKey].childKeys.push(okey);
              viewChildren.push({
                key: okey,
                title: leafTitle(o.objectName || code, 'object', tc(okey)),
              });
            });
            sceneChildren.push({
              key: viewKey,
              title: leafTitle(v.viewName || v.viewCode, 'view', tc(viewKey)),
              children: viewChildren,
            });
          });

          objects.forEach((o: any) => {
            if (inViewCodes.has(o.objectCode)) return;
            const okey = `sobj:${sceneId}:${o.objectCode}`;
            map[okey] = {
              key: okey,
              level: 'OBJECT_IN_SCENE',
              parentKey: sceneKey,
              childKeys: [],
              sceneId,
              sceneName: scene.sceneName,
              objectCode: o.objectCode,
              objectName: o.objectName,
              objectDesc: o.objectDesc,
            };
            map[sceneKey].childKeys.push(okey);
            sceneChildren.push({ key: okey, title: leafTitle(o.objectName || o.objectCode, 'object', tc(okey)) });
          });

          sceneNodes.push({
            key: sceneKey,
            title: leafTitle(scene.sceneName || sceneId, 'scene', tc(sceneKey)),
            children: sceneChildren,
          });
        });

        const root = [
          { key: baseKey, title: leafTitle(baseName || baseId, 'base', tc(baseKey)), children: sceneNodes },
        ];
        setTreeData(root);
        setNodeMap(map);
        setExpandedKeys([baseKey, ...sceneNodes.map((n) => n.key)]);
        const pre = await preselect(map);
        setCheckedKeys(pre);
        setInitialKeys(pre);
      })
      .catch(() => {
        setTreeData([]);
        setNodeMap({});
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, baseId, ownerType, digitalEmployeeId]);

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

  const save = async () => {
    if (!digitalEmployeeId) {
      message.error(t('resource.noDefaultDigitalEmployee'));
      return false;
    }
    // 保存全部勾选节点（含被自动选中的父节点），每个节点都入资源表 + 写资源关系
    const nodes = checkedKeys
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
      }));
    setSaving(true);
    try {
      const res: any = await bindOntologySave({
        digitalEmployeeId: `${digitalEmployeeId}`,
        ownerType,
        baseId,
        baseName,
        nodes,
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

  return { loading, saving, treeData, checkedKeys, onCheck, expandedKeys, setExpandedKeys, dirty, save };
}
