// @ts-nocheck
import React from 'react';
import { Drawer, Empty, Table, Tag } from 'antd';
import { useIntl } from '@umijs/max';
import styles from '../ontologyCenter/OntologyDetailDrawer.module.less';

const DATA_TYPE_COLOR: Record<string, string> = {
  STRING: 'orange',
  BIGINT: 'blue',
  INTEGER: 'blue',
  DOUBLE: 'geekblue',
  BOOLEAN: 'purple',
  DATE: 'green',
};

/**
 * 原子实体详情抽屉：对象(属性+动作) / 视图(视图属性+对象列表)。
 * 数据由管理页从场景详情(getSceneDetails)即时传入，零额外请求。
 */
const EntityDetailDrawer = ({
  open,
  type,
  code,
  sceneDetail = {},
  onClose,
}: {
  open: boolean;
  type?: 'object' | 'view';
  code?: string;
  sceneDetail?: any;
  onClose: () => void;
}) => {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });

  const objects = sceneDetail?.objects || [];
  const views = sceneDetail?.views || [];
  const actions = sceneDetail?.actions || [];

  const obj = type === 'object' ? objects.find((o: any) => o.objectCode === code) : null;
  const view = type === 'view' ? views.find((v: any) => v.viewCode === code) : null;

  const renderPropertyTable = (properties: any[] = []) => (
    <Table
      size="small"
      tableLayout="fixed"
      rowKey={(r: any, i) => `${r.propertyCode || ''}-${i}`}
      dataSource={properties}
      pagination={false}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      columns={[
        { title: t('ontologyCenter.detail.col.name'), dataIndex: 'propertyName', ellipsis: true },
        {
          title: t('ontologyCenter.detail.col.code'),
          dataIndex: 'propertyCode',
          ellipsis: true,
          render: (v: string) => <span className={styles.mono}>{v}</span>,
        },
        {
          title: t('ontologyCenter.detail.col.type'),
          dataIndex: 'dataType',
          width: 92,
          render: (v: string) => (v ? <Tag color={DATA_TYPE_COLOR[v] || 'default'}>{v}</Tag> : '-'),
        },
        {
          title: t('ontologyCenter.detail.col.constraint'),
          width: 116,
          render: (_: any, r: any) => (
            <span className={styles.constraintCell}>
              {r.businessKey === 1 && <Tag color="gold">{t('ontologyCenter.detail.businessKey')}</Tag>}
              {r.isRequired === 1 && <Tag color="red">{t('ontologyCenter.detail.required')}</Tag>}
              {r.terminology && <Tag>{t('ontologyCenter.detail.term')}</Tag>}
            </span>
          ),
        },
      ]}
    />
  );

  const renderObject = () => {
    if (!obj) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    const objActions = actions.filter((a: any) => a.belongObjectCode === obj.objectCode);
    return (
      <div>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>{obj.objectName || obj.objectCode}</span>
          <span className={styles.mono}>{obj.objectCode}</span>
        </div>
        <div className={styles.panelTags}>
          {obj.conceptType === '2' ? (
            <Tag color="purple">{t('ontologyCenter.detail.conceptActivity')}</Tag>
          ) : (
            <Tag color="geekblue">{t('ontologyCenter.detail.conceptEntity')}</Tag>
          )}
          {obj.objectSource && <Tag color="cyan">{obj.objectSource}</Tag>}
          <Tag>
            {(obj.properties || []).length} {t('ontologyCenter.detail.attrUnit')}
          </Tag>
        </div>
        {obj.objectDesc && <div className={styles.desc}>{obj.objectDesc}</div>}
        <div className={styles.sectionTitle}>{t('ontologyCenter.detail.attributes')}</div>
        {renderPropertyTable(obj.properties)}
        {objActions.length > 0 && (
          <>
            <div className={styles.sectionTitle}>{t('ontologyCenter.detail.actions')}</div>
            <div className={styles.entityList}>
              {objActions.map((a: any) => (
                <div key={a.actionCode} className={styles.actionRow}>
                  <Tag color={a.actionType === 'query' ? 'blue' : 'volcano'}>{a.actionType || 'action'}</Tag>
                  <span className={styles.actionName}>{a.actionName || a.actionCode}</span>
                  {(a.requestUrl || a.requestMethod) && (
                    <span className={styles.mono} style={{ marginLeft: 'auto', color: '#999' }}>
                      {a.requestMethod} {a.requestUrl}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  const renderView = () => {
    if (!view) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    const objectsByCode: Record<string, any> = {};
    objects.forEach((o: any) => {
      if (o?.objectCode) objectsByCode[o.objectCode] = o;
    });
    const viewObjects = (view.objectCodes || []).map((c: string) => objectsByCode[c]).filter(Boolean);
    return (
      <div>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>{view.viewName || view.viewCode}</span>
          <span className={styles.mono}>{view.viewCode}</span>
        </div>
        {view.description && <div className={styles.desc}>{view.description}</div>}
        <div className={styles.sectionTitle}>{t('ontologyCenter.detail.viewProperties')}</div>
        <Table
          size="small"
          tableLayout="fixed"
          rowKey={(r: any, i) => `${r.propertyCode || ''}-${i}`}
          dataSource={view.properties || []}
          pagination={false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          columns={[
            { title: t('ontologyCenter.detail.col.name'), dataIndex: 'propertyName', ellipsis: true },
            {
              title: t('ontologyCenter.detail.col.code'),
              dataIndex: 'propertyCode',
              ellipsis: true,
              render: (v: string) => <span className={styles.mono}>{v}</span>,
            },
            {
              title: t('ontologyCenter.detail.col.source'),
              ellipsis: true,
              render: (_: any, r: any) => (
                <span className={styles.mono} style={{ color: '#888' }}>
                  {r.sourceObject}
                  {r.sourceObjectProperty ? `.${r.sourceObjectProperty}` : ''}
                </span>
              ),
            },
          ]}
        />
        <div className={styles.sectionTitle}>
          {t('ontologyCenter.detail.objectList')} ({viewObjects.length})
        </div>
        <div className={styles.entityList}>
          {viewObjects.length ? (
            viewObjects.map((o: any) => (
              <div key={o.objectCode} className={styles.actionRow}>
                <span className={styles.actionName}>{o.objectName || o.objectCode}</span>
                <span className={styles.mono} style={{ marginLeft: 'auto', color: '#999' }}>
                  {o.objectCode}
                </span>
              </div>
            ))
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </div>
      </div>
    );
  };

  const title =
    type === 'object'
      ? obj?.objectName || obj?.objectCode
      : view?.viewName || view?.viewCode || t('ontologyCenter.detail.title');

  return (
    <Drawer width={560} open={open} onClose={onClose} title={title}>
      {type === 'object' && renderObject()}
      {type === 'view' && renderView()}
    </Drawer>
  );
};

export default EntityDetailDrawer;
