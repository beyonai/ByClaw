// @ts-nocheck
import {
  addPosition,
  getPostDefaultList,
  removePosition,
  searchPositionList,
  searchPositionUsersByQo,
  updatePosition,
} from '@/pages/manager/service/OrgCenter';

const normalizeResponse = (response) => {
  if (response && typeof response === 'object' && 'code' in response) {
    return response;
  }
  return { code: 0, data: response };
};

export default {
  namespace: 'postManage',
  state: {},
  effects: {
    *getPostList({ payload, success, fail }, { call }) {
      try {
        const response = normalizeResponse(yield call(searchPositionList, payload));
        if (response.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
    *getPostDefaultList({ success, fail }, { call }) {
      try {
        const response = normalizeResponse(yield call(getPostDefaultList));
        if (response.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
    *getPostMemberList({ payload, success, fail }, { call }) {
      try {
        const response = normalizeResponse(yield call(searchPositionUsersByQo, payload));
        if (response.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
    *postEdit({ payload, success, fail }, { call }) {
      try {
        const request = payload?.positionId ? updatePosition : addPosition;
        const response = normalizeResponse(yield call(request, payload));
        if (response.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
    *postDelete({ payload, success, fail }, { call }) {
      try {
        const response = normalizeResponse(yield call(removePosition, payload));
        if (response.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.({ msg: String(error || '') });
      }
    },
  },
};
