// @ts-nocheck
import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { Button, Drawer, DrawerProps, Empty, Spin, Tag, Tooltip, message } from 'antd';
import { DownOutlined, ExportOutlined, RightOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';

import Markdown from '@/components/Markdown';
import { buildLangfuseTraceUrl, getTraceTimelineBasicInfo } from '@/service/langfuse';
import { useLangfuseConfigStore } from '@/models/common/useLangfuseConfigStore';

import ss from './styles.module.less';

interface TraceDetailDrawerProps extends Omit<DrawerProps, 'onClose'> {
  open: boolean;
  traceId?: string;
  agentName?: string;
  onClose: () => void;
}

const pickTraceData = (raw: any) => raw?.data || raw;

const stringifyContent = (value: any) => {
  if (value === undefined || value === null || value === '') return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

const hasRenderableContent = (value: any) => {
  const content = stringifyContent(value);
  return typeof content === 'string' && content.trim().length > 0;
};

const formatLatency = (value: any) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') {
    return value >= 100 ? `${Math.round(value)}ms` : `${Math.round(value * 1000)}ms`;
  }
  return `${value}`;
};

function TimelineNode({ node, depth = 0 }: { node: any; depth?: number }) {
  const [contentOpen, setContentOpen] = useState(false);
  const children = Array.isArray(node?.children) ? node.children : [];
  const latency = formatLatency(node?.latency);
  const inputPreview = stringifyContent(node?.input);
  const outputPreview = stringifyContent(node?.output);
  const preview = inputPreview.trim() ? inputPreview : outputPreview;
  const hasPreview = preview.trim().length > 0;

  return (
    <div className={ss.timelineNode} style={{ marginLeft: depth ? 18 : 0 }}>
      <div className={ss.timelineHeader}>
        <Tag color={node?.type === 'GENERATION' ? 'blue' : 'default'}>{node?.type || 'OBSERVATION'}</Tag>
        <span className={ss.timelineName}>{node?.name || node?.id || 'unknown'}</span>
        {node?.status ? <Tag color={node.status === 'ERROR' ? 'red' : 'green'}>{node.status}</Tag> : null}
        {latency ? <span className={ss.timelineMeta}>{latency}</span> : null}
        {hasPreview ? (
          <Button
            type="link"
            size="small"
            className={ss.timelineToggle}
            icon={contentOpen ? <DownOutlined /> : <RightOutlined />}
            aria-label={contentOpen ? 'Collapse content' : 'Expand content'}
            onClick={() => setContentOpen((prev) => !prev)}
          />
        ) : null}
      </div>
      {node?.model ? <div className={ss.timelineMeta}>model: {node.model}</div> : null}
      {hasPreview && contentOpen ? <pre className={ss.timelinePreview}>{preview}</pre> : null}
      {children.length > 0 ? (
        <div className={ss.timelineChildren}>
          {children.map((child: any, index: number) => (
            <TimelineNode key={child?.id || `${node?.id || 'node'}-${index}`} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function TraceDetailDrawer({ open, traceId, agentName, onClose, ...rest }: TraceDetailDrawerProps) {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const [traceData, setTraceData] = useState<any>(null);

  const config = useLangfuseConfigStore((s) => s.config);
  const ensureConfigLoaded = useLangfuseConfigStore((s) => s.ensureLoaded);

  useEffect(() => {
    if (!open) return;
    void ensureConfigLoaded();
  }, [open, ensureConfigLoaded]);

  useEffect(() => {
    if (!open || !traceId) {
      setTraceData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getTraceTimelineBasicInfo({ traceId })
      .then((res: any) => {
        if (cancelled) return;
        setTraceData(pickTraceData(res));
      })
      .catch(() => {
        if (cancelled) return;
        setTraceData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, traceId]);

  const externalUrl = useMemo(() => buildLangfuseTraceUrl(config?.host, config?.projectId, traceId), [config, traceId]);
  const traceInfo = traceData?.traceInfo || traceData;
  const timeline = Array.isArray(traceData?.timeline) ? traceData.timeline : [];
  const hasInput = hasRenderableContent(traceInfo?.input);
  const hasOutput = hasRenderableContent(traceInfo?.output);

  const handleOpenExternal = () => {
    if (!externalUrl) {
      message.info(intl.formatMessage({ id: 'traceDetail.externalUrlMissing' }));
      return;
    }
    window.open(externalUrl, '_blank', 'noopener,noreferrer');
  };

  const title = (
    <div className={ss.titleBar}>
      <span>{intl.formatMessage({ id: 'traceDetail.title' })}</span>
      {externalUrl ? (
        <Tooltip title={intl.formatMessage({ id: 'traceDetail.openInLangfuseTooltip' })}>
          <Button type="link" size="small" icon={<ExportOutlined />} onClick={handleOpenExternal}>
            {intl.formatMessage({ id: 'traceDetail.openInLangfuse' })}
          </Button>
        </Tooltip>
      ) : null}
    </div>
  );

  return (
    <Drawer
      open={open}
      width="min(100vw, 1120px)"
      onClose={onClose}
      title={title}
      className={ss.drawer}
      bodyStyle={{ padding: 0 }}
      {...rest}
    >
      <Spin spinning={loading}>
        <section className={ss.main}>
          {traceData ? (
            <Fragment>
              {hasInput ? (
                <div className={ss.block}>
                  <div className={ss.blockTitle}>{intl.formatMessage({ id: 'traceDetail.input' })}</div>
                  <div className={ss.bubble}>
                    <Markdown text={stringifyContent(traceInfo.input)} markdownClass={ss.markdown} />
                  </div>
                </div>
              ) : null}
              {timeline.length > 0 ? (
                <div className={ss.block}>
                  <div className={ss.blockTitle}>{intl.formatMessage({ id: 'traceDetail.timeline' })}</div>
                  <div className={ss.timeline}>
                    {timeline.map((node: any, index: number) => (
                      <TimelineNode key={node?.id || `root-${index}`} node={node} />
                    ))}
                  </div>
                </div>
              ) : null}
              {hasOutput ? (
                <div className={ss.block}>
                  <div className={ss.blockTitle}>
                    {agentName || intl.formatMessage({ id: 'traceDetail.defaultAgentName' })}
                  </div>
                  <div className={ss.bubble}>
                    <Markdown text={stringifyContent(traceInfo.output)} markdownClass={ss.markdown} />
                  </div>
                </div>
              ) : null}
              {timeline.length === 0 && !hasOutput ? (
                <Empty description={intl.formatMessage({ id: 'traceDetail.empty' })} />
              ) : null}
              {traceId ? (
                <div className={ss.meta}>
                  <span className={ss.metaLabel}>traceId</span>
                  <span className={ss.metaValue}>{traceId}</span>
                </div>
              ) : null}
            </Fragment>
          ) : !loading ? (
            <Empty description={intl.formatMessage({ id: 'traceDetail.empty' })} />
          ) : null}
        </section>
      </Spin>
    </Drawer>
  );
}
