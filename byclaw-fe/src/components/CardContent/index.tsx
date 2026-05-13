import { Card, Space, Tag, Typography } from 'antd';
import classNames from 'classnames';
import React from 'react';

import Markdown from '@/components/Markdown';

import styles from './index.module.less';

const { Title, Paragraph } = Typography;

export interface CardContentProps {
  // prettier-ignore
  /**
   * 卡片标题
   */
  title: string;

  /**
   * 卡片内容
   */
  content?: string;

  /**
   * 卡片来源信息
   */
  source?: string;

  /**
   * 卡片分类
   */
  category?: string;

  /**
   * 卡片日期
   */
  date?: string;

  /**
   * 点赞/查看数
   */
  views?: number;

  /**
   * 自定义类名
   */
  className?: string;

  /**
   * 点击事件
   */
  onClick?: () => Promise<any>;

  /**
   * 卡片图标
   */
  icon?: React.ReactNode;

  style?: React.CSSProperties;
}

const CardContent: React.FC<CardContentProps> = ({
  title,
  content,
  source,
  category,
  date,
  views,
  className,
  onClick,
  icon,
  style = {},
}) => {
  const [isLoading, setIsLoading] = React.useState(false);

  return (
    <Card
      key={title}
      hoverable
      className={classNames(styles.cardContent, 'overflow-hidden', className)}
      onClick={async () => {
        if (isLoading) return;

        setIsLoading(true);
        await onClick?.();
        setIsLoading(false);
      }}
      styles={{
        body: {
          padding: '16px',
        },
      }}
      style={{ ...style }}
    >
      <div className={styles.cardHeader}>
        <Title level={5} ellipsis={{ rows: 1 }} className={styles.cardTitle}>
          {title}
        </Title>
      </div>

      {content && (
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 9 }} className="full-height full-width">
            <div className={styles.maskTransparent} />
          </div>
          <Paragraph ellipsis={{ rows: 2 }} className={classNames(styles.cardDesc)}>
            {/* {content} */}
            <Markdown text={content} />
          </Paragraph>
        </div>
      )}

      <div className={styles.cardFooter}>
        <Space size={8} className={styles.leftInfo}>
          {icon && <div className={styles.cardIcon}>{icon}</div>}
          {source && <div className={styles.source}>{source}</div>}
          {category && <Tag className={styles.category}>{category}</Tag>}
          {date && <span className={styles.date}>{date}</span>}
        </Space>

        {views !== undefined && <div className={styles.views}>{views}</div>}
      </div>
    </Card>
  );
};

export default CardContent;
