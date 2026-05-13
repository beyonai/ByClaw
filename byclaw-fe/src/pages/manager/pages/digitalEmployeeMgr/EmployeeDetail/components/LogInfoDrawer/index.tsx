// @ts-nocheck
/* eslint-disable max-len,no-confusing-arrow,function-paren-newline,indent,quotes,comma-dangle,semi,quotes,@typescript-eslint/no-unused-vars,key-spacing,comma-spacing,no-trailing-spaces */
import React, { useState, useEffect, Fragment } from 'react';
import { Drawer, DrawerProps, Spin } from 'antd';
import { getLangfuseFlow, getTraceTimelineBasicInfo } from '@/pages/manager/service/langfuse';
import AvatarImg from '@/pages/manager/assets/Avatar.png';
import MarkDown from '../MarkDown';
import { useIntl } from '@umijs/max';
import ss from './styles.module.less';

interface LogInfoDrawerProps extends DrawerProps {
  log: any;
}

export default function LogInfoDrawer({ onClose, log }: LogInfoDrawerProps) {
  const intl = useIntl();
  const [traces, setTraces] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(false);

  const onRefresh = async (params: any) => {
    setTraces({});
    setLoading(true);
    const flows = await getLangfuseFlow(params);
    setLoading(false);
    if (!flows?.tracesInfo?.traces) {
      return;
    }
    flows.tracesInfo.traces.map(async (trace: any, i: number) => {
      const traceInfo = await getTraceTimelineBasicInfo({ traceId: trace.id });
      if (traceInfo) {
        setTraces((prev) => ({ ...prev, [i]: traceInfo }));
      }
    });
  };

  useEffect(() => {
    if (log?.sessionId) {
      onRefresh({ sessionId: log.sessionId, resMsgId: log.resMsgId });
    }
    return () => {
      setTraces({});
    };
  }, [log]);

  return (
    <Drawer
      open={!!log}
      width="min(100vw, 1220px)"
      onClose={onClose}
      title={intl.formatMessage({ id: 'employeeDetail.logInfoDrawer.conversationContent' })}
      className={ss.drawer}
      bodyStyle={{ padding: 0 }}
    >
      <Spin spinning={loading}>
        <section className={ss.main}>
          <div className={ss.mainLeft}>
            {Object.entries(traces).map(([i, trace]) => (
              <Fragment key={i}>
                <div className={ss.input}>
                  <div className={ss.buble}>
                    <MarkDown content={trace.traceInfo?.input} />
                  </div>
                </div>
                <div className={ss.output}>
                  <div className={ss.item}>
                    <div className={ss.title}>
                      <div className={ss.avatar}>
                        <img alt="" src={AvatarImg} width={32} height={32} />
                      </div>
                      <div className={ss.agent}>
                        {log?.agentName || intl.formatMessage({ id: 'employeeDetail.logInfoDrawer.defaultAgentName' })}
                      </div>
                      <span className={ss.tag}>
                        {log?.agentType === '001'
                          ? intl.formatMessage({ id: 'dialogueRecord.superAssistant' })
                          : intl.formatMessage({ id: 'common.digitalEmployee' })}
                      </span>
                    </div>
                  </div>
                  <div className={ss.buble}>
                    <MarkDown content={trace.traceInfo?.output} />
                  </div>
                </div>
              </Fragment>
            ))}

            {(!!log?.feedbackContent || log?.feedbackLabels) && (
              <div className={ss.feedback}>
                <div className={ss.feedbackTitle}>
                  {intl.formatMessage({ id: 'employeeDetail.logInfoDrawer.userFeedback' })}
                </div>
                <div className={ss.feedbackTags}>
                  {log?.feedbackLabels?.map((tag: any, i: number) => (
                    <span key={i}>{tag}</span>
                  ))}
                </div>
                <div className={ss.feedbackMessage}>{log.feedbackContent}</div>
              </div>
            )}
          </div>
        </section>
      </Spin>
    </Drawer>
  );
}
