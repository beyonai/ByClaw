import React, { useEffect, useRef } from 'react';
import { message, Tooltip } from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  DownOutlined,
  FileTextOutlined,
  LoadingOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import classnames from 'classnames';
import { get, isNil } from 'lodash';
import { SSEEventStatus } from '@/constants/message';
import { copyTextToClipboard } from '@/utils/copy';

import AgentTeamsActivity, { isAgentTeamsSnapshot, type AgentTeamsSnapshot } from './AgentTeamsActivity';
import styles from './index.module.less';

/** 工具调用状态。'_ERROR_' 由算法侧在调用失败时下发，与其他 think 类组件的口径一致 */
export type IToolCallStatus = '_START_' | '_QUERY_' | '_DONE_' | '_ERROR_';

export type IToolCallSubstance = {
  // 由后端拼好的展示标题，形如「调用工具: Bash」
  title?: string;

  // 工具入参。字符串直接展示，对象格式化后展示
  input?: unknown;

  // 工具结果。首帧通常没有，等携带结果的后续帧到达后才有
  output?: unknown;

  status?: IToolCallStatus;

  description?: string;

  source?: string;
  schemaVersion?: number;
  eventKind?: string;
  team?: AgentTeamsSnapshot['team'];
  archived?: boolean;
  capturedAt?: string;
};

export type IProps = {
  messageListItemContent?: {
    substance?: IToolCallSubstance | string;
  };
};

/** 把入参/结果统一成可展示的文本。对象与数组格式化输出，便于阅读多行 JSON 结果 */
const formatDetail = (value: unknown): string => {
  if (isNil(value)) return '';
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch (e) {
    return `${value}`;
  }
};

/**
 * 工具调用消息。
 *
 * 一次调用的入参与结果分多帧到达，共用同一个 orderId（tool_call_id），归并成一条消息后交给这里渲染，
 * 因此组件只负责呈现当前 substance 的快照，不自己维护跨帧状态：结果与状态由归并层写进同一个
 * substance，组件随之重渲染。归并逻辑见 ThinkingProcessRender/util 的 coverExistedNodeHandlers。
 *
 * 结果尚未到达时（status 仍是 _START_ / _QUERY_）展示运行中图标，只渲染入参。
 */
function ToolCall(props: IProps) {
  const intl = useIntl();

  const substance = get(props, 'messageListItemContent.substance');

  // 兼容纯文本 substance：拿不到结构化字段时整体当作标题，至少不丢内容
  const { title, input, output, status, description } =
    typeof substance === 'string' ? ({ title: substance } as IToolCallSubstance) : substance || {};

  const inputText = formatDetail(input);
  const outputText = formatDetail(output);
  const hasDetail = Boolean(inputText || outputText);
  const isContextEvent = typeof substance !== 'string' && substance?.eventKind === 'context';

  // 标签里只放工具名。后端下发的 title 形如「调用工具: Bash」，前缀由标签自带的图标表达
  const toolName = title ?? '';

  const isRunning = status !== SSEEventStatus.done && status !== '_ERROR_';
  const [expanded, setExpanded] = React.useState(isRunning);
  const [copiedSection, setCopiedSection] = React.useState<'input' | 'output' | null>(null);
  const copyFeedbackTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setExpanded(isRunning);
  }, [isRunning]);

  useEffect(
    () => () => {
      if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current);
    },
    []
  );

  /** 复制后短暂显示对勾，让用户无需依赖全局提示判断操作是否成功。 */
  const handleCopy = (section: 'input' | 'output', text: string) => {
    copyTextToClipboard(
      text,
      () => {
        setCopiedSection(section);
        message.success(intl.formatMessage({ id: 'common.copySuccess' }));

        if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current);
        copyFeedbackTimer.current = setTimeout(() => setCopiedSection(null), 1600);
      },
      () => message.error(intl.formatMessage({ id: 'common.copyFail' }))
    );
  };

  const renderSection = (section: 'input' | 'output', text: string, labelId?: string) => {
    const copied = copiedSection === section;

    return (
      <div className={classnames(styles.section, { [styles.outputSection]: section === 'output' })}>
        <div className={styles.sectionLabel}>{intl.formatMessage({ id: labelId ?? `toolCall.${section}` })}</div>
        <div className={styles.sectionContent}>
          <Tooltip title={intl.formatMessage({ id: copied ? 'common.copySuccess' : 'common.copy' })} placement="top">
            <button
              type="button"
              className={classnames(styles.copyButton, { [styles.copyButtonDone]: copied })}
              aria-label={intl.formatMessage({ id: 'common.copy' })}
              onClick={() => handleCopy(section, text)}
            >
              {copied ? <CheckOutlined /> : <CopyOutlined />}
            </button>
          </Tooltip>
          <pre className={styles.sectionBody}>{text}</pre>
        </div>
      </div>
    );
  };

  if (isAgentTeamsSnapshot(substance)) {
    return <AgentTeamsActivity snapshot={substance} />;
  }

  return (
    <div
      className={classnames(styles.toolCall, {
        [styles.doneCall]: status === SSEEventStatus.done,
        [styles.errorCall]: status === '_ERROR_',
        [styles.contextEvent]: isContextEvent,
      })}
    >
      <div
        className={classnames(styles.header, 'ub ub-ac', { pointer: hasDetail })}
        onClick={() => {
          if (!hasDetail) return;
          setExpanded((prevExpanded) => !prevExpanded);
        }}
      >
        {isContextEvent && <FileTextOutlined className={classnames(styles.statusIcon, styles.contextIcon)} />}
        {!isContextEvent && isRunning && <LoadingOutlined className={styles.statusIcon} />}
        {!isContextEvent && status === SSEEventStatus.done && (
          <CheckOutlined className={classnames(styles.statusIcon, styles.done)} />
        )}
        {status === '_ERROR_' && <CloseOutlined className={classnames(styles.statusIcon, styles.error)} />}
        <span className={styles.toolIdentity}>{toolName || intl.formatMessage({ id: 'toolCall.defaultTitle' })}</span>
        {description && <span className={styles.description}>{description}</span>}
        {hasDetail && <span className={styles.collapseIcon}>{expanded ? <DownOutlined /> : <RightOutlined />}</span>}
      </div>

      {expanded && hasDetail && (
        <div className={styles.detail}>
          {inputText && renderSection('input', inputText, isContextEvent ? 'contextEvent.input' : undefined)}
          {outputText && renderSection('output', outputText, isContextEvent ? 'contextEvent.input' : undefined)}
          <button type="button" className={styles.collapseButton} onClick={() => setExpanded(false)}>
            {intl.formatMessage({ id: 'toolCall.collapse' })}
            <DownOutlined className={styles.collapseButtonIcon} />
          </button>
        </div>
      )}
    </div>
  );
}

export default ToolCall;
