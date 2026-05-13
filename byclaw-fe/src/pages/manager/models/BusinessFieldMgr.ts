import {
  getFieldTree,
  createCatalog,
  updateCatalog,
  deleteCatalog,
  queryResourceListByCatalogId,
} from '@/pages/manager/service/BusinessFieldMgr';

type EffectCallback = (response: any) => void;

type EffectAction = {
  payload?: any;
  success?: EffectCallback;
  fail?: EffectCallback;
};

type EffectHelpers = {
  call: (fn: (...args: any[]) => any, ...args: any[]) => any;
};

type SaveAction = {
  payload: Record<string, unknown>;
};

type BusinessFieldState = Record<string, unknown>;
type EffectGenerator = Generator<any, void, any>;

const normalizeResponse = (response: any) => {
  if (response && typeof response === 'object' && 'code' in response) {
    return response;
  }
  return { code: 0, data: response };
};

const getErrorResponse = (error: any) => ({
  msg: typeof error === 'string' ? error : error?.msg || error?.message || '请求失败',
});

export default {
  namespace: 'businessFieldMgr',
  state: {},
  effects: {
    *getFieldTree({ payload, success, fail }: EffectAction, { call }: EffectHelpers): EffectGenerator {
      try {
        const response = normalizeResponse(yield call(getFieldTree, payload));
        if (response.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.(getErrorResponse(error));
      }
    },
    *addField({ payload, success, fail }: EffectAction, { call }: EffectHelpers): EffectGenerator {
      try {
        const response = normalizeResponse(yield call(createCatalog, payload));
        if (response.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.(getErrorResponse(error));
      }
    },
    *updateField({ payload, success, fail }: EffectAction, { call }: EffectHelpers): EffectGenerator {
      try {
        const response = normalizeResponse(yield call(updateCatalog, payload));
        if (response.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.(getErrorResponse(error));
      }
    },
    *deleteField({ payload, success, fail }: EffectAction, { call }: EffectHelpers): EffectGenerator {
      try {
        const response = normalizeResponse(yield call(deleteCatalog, payload));
        if (response.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.(getErrorResponse(error));
      }
    },
    *getFieldAssets({ payload, success, fail }: EffectAction, { call }: EffectHelpers): EffectGenerator {
      try {
        const response = normalizeResponse(yield call(queryResourceListByCatalogId, payload));
        if (response.code === 0) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        fail?.(getErrorResponse(error));
      }
    },
  },

  reducers: {
    save(state: BusinessFieldState = {}, { payload }: SaveAction) {
      return {
        ...state,
        ...payload,
      };
    },
  },
};
