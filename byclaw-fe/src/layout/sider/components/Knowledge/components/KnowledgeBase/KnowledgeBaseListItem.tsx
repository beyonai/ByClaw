import React from 'react';
import { List } from 'antd';
import AntdIcon from '@/components/AntdIcon';
import { getRuntimeActualUrl } from '@/utils';
import { IKnowledgeBaseItem } from './types';
import styles from './index.module.less';

interface KnowledgeBaseListItemProps {
  item: IKnowledgeBaseItem;
  actions?: React.ReactNode[];
  isUser?: boolean;
  onClick?: (event: React.MouseEvent<HTMLElement>, item: IKnowledgeBaseItem) => void;
  onDoubleClick?: (event: React.MouseEvent<HTMLElement>, item: IKnowledgeBaseItem) => void;
}

const KnowledgeBaseListItem = ({ item, actions, isUser, onClick, onDoubleClick }: KnowledgeBaseListItemProps) => (
  <List.Item
    key={item.resourceId}
    className={styles.knowledgeItem}
    actions={actions}
    onClick={(event) => onClick?.(event, item)}
    onDoubleClick={(event) => onDoubleClick?.(event, item)}
  >
    <List.Item.Meta
      title={
        <span className={styles.knowledgeName}>
          <span className={styles.knowledgeNameRow} title={item.resourceName}>
            <span className={styles.knowledgeNameText}>{item.resourceName}</span>
            {`${item?.isTop}` === '1' && isUser && (
              <AntdIcon type="icon-zhiding-fill" className={styles.knowledgePinBadge} />
            )}
          </span>
        </span>
      }
      description={
        <span className={styles.knowledgeDescription} title={item.resourceDesc}>
          {item.resourceDesc}
        </span>
      }
      avatar={
        item.resourceLogoUrl ? (
          <img className={styles.avatar} src={getRuntimeActualUrl(`/byaiService${item.resourceLogoUrl}`)} alt="" />
        ) : (
          <span className={styles.defaultAvatar}>
            <AntdIcon type="icon-chuangjianfangshi-wendangku" style={{ fontSize: 16 }} />
          </span>
        )
      }
    />
  </List.Item>
);

export default KnowledgeBaseListItem;
