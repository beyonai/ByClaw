// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Drawer, Empty, Spin, Table, Tag } from 'antd';
import { CloseOutlined, PaperClipOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import { getOntologyObjectDetail, getOntologyViewDetail } from '@/service/ontology';
import styles from './OntologyDetailDrawer.module.less';

const getData = (res: any) => res?.data ?? res ?? [];

const DATA_TYPE_COLOR: Record<string, string> = {
  STRING: 'orange',
  BIGINT: 'blue',
  INTEGER: 'blue',
  DOUBLE: 'geekblue',
  BOOLEAN: 'purple',
  DATE: 'green',
};

/**
 * 本体节点详情抽屉：从左侧列表或卡片点击节点名打开，按视图/对象展示详情。
 */
const OntologyNodeDrawer = ({
  open,
  node,
  panel = false,
  showReference = true,
  onReference,
  onClose,
  systemCode,
}: {
  open: boolean;
  node: any;
  baseId?: string;
  ownerType?: string;
  systemCode?: string;
  panel?: boolean;
  showReference?: boolean;
  onReference?: () => void;
  onClose: () => void;
}) => {
  const intl = useIntl();
  const t = (id: string, v?: any) => intl.formatMessage({ id }, v);
  const { EventEmitter } = useGlobal();

  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any>({});

  const level = node?.level;

  useEffect(() => {
    if (!open || !node) return;
    setLoading(true);
    if ((level === 'OBJECT_IN_SCENE' || level === 'OBJECT_IN_VIEW') && node?.objectCode) {
      getOntologyObjectDetail({ objectCode: node.objectCode, systemCode: systemCode || node.systemCode })
        .then((res) => {
          const d = getData(res);
          setDetail(d && typeof d === 'object' && !Array.isArray(d) ? { objects: [d] } : {});
        })
        .catch(() => setDetail({}))
        .finally(() => setLoading(false));
      return;
    }
    if (level === 'VIEW' && node?.viewCode) {
      getOntologyViewDetail({ viewCode: node.viewCode, systemCode: systemCode || node.systemCode })
        .then((res) => {
          const d = getData(res);
          setDetail(d && typeof d === 'object' && !Array.isArray(d) ? { views: [d] } : {});
        })
        .catch(() => setDetail({}))
        .finally(() => setLoading(false));
      return;
    }
    setDetail({});
    setLoading(false);
  }, [open, level, node?.viewCode, node?.objectCode, node?.systemCode, systemCode]);

  const nodeName = useMemo(() => {
    if (!node) return '';
    if (level === 'VIEW') return node.viewName || node.viewCode;
    return node.objectName || node.objectCode;
  }, [node, level]);

  const nodeCode = useMemo(() => {
    if (!node) return '';
    if (level === 'VIEW') return node.viewCode;
    return node.objectCode;
  }, [node, level]);

  const titleByLevel: Record<string, string> = {
    VIEW: t('ontologyNode.title.view'),
    OBJECT_IN_SCENE: t('ontologyNode.title.object'),
    OBJECT_IN_VIEW: t('ontologyNode.title.object'),
  };

  // ============ 对话联动 ============
  const insertToChat = () => {
    if (onReference) {
      onReference();
      onClose();
      return;
    }
    EventEmitter?.emit('queryInput-set-value', { inputTxt: `@${nodeName} `, isInsert: true });
    onClose();
  };

  // ============ 属性表 ============
  const propertyTable = (properties: any[] = []) => (
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
          title: t('ontologyCenter.detail.col.type'),
          dataIndex: 'dataType',
          width: 88,
          render: (v: string) => (v ? <Tag color={DATA_TYPE_COLOR[v] || 'default'}>{v}</Tag> : '-'),
        },
        {
          title: t('ontologyCenter.detail.col.constraint'),
          width: 96,
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

  // ============ 各类型内容 ============
  const renderBody = () => {
    if (!node) return null;
    const objects = detail?.objects || [];
    const views = detail?.views || [];

    if (level === 'VIEW') {
      const view = views.find((v: any) => v.viewCode === node.viewCode) || {};
      return (
        <>
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
        </>
      );
    }

    if (level !== 'OBJECT_IN_SCENE' && level !== 'OBJECT_IN_VIEW') {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    }

    // OBJECT
    const obj = objects.find((o: any) => o.objectCode === node.objectCode) || {};
    return (
      <>
        <div className={styles.panelTags}>
          {obj.conceptType === '2' ? (
            <Tag color="purple">{t('ontologyCenter.detail.conceptActivity')}</Tag>
          ) : (
            <Tag color="geekblue">{t('ontologyCenter.detail.conceptEntity')}</Tag>
          )}
          {obj.objectSource && <Tag color="cyan">{obj.objectSource}</Tag>}
        </div>
        {obj.objectDesc && <div className={styles.desc}>{obj.objectDesc}</div>}
        <div className={styles.sectionTitle}>{t('ontologyCenter.detail.attributes')}</div>
        {propertyTable(obj.properties)}
      </>
    );
  };

  const footer = showReference ? (
    <div className={styles.nodeFooter}>
      <Button icon={<PaperClipOutlined />} onClick={insertToChat}>
        {t('ontologyNode.action.reference')}
      </Button>
    </div>
  ) : null;

  const content = (
    <>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>{nodeName}</span>
        {nodeCode && <span className={styles.mono}>{nodeCode}</span>}
      </div>
      <Spin spinning={loading}>{renderBody()}</Spin>
    </>
  );

  if (panel) {
    if (!open) return null;
    return (
      <div className={styles.nodePanel}>
        <div className={styles.nodePanelHeader}>
          <span>{titleByLevel[level] || t('ontologyCenter.detail.title')}</span>
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
        </div>
        <div className={styles.nodePanelBody}>{content}</div>
        {footer && <div className={styles.nodePanelFooter}>{footer}</div>}
      </div>
    );
  }

  return (
    <Drawer
      width={480}
      open={open}
      onClose={onClose}
      title={titleByLevel[level] || t('ontologyCenter.detail.title')}
      footer={footer || undefined}
    >
      {content}
    </Drawer>
  );
};

export default OntologyNodeDrawer;
