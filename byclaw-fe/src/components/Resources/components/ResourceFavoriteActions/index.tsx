import React, { useRef, useState } from 'react';
import { StarFilled, StarOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Button, message } from 'antd';
import { RESOURCE_FAVORITE_CHANGED_EVENT, setResourceFavorite } from '@/service/resourceFavorites';
import styles from './index.module.less';

interface Props {
  resourceId: string;
  favorited?: boolean;
  favoriteCount?: number | string;
  hasUsePermission?: boolean;
  useApplyPending?: boolean;
  operationPermissionsLoaded?: boolean;
}

/** 只由商业版官方推荐和收藏列表挂载；不发起任何列表/权限查询。 */
const ResourceFavoriteActions: React.FC<Props> = ({
  resourceId,
  favorited = false,
  favoriteCount = 0,
  hasUsePermission,
  useApplyPending,
  operationPermissionsLoaded,
}) => {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);
  const state = hasUsePermission === true ? 'authorized' : useApplyPending === true ? 'pending' : 'unauthorized';
  const toggleFavorite = async () => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    try {
      const result = await setResourceFavorite(resourceId, !favorited);
      window.dispatchEvent(new CustomEvent(RESOURCE_FAVORITE_CHANGED_EVENT, { detail: { resourceId, ...result } }));
    } catch (error: any) {
      message.error(
        error?.message || (typeof error === 'string' && error) || intl.formatMessage({ id: 'common.operationFailed' })
      );
    } finally {
      pending.current = false;
      setLoading(false);
    }
  };

  return (
    <div className={styles.actions} onClick={(event) => event.stopPropagation()}>
      <Button
        type="text"
        size="small"
        className={styles.favorite}
        icon={favorited ? <StarFilled /> : <StarOutlined />}
        aria-label={intl.formatMessage({ id: favorited ? 'resource.favorite.cancel' : 'resource.favorite.add' })}
        aria-pressed={favorited}
        loading={loading}
        disabled={loading}
        onClick={toggleFavorite}
      >
        {Number(favoriteCount || 0).toLocaleString()}
      </Button>
      {operationPermissionsLoaded === true && (
        <span className={styles[state]}>{intl.formatMessage({ id: `resource.authorization.${state}` })}</span>
      )}
    </div>
  );
};

export default ResourceFavoriteActions;
