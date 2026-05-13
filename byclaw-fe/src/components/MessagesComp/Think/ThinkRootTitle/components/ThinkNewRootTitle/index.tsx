import React, { useRef, useState, useMemo, Suspense } from 'react';

import { CheckCircleFilled, DownOutlined, InfoCircleFilled, UpOutlined } from '@ant-design/icons';
import classnames from 'classnames';
import { get, isBoolean, isEmpty, size } from 'lodash';
import { SSEMessageType } from '@/constants/message';

import lazyHandler from '@/components/MessageList/lazyHandler';
import ThinkingProcessItemRender from '@/components/MessageList/components/ThinkingProcessRender/components/ThinkingProcessItemRender/index';

import type { IMessage, NewIMessageListItem } from '@/typescript/message';
import type { TreeNode } from '@/components/MessageList/components/ThinkingProcessRender/typescript';

import { isTextContentType } from '@/utils/messgae';

import styles from './index.module.less';

type IProps = {
  message: IMessage;
  treeNode: TreeNode;
  updateMessageListItemContent: (path: string, val: any) => void;
};

interface CollapsibleSectionProps {
  children: React.ReactNode[];
  treeNode: TreeNode;
  message: IMessage;
  updateMessageListItemNewContent: (path: string, val: any) => void;
}
interface CollapsibleItemProps {
  item: NewIMessageListItem;
  parentTreeNode?: TreeNode;
  message: IMessage;
  updateMessageListItemNewContent: (path: string, val: any) => void;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = React.memo(
  ({ children, treeNode, message, updateMessageListItemNewContent }) => {
    const { isCollapsed = false, messageLoadingStatus = 2, contentType, messageIdx } = treeNode;
    const title = get(treeNode, 'content.substance', '');

    const [isParentCollapsed, setIsParentCollapsed] = React.useState(isCollapsed);
    const isManualChangeRef = React.useRef(false);

    const hasChildren = !!children && Array.isArray(children) && size(children) > 0;

    const thinkRootTitleHeaderComp = useMemo(() => {
      return (
        <>
          <div>
            {messageLoadingStatus === 2 ? (
              <InfoCircleFilled style={{ fontSize: '14px' }} />
            ) : (
              <CheckCircleFilled style={{ fontSize: '14px' }} />
            )}
          </div>
          <div className={classnames(styles.titleText)}>{title}</div>
        </>
      );
    }, [messageLoadingStatus, contentType, title]);

    const HeaderComp = useMemo(() => {
      if (`${contentType}` === `${SSEMessageType.thinkRootTitle}`) {
        return thinkRootTitleHeaderComp;
      }
      const Comp = lazyHandler.lazyComp(`${contentType}`);
      if (!Comp) return null;
      return (
        <Suspense fallback={null}>
          <Comp
            messageListItemContent={treeNode.content}
            key={`${message?.msgId}_think_${messageIdx}`}
            message={message}
            thinkListItem={treeNode}
            messageIdx={messageIdx}
            updateMessageListItem={(path: string, val: any) => {
              updateMessageListItemNewContent(`${messageIdx}.${path}`, val);
            }}
          />
        </Suspense>
      );
    }, [contentType, thinkRootTitleHeaderComp, message, messageIdx, treeNode]);

    React.useEffect(() => {
      if (isManualChangeRef.current) return;
      setIsParentCollapsed(isCollapsed);
    }, [isCollapsed]);

    return (
      <div style={{ width: '100%' }}>
        <div
          className={classnames(styles.thinkingTitle, 'ub gap4 pointer')}
          onClick={() => {
            isManualChangeRef.current = true;
            setIsParentCollapsed(!isParentCollapsed);
          }}
        >
          {HeaderComp}
          {hasChildren && (
            <div className={classnames(styles.collapseIcon, 'ub ub-ac ub-pc')}>
              {isParentCollapsed ? <DownOutlined /> : <UpOutlined />}
            </div>
          )}
        </div>

        {!isParentCollapsed && <div className={styles.sectionContent}>{children}</div>}
      </div>
    );
  }
);

const CollapsibleItem: React.FC<CollapsibleItemProps> = React.memo(
  ({ item, message, parentTreeNode = {}, updateMessageListItemNewContent }) => {
    // 在组件内部添加状态和ref
    const itemChildHeaderRef = useRef<HTMLDivElement>(null);

    const isManualChangeRef = React.useRef(false);
    const isMouseOverRef = React.useRef(false);
    const isFinishedRef = React.useRef(false);

    const [needsGradient, setNeedsGradient] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(item.isCollapsed ?? false);

    const hasChildren = item.children && item.children.length > 0;
    const isBigSmartOffice = `${parentTreeNode?.contentType}` === `${SSEMessageType.thinkRootTitle}`;

    const hasTextChild = React.useMemo(() => {
      return item.children?.some((child) => isTextContentType(`${child.contentType}`));
    }, [item.children]);

    React.useEffect(() => {
      if (!isBoolean(item.isCollapsed)) return;

      isFinishedRef.current = item.isCollapsed;

      if (isManualChangeRef.current) return;
      setIsCollapsed(item.isCollapsed);
    }, [item.isCollapsed]);

    React.useEffect(() => {
      if (!hasTextChild) return;

      const autoScroll = () => {
        if (!itemChildHeaderRef.current || isFinishedRef.current) return false;

        const element = itemChildHeaderRef.current;
        const hasOverflow = element.scrollHeight > element.clientHeight;
        setNeedsGradient(hasOverflow);
        element.scrollTop = element.scrollHeight;

        return true;
      };

      const scrollChecker = () => {
        window.requestIdleCallback(() => {
          if (isMouseOverRef.current) return;

          if (autoScroll()) {
            scrollChecker();
          }
        });
      };

      scrollChecker();
    }, [hasTextChild]);

    return (
      <div
        className={classnames({
          [styles.childItemBigSmartOffice]: isBigSmartOffice,
        })}
        style={{ maxWidth: '100%' }}
      >
        <div
          className={classnames(styles.itemHeader, 'gap4', {
            [styles.collapsible]: hasChildren,
          })}
          onClick={() => {
            if (!hasChildren) return;
            isManualChangeRef.current = true;
            setIsCollapsed(!isCollapsed);
          }}
        >
          <ThinkingProcessItemRender
            key={`${message?.msgId}_think_${item.messageIdx}`}
            thinkListItem={item}
            compKey={`${message?.msgId}_think_${item.messageIdx}`}
            message={message}
            messageIdx={item.messageIdx}
            updateMessageListItem={(path: string, val: any) => {
              updateMessageListItemNewContent(`${item.messageIdx}.${path}`, val);
            }}
          />
          {hasChildren && (
            <div className={styles.itemCollapseIcon}>{isCollapsed ? <DownOutlined /> : <UpOutlined />}</div>
          )}
        </div>
        {needsGradient && (
          <div style={{ position: 'relative' }}>
            <div
              className={classnames(styles.topGradient, {
                [styles.close]: isCollapsed,
                [styles.open]: !isCollapsed,
              })}
            />
          </div>
        )}
        <div>
          {hasChildren && (
            <div
              className={classnames(styles.itemChildHeader, {
                [styles.close]: isCollapsed,
                [styles.open]: !isCollapsed,
              })}
              ref={itemChildHeaderRef}
              onMouseEnter={() => {
                isMouseOverRef.current = true;
              }}
            >
              {item.children?.map((child, index) => (
                <ThinkingProcessItemRender
                  key={`${message?.msgId}_message_${index}`}
                  thinkListItem={child}
                  compKey={`${message?.msgId}_message_${index}`}
                  message={message}
                  messageIdx={child.messageIdx}
                  updateMessageListItem={(path: string, val: any) => {
                    updateMessageListItemNewContent(`${child.messageIdx}.${path}`, val);
                  }}
                />
              ))}
            </div>
          )}
        </div>
        {needsGradient && (
          <div style={{ position: 'relative' }}>
            <div
              className={classnames(styles.bottomGradient, {
                [styles.close]: isCollapsed,
                [styles.open]: !isCollapsed,
              })}
            />
          </div>
        )}
      </div>
    );
  }
);

function ThinkNewRootTitle(props: IProps) {
  const { message, treeNode, updateMessageListItemContent } = props;

  const { msgId } = message;

  const isTitleContentType =
    [
      `${SSEMessageType.thinkRootTitle}`,
      `${SSEMessageType.thinkTitle}`,
      `${SSEMessageType.thinkSubTitle}`,
      `${SSEMessageType.thinkStatusTitle}`,
    ].includes(`${treeNode?.contentType}`) || !isEmpty(treeNode?.children);

  return (
    <div className={classnames(styles.thinkingTitle, 'ub')} data-type="noLine">
      {isTitleContentType ? (
        <CollapsibleSection
          treeNode={treeNode}
          message={message}
          updateMessageListItemNewContent={updateMessageListItemContent}
        >
          {treeNode?.children?.map?.((item: NewIMessageListItem, index: number) => {
            if ([
              `${SSEMessageType.thinkTaskExecute}`,
              `${SSEMessageType.thinkTaskPrepare}`,
              `${SSEMessageType.thinkTaskResult}`
            ].includes(`${item.contentType}`)) {
              return (
                <div
                  key={`${msgId}_item_${index}`}
                  className={classnames(styles.childItem, styles.childItemILF, 'overflow-hidden')}>
                  <CollapsibleItem
                    item={item}
                    message={message}
                    parentTreeNode={treeNode}
                    updateMessageListItemNewContent={updateMessageListItemContent}
                  />
                </div>
              );
            }

            return (
              <div key={`${msgId}_item_${index}`} className={classnames(styles.childItem, 'overflow-hidden full-width')}>
                <CollapsibleItem
                  item={item}
                  message={message}
                  parentTreeNode={treeNode}
                  updateMessageListItemNewContent={updateMessageListItemContent}
                />
              </div>
            );
          })}
        </CollapsibleSection>
      ) : (
        <CollapsibleItem
          item={treeNode}
          message={message}
          updateMessageListItemNewContent={updateMessageListItemContent}
        />
      )}
    </div>
  );
}

export default React.memo(ThinkNewRootTitle);
