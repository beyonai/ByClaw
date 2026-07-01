import React from 'react';
import { List, Tooltip } from 'antd';
import AntdIcon from '@/components/AntdIcon';
import { ResourceTypeMap } from '@/constants/resource';
import { getFileUrl } from '@/utils/file';
import styles from './index.module.less';

export type ResourceSiderType = 'TOOL' | 'VIEW' | 'OBJECT' | 'SKILL';

export interface ResourceItem {
  resourceId: string | number;
  resourceCode?: string;
  resourceName: string;
  description?: string;
  resourceDesc?: string;
  resourceLogoUrl?: string;
  avatar?: string;
  logoUrl?: string;
  resourceImageUrl?: string;
  resourceImage?: string;
  coverUrl?: string;
  coverImageUrl?: string;
  resourceBizType?: string;
  resourceSourcePkId?: string;
  createTime?: number | string;
  createUserName?: string;
  extInfo?: any;
  isTop?: string | number;
  propertyName?: string;
  propertyCode?: string;
  propertyGroup?: string;
  dataType?: string;
  sourceType?: string;
  displaySourceType?: string;
  resourceBacked?: boolean;
  skillPath?: string;
  skillDocObjectKey?: string;
  useStartTime?: string;
  objectKey?: string;
  targetContent?: string;
}

export const PROPERTY_RESOURCE_TYPE = 'PROPERTY';

export const parseResourceTargetContent = (item?: ResourceItem) => {
  const targetContent = item?.extInfo?.targetContent || item?.targetContent;
  if (!targetContent || typeof targetContent !== 'string') {
    return null;
  }
  try {
    return JSON.parse(targetContent);
  } catch {
    return null;
  }
};

export const getResourceImageUrl = (item?: ResourceItem) => {
  const targetContent = parseResourceTargetContent(item);
  return (
    item?.resourceLogoUrl ||
    item?.avatar ||
    item?.logoUrl ||
    item?.resourceImageUrl ||
    item?.resourceImage ||
    item?.coverUrl ||
    item?.coverImageUrl ||
    targetContent?.resourceLogoUrl ||
    targetContent?.avatar ||
    targetContent?.logoUrl ||
    targetContent?.resourceImageUrl ||
    targetContent?.resourceImage ||
    targetContent?.coverUrl ||
    targetContent?.coverImageUrl ||
    ''
  );
};

interface ResourceSiderListItemProps {
  item: ResourceItem;
  resourceType: ResourceSiderType;
  drillable?: boolean;
  actions?: React.ReactNode[];
  renderSkillSourceTag?: (item: ResourceItem) => React.ReactNode;
  renderName?: (item: ResourceItem) => React.ReactNode;
  renderDescription?: (item: ResourceItem) => React.ReactNode;
  onClick?: (item: ResourceItem, drillable: boolean) => void;
  onDoubleClick?: (item: ResourceItem) => void;
}

const getResourceIcon = (resourceType: ResourceSiderType, item: ResourceItem) => {
  if (item.resourceBizType === PROPERTY_RESOURCE_TYPE || String(item.resourceId).includes('-')) {
    return 'icon-a-Database-networkshujukuwangluo';
  }
  if (resourceType === 'TOOL' || resourceType === 'SKILL') {
    return 'icon-chajiantubiao';
  }
  return 'icon-chuangjianfangshi-shujuku';
};

const ResourceSiderListItem: React.FC<ResourceSiderListItemProps> = ({
  item,
  resourceType,
  drillable = false,
  actions,
  renderSkillSourceTag,
  renderName,
  renderDescription,
  onClick,
  onDoubleClick,
}) => {
  const resourceImage = getResourceImageUrl(item);
  const description = item.resourceDesc || item.description;

  return (
    <List.Item
      key={item.resourceId}
      className={styles.resourceItem}
      onClick={() => onClick?.(item, drillable)}
      onDoubleClick={() => onDoubleClick?.(item)}
      actions={actions}
    >
      <List.Item.Meta
        avatar={
          <span className={styles.resourceAvatar}>
            {drillable && <AntdIcon type="icon-a-xiangyou" className={styles.drillIcon} />}
            {resourceType === 'SKILL' && resourceImage ? (
              <img
                key={getFileUrl(resourceImage)}
                className={styles.resourceAvatarImage}
                src={getFileUrl(resourceImage)}
                alt=""
                fetchPriority="low"
              />
            ) : resourceType === 'SKILL' && item.resourceBizType === ResourceTypeMap.SKILL ? (
              <span className={styles.skillDefaultAvatar}>
                <span className={styles.skillDefaultAvatarOrb} />
              </span>
            ) : (
              <AntdIcon type={getResourceIcon(resourceType, item)} />
            )}
          </span>
        }
        title={
          <span className={styles.resourceName}>
            <Tooltip title={item.resourceName}>
              <span className={styles.resourceNameRow}>
                <span className={styles.resourceNameText}>{renderName ? renderName(item) : item.resourceName}</span>
                {renderSkillSourceTag?.(item)}
              </span>
            </Tooltip>
          </span>
        }
        description={
          description ? (
            <Tooltip title={description} placement="right">
              <span className={styles.resourceDescription}>
                {renderDescription ? renderDescription(item) : description}
              </span>
            </Tooltip>
          ) : null
        }
      />
    </List.Item>
  );
};

export default ResourceSiderListItem;
