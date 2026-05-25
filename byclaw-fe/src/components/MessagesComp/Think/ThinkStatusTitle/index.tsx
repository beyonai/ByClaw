import { CheckOutlined, CloseOutlined, ExclamationCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import classnames from 'classnames';
import React, { useMemo, useCallback } from 'react';
import { theme, Drawer, ConfigProvider } from 'antd';
import { RawIntlProvider, getIntl, useIntl } from '@umijs/max';
import { createRoot } from 'react-dom/client';
import { get } from 'lodash';
import MyIcon from '@/components/AntdIcon';
import { SSEMessageType } from '@/constants/message';

import styles from './index.module.less';
import type { TreeNode } from '@/components/MessageList/components/ThinkingProcessRender/typescript';

export type IMessageListItemContent = {
  substance: {
    title?: string;
    status: '_START_' | '_DONE_' | '_ERROR_';
  };
};

export type IProps = {
  messageListItemContent: IMessageListItemContent;
  thinkListItem: TreeNode;
};

function extractErrorDetail(thinkListItem: TreeNode): string | null {
  const children = thinkListItem?.children;
  if (!children || !Array.isArray(children)) return null;

  for (const child of children) {
    if (`${child.contentType}` !== `${SSEMessageType.jsonBlock}`) continue;
    const substance = get(child, 'content.substance');
    if (!substance) continue;

    let jsonStr = typeof substance === 'string' ? substance : substance?.json;
    if (!jsonStr) continue;

    try {
      const parsed = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
      if (parsed?.errorDetail) {
        return typeof parsed.errorDetail === 'string'
          ? parsed.errorDetail
          : JSON.stringify(parsed.errorDetail, null, 2);
      }
    } catch {
      // ignore parse errors
    }
  }
  return null;
}

function openErrorDrawer(detail: string, title: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const destroy = () => {
    root.unmount();
    container.remove();
  };

  let parsed: any;
  let formattedJson: string;
  try {
    parsed = JSON.parse(detail);
    formattedJson = JSON.stringify(parsed, null, 2);
  } catch {
    formattedJson = detail;
  }

  const DrawerContent = () => {
    const [open, setOpen] = React.useState(true);
    const intl = getIntl();
    return (
      <RawIntlProvider value={intl}>
        <ConfigProvider prefixCls="beyond">
          <Drawer
            title={title}
            open={open}
            onClose={() => {
              setOpen(false);
              setTimeout(destroy, 300);
            }}
            width="50%"
            destroyOnClose
          >
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                margin: 0,
                padding: 16,
                background: '#f5f5f5',
                borderRadius: 8,
                fontSize: 13,
                lineHeight: 1.6,
                fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
              }}
            >
              {formattedJson}
            </pre>
          </Drawer>
        </ConfigProvider>
      </RawIntlProvider>
    );
  };

  root.render(<DrawerContent />);
}

function ThinkStatusTitleV2(props: { status?: string; text: string; thinkListItem: TreeNode }) {
  const { status, thinkListItem } = props;
  const intl = useIntl();
  const {
    token: { colorSuccess, colorError, colorWarning },
  } = theme.useToken();
  const isLoading = status !== '_DONE_' && status !== '_ERROR_';

  const errorDetail = useMemo(() => extractErrorDetail(thinkListItem), [thinkListItem]);

  const handleIconClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      if (errorDetail) {
        openErrorDrawer(errorDetail, intl.formatMessage({ id: 'thinkStatus.errorDetail' }));
      }
    },
    [errorDetail, intl]
  );

  return (
    <div className={classnames(styles.thinkingTitleV2, 'ub ub-ac')}>
      <MyIcon type="icon-a-Toolgongju" style={{ fontSize: '18px', marginRight: '6px' }} />
      <div className={styles.titleTextV2}>
        <span style={{ marginRight: 10 }}>{props.text}</span>
        {isLoading && <LoadingOutlined />}
        {errorDetail ? (
          <span onClick={handleIconClick} onMouseDown={(e) => e.stopPropagation()}>
            <ExclamationCircleOutlined style={{ color: colorWarning, cursor: 'pointer' }} />
          </span>
        ) : (
          <>
            {status === '_DONE_' && <CheckOutlined style={{ color: colorSuccess }} />}
            {status === '_ERROR_' && <CloseOutlined style={{ color: colorError }} />}
          </>
        )}
      </div>
    </div>
  );
}

function ThinkStatusTitle(props: IProps) {
  const { messageListItemContent, thinkListItem } = props;

  const { substance } = messageListItemContent;
  let status = '';
  let title;
  if (typeof substance === 'string') {
    title = substance;
    status = '_DONE_';
  } else if (substance && typeof substance === 'object') {
    ({ title, status } = substance);
  }

  return <ThinkStatusTitleV2 status={status} text={title || ''} thinkListItem={thinkListItem} />;
}

export default ThinkStatusTitle;
