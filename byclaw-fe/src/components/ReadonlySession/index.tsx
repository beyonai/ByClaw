import React from 'react';
import { Spin } from 'antd';

import { fetchMessage } from '@/models/useMessageStore';
import { PreviewMessageRenderer } from '@/components/ReplayTemplate';
import type { IMessage } from '@/typescript/message';

import styles from './index.module.less';

type IProps = {
  sessionInfo: {
    sessionId: string;
    sessionName: string;
  };
  onClose?: () => void;
  // FullAbsoluteDrawer 会统一透传这两个回调,只读会话用不到,声明为可选以兼容其容器类型。
  onUpdateMessage?: (payload: any) => void;
  onCreateMessage?: (payload: any) => void;
};

/**
 * 只读会话查看:按 sessionId 一次性拉取历史消息,复用回放的 preview 渲染骨架(layoutMode=preview、无输入框、禁用消息内交互)。
 * 与回放的区别:数据源用通用的 getMessages(assiman) 而非模板专用接口,且不做逐条打字机回放,直接铺出全部历史。
 * 场景:同项目成员只读查看别人的研发任务会话——能看消息,不能对话。
 */
const ReadonlySession = (props: IProps) => {
  const { sessionInfo } = props;
  const { sessionId } = sessionInfo;

  const [list, setList] = React.useState<IMessage[]>([]);
  const [loading, setLoading] = React.useState(true);

  const layoutRef = React.useRef<HTMLDivElement>(null);
  const scrollMessageRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // 一次性拉较多历史,只读查看无需分页加载;fetchMessage 已按时间线排序并过滤空消息。
    fetchMessage({ sessionId: `${sessionId}`, pageNum: 1, pageSize: 200 })
      .then((res: any) => {
        if (cancelled) return;
        setList(res?.list || []);
      })
      .catch(() => {
        if (!cancelled) setList([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div className={styles.readonlySession} ref={layoutRef}>
      {loading ? (
        <div className={styles.loading}>
          <Spin />
        </div>
      ) : (
        <PreviewMessageRenderer
          sessionInfo={sessionInfo}
          list={list}
          layoutRef={layoutRef}
          forwardScrollMessageRef={scrollMessageRef}
        />
      )}
    </div>
  );
};

export default ReadonlySession;
