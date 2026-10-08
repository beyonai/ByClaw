import { POST } from '@/service/common/request';
import { getIntl } from '@umijs/max';

export interface ResourceFavoriteState {
  favorited: boolean;
  favoriteCount: number;
}

export const RESOURCE_FAVORITE_CHANGED_EVENT = 'resourceFavoriteChanged';

export const setResourceFavorite = async (resourceId: string, favorited: boolean): Promise<ResourceFavoriteState> => {
  const response = await POST<any>('/byaiService/resource/favorite/set', { resourceId, favorited });
  const data = response?.data?.data ?? response?.data ?? response;
  const favoriteCount = Number(data?.favoriteCount);
  if (
    typeof data?.favorited !== 'boolean' ||
    data?.favoriteCount === null ||
    data?.favoriteCount === undefined ||
    !Number.isSafeInteger(favoriteCount) ||
    favoriteCount < 0
  ) {
    throw new Error(getIntl().formatMessage({ id: 'common.operationFailed' }));
  }
  return { favorited: data.favorited, favoriteCount };
};
