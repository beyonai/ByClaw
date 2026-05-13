/**
 * 卡片内容组件
 * 负责渲染卡片内容区域，包含多个内容块
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import classnames from 'classnames';
import type { ICardContent } from './types';
import ContentBlockRenderer from './ContentBlocks';
import styles from './index.module.less';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';

interface CardContentProps {
  content?: ICardContent;
}

const CardContent: React.FC<CardContentProps> = ({ content }) => {
  const intl = useIntl();
  const contentRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showMoreButton, setShowMoreButton] = useState(false);

  useEffect(() => {
    const checkContentHeight = () => {
      if (contentRef.current) {
        const { scrollHeight, clientHeight } = contentRef.current;
        // 如果内容高度超过容器高度，显示"查看更多"按钮
        setShowMoreButton(scrollHeight > clientHeight);
      }
    };

    // 初始检查
    checkContentHeight();

    // 监听窗口大小变化
    window.addEventListener('resize', checkContentHeight);

    // 使用 MutationObserver 监听内容变化
    const observer = new MutationObserver(checkContentHeight);
    if (contentRef.current) {
      observer.observe(contentRef.current, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    }

    return () => {
      window.removeEventListener('resize', checkContentHeight);
      observer.disconnect();
    };
  }, [content]);

  const handleShowMore = useCallback(() => {
    setIsExpanded(true);
    setShowMoreButton(false);
  }, []);

  if (!content || !content.blocks || content.blocks.length === 0) {
    return null;
  }

  const { blocks, style } = content;

  return (
    <div
      ref={contentRef}
      className={classnames(styles.cardContent, {
        [styles.cardContentExpanded]: isExpanded,
      })}
      style={style}
    >
      {blocks.map((block, index) => (
        <ContentBlockRenderer key={`${block.type}-${index}`} block={block} />
      ))}
      {showMoreButton && !isExpanded && (
        <div className={styles.moreOverlay} onClick={handleShowMore}>
          <span className={styles.moreText}>
            {intl.formatMessage({ id: 'common.viewMore' })}
            <AntdIcon type="icon-a-Double-downshuangxia" style={{ marginLeft: 4, display: 'inline' }} />
          </span>
        </div>
      )}
    </div>
  );
};

export default CardContent;
