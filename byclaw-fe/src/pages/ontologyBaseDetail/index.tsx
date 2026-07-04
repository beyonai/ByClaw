// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Empty, Input, Modal, Spin, Tooltip, Tree, message } from 'antd';
import {
  DatabaseOutlined,
  DeleteOutlined,
  FolderOutlined,
  LeftOutlined,
  SearchOutlined,
  TableOutlined,
} from '@ant-design/icons';
import classnames from 'classnames';
// @ts-ignore
import { useIntl, useNavigate, useSearchParams } from '@umijs/max';
import { deleteOntologyBase, getOntologySceneDetails, listOntologyScenes } from '@/service/ontology';
import EntityDetailDrawer from './EntityDetailDrawer';
import styles from './index.module.less';

const getData = (res: any) => res?.data ?? res ?? [];

const OntologyBaseDetail: React.FC = () => {
  const intl = useIntl();
  const t = (id: string, values?: any) => intl.formatMessage({ id }, values);
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const baseId = sp.get('baseId') || '';
  const ownerType = sp.get('ownerType') || 'personal';
  const resourceName = sp.get('resourceName') || '';
  const resourceCode = sp.get('resourceCode') || baseId;
  const backPath = `/ontologyCenter?tab=${ownerType}`;

  const [scenes, setScenes] = useState<any[]>([]);
  const [sceneId, setSceneId] = useState<string | undefined>();
  const [detail, setDetail] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState<'object' | 'view'>('object');
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [keyword, setKeyword] = useState('');
  const [entity, setEntity] = useState<any>(null); // { type:'object'|'view', code }

  const loadScenes = useCallback(
    (preferSceneId?: string) => {
      if (!baseId) return;
      listOntologyScenes({ ownerType, baseId })
        .then((res) => {
          const list = getData(res);
          const arr = Array.isArray(list) ? list : [];
          setScenes(arr);
          const keep = preferSceneId && arr.some((s: any) => s.sceneId === preferSceneId);
          const nextId = keep ? preferSceneId : arr[0]?.sceneId;
          setSceneId(nextId);
          // 默认展开当前场景，便于直接点视图/对象
          if (nextId) setExpandedKeys((prev) => (prev.length ? prev : [`scene:${nextId}`]));
        })
        .catch(() => setScenes([]));
    },
    [baseId, ownerType]
  );

  const loadDetail = useCallback(() => {
    if (!baseId || !sceneId) {
      setDetail({});
      return;
    }
    setLoading(true);
    getOntologySceneDetails({ ownerType, baseId, sceneId })
      .then((res) => {
        const d = getData(res);
        setDetail(d && typeof d === 'object' && !Array.isArray(d) ? d : {});
      })
      .catch(() => setDetail({}))
      .finally(() => setLoading(false));
  }, [baseId, ownerType, sceneId]);

  useEffect(() => {
    loadScenes();
  }, [loadScenes]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const objects = detail.objects || [];
  const views = detail.views || [];

  const kw = keyword.trim();
  const matched = (name: string, code: string) => !kw || `${name || ''}`.includes(kw) || `${code || ''}`.includes(kw);
  const filteredObjects = useMemo(() => objects.filter((o: any) => matched(o.objectName, o.objectCode)), [objects, kw]);
  const filteredViews = useMemo(() => views.filter((v: any) => matched(v.viewName, v.viewCode)), [views, kw]);

  const currentSceneName = scenes.find((s) => s.sceneId === sceneId)?.sceneName || '';
  const catLabel = category === 'object' ? t('common.resourceType.object') : t('common.resourceType.view');

  // 左侧树：场景为父节点，视图/对象为子节点
  const treeData = useMemo(
    () =>
      scenes.map((s: any) => ({
        key: `scene:${s.sceneId}`,
        nodeType: 'scene',
        sceneId: s.sceneId,
        raw: s,
        children: [
          { key: `view:${s.sceneId}`, nodeType: 'cat', cat: 'view', sceneId: s.sceneId, isLeaf: true },
          { key: `object:${s.sceneId}`, nodeType: 'cat', cat: 'object', sceneId: s.sceneId, isLeaf: true },
        ],
      })),
    [scenes]
  );

  const selectCat = (sid: string, cat: 'view' | 'object') => {
    setSceneId(sid);
    setCategory(cat);
    setKeyword('');
  };

  const renderTreeTitle = (node: any) => {
    if (node.nodeType === 'scene') {
      return (
        <div className={styles.treeScene}>
          <FolderOutlined className={styles.sceneIcon} />
          <span className={styles.treeSceneName}>{node.raw.sceneName || node.sceneId}</span>
        </div>
      );
    }
    const active = category === node.cat && sceneId === node.sceneId;
    const meta: any = {
      view: { Icon: TableOutlined, cls: styles.leafIconView, label: t('common.resourceType.view') },
      object: { Icon: DatabaseOutlined, cls: styles.leafIconObject, label: t('common.resourceType.object') },
    }[node.cat];
    const { Icon } = meta;
    return (
      <div
        className={classnames(styles.treeCat, { [styles.treeCatActive]: active })}
        onClick={() => selectCat(node.sceneId, node.cat)}
      >
        <Icon className={meta.cls} />
        <span>{meta.label}</span>
      </div>
    );
  };

  const handleDeleteBase = () => {
    Modal.confirm({
      title: t('ontologyCenter.delete.confirmTitle'),
      content: t('ontologyCenter.delete.confirmContent', { name: resourceName }),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          const res: any = await deleteOntologyBase({ ownerType, baseId });
          if (res && res.code !== undefined && res.code !== 0 && res.code !== 200) {
            message.error(res.msg || res.message || t('common.operationFailed'));
            return;
          }
          message.success(t('ontologyCenter.delete.success'));
          navigate(backPath, { replace: true });
        } catch (e: any) {
          message.error(typeof e === 'string' ? e : e?.message || t('common.operationFailed'));
        }
      },
    });
  };

  const renderLeafList = (list: any[], type: 'object' | 'view') => {
    if (!list.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    return (
      <div className={styles.leafList}>
        {list.map((it: any) => {
          const code = type === 'object' ? it.objectCode : it.viewCode;
          const name = type === 'object' ? it.objectName : it.viewName;
          return (
            <div key={code} className={styles.leafRow}>
              {type === 'object' ? (
                <DatabaseOutlined className={styles.leafIconObject} />
              ) : (
                <TableOutlined className={styles.leafIconView} />
              )}
              <div className={styles.leafMain}>
                <div className={styles.leafName}>{name || code}</div>
                <div className={styles.leafCode}>{code}</div>
              </div>
              <div className={styles.leafActions}>
                <span className={styles.actLink} onClick={() => setEntity({ type, code })}>
                  {t('ontologyCenter.detail.detail')}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.back} onClick={() => navigate(backPath)}>
        <LeftOutlined /> {t('layout.back')}
      </div>

      {/* 顶部本体库信息 */}
      <div className={styles.header}>
        <div className={styles.headerIcon}>
          <DatabaseOutlined style={{ fontSize: 26 }} />
        </div>
        <div className={styles.headerMain}>
          <div className={styles.headerName}>{resourceName || baseId}</div>
          <div className={styles.headerCode}>{resourceCode}</div>
        </div>
        <div className={styles.headerActions}>
          <Tooltip title={t('common.delete')}>
            <div className={styles.headerActionBtn} onClick={handleDeleteBase}>
              <DeleteOutlined />
            </div>
          </Tooltip>
        </div>
      </div>

      {/* 主体：左侧场景 + 右侧对象/视图 */}
      <div className={styles.body}>
        <div className={styles.left}>
          <div className={styles.leftHeader}>
            <span>{t('ontologyBaseDetail.sceneMgr')}</span>
          </div>
          <div className={styles.treeWrap}>
            {scenes.length ? (
              <Tree
                selectable={false}
                blockNode
                expandAction="click"
                treeData={treeData}
                expandedKeys={expandedKeys}
                onExpand={(keys) => setExpandedKeys(keys)}
                titleRender={renderTreeTitle}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} />
            )}
          </div>
        </div>

        <div className={styles.right}>
          <div className={styles.rightToolbar}>
            <span className={styles.rightTitle}>
              {currentSceneName && <span className={styles.rightScene}>{currentSceneName} / </span>}
              {catLabel}
            </span>
            <div className={styles.rightTools}>
              <Input
                className={styles.searchInput}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                suffix={<SearchOutlined />}
                placeholder={t('common.inputKeyword')}
                allowClear
              />
            </div>
          </div>

          <Spin spinning={loading} wrapperClassName={styles.spinFill}>
            <div className={styles.listWrap}>
              {category === 'object' && renderLeafList(filteredObjects, 'object')}
              {category === 'view' && renderLeafList(filteredViews, 'view')}
            </div>
          </Spin>
        </div>
      </div>

      <EntityDetailDrawer
        open={!!entity}
        type={entity?.type}
        code={entity?.code}
        sceneDetail={detail}
        onClose={() => setEntity(null)}
      />
    </div>
  );
};

export default OntologyBaseDetail;
