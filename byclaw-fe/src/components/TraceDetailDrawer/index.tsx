// @ts-nocheck
// Shared single-trace detail drawer. Used by the chat surface (MoreActions
// "View trace") and reusable from anywhere a traceId is in hand. Renders the
// trace's input/output (timeline basic info) plus an "Open in Langfuse"
// external link when host + projectId are configured.
import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { Button, Drawer, DrawerProps, Empty, Spin, Tooltip, message } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
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

// Response from getTraceTimelineBasicInfo can be either { traceInfo: {...} }
// or { data: { traceInfo: {...} } } depending on request layer config; tolerate both.
const pickTraceInfo = (raw: any) => raw?.traceInfo || raw?.data?.traceInfo || raw;

export default function TraceDetailDrawer({ open, traceId, agentName, onClose, ...rest }: TraceDetailDrawerProps) {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const [traceInfo, setTraceInfo] = useState<any>(null);

  const config = useLangfuseConfigStore((s) => s.config);
  const ensureConfigLoaded = useLangfuseConfigStore((s) => s.ensureLoaded);

  useEffect(() => {
    if (!open) return;
    // Lazy-load /langfuse/config the first time the drawer is opened in a session.
    void ensureConfigLoaded();
  }, [open, ensureConfigLoaded]);

  useEffect(() => {
    if (!open || !traceId) {
      setTraceInfo(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getTraceTimelineBasicInfo({ traceId })
      .then((res: any) => {
        if (cancelled) return;
        setTraceInfo(pickTraceInfo(res));
      })
      .catch(() => {
        if (cancelled) return;
        setTraceInfo(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, traceId]);

  const externalUrl = useMemo(() => buildLangfuseTraceUrl(config?.host, config?.projectId, traceId), [config, traceId]);

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
          {traceInfo ? (
            <Fragment>
              {traceInfo.input !== null ? (
                <div className={ss.block}>
                  <div className={ss.blockTitle}>{intl.formatMessage({ id: 'traceDetail.input' })}</div>
                  <div className={ss.bubble}>
                    <Markdown
                      content={
                        typeof traceInfo.input === 'string' ? traceInfo.input : JSON.stringify(traceInfo.input, null, 2)
                      }
                    />
                  </div>
                </div>
              ) : null}
              {traceInfo.output !== null ? (
                <div className={ss.block}>
                  <div className={ss.blockTitle}>
                    {agentName || intl.formatMessage({ id: 'traceDetail.defaultAgentName' })}
                  </div>
                  <div className={ss.bubble}>
                    <Markdown
                      content={
                        typeof traceInfo.output === 'string'
                          ? traceInfo.output
                          : JSON.stringify(traceInfo.output, null, 2)
                      }
                    />
                  </div>
                </div>
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
