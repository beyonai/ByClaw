// @ts-nocheck
import { message } from 'antd';
import { getIntl } from '@umijs/max';
import {
  debugModelEmbedding,
  debugModelImageGeneration,
  debugModelNonStream,
  debugModelStream,
  completeAllModelConfig,
  deleteModel,
  getModelDetail,
  getModelListByPage,
  setDefaultModel,
  setModelStatus,
  upsertModel,
} from '@/pages/manager/service/ModelMgr';
import { showRequestErrorModal } from '@/utils/antdAppModal';

export const unwrapResponse = (response) => {
  if (response && typeof response === 'object' && 'code' in response) {
    return response;
  }
  return { code: 0, data: response };
};

export const getErrorText = (error) => {
  if (!error) return getIntl().formatMessage({ id: 'modelMgr.error.requestFail' });
  if (typeof error === 'string') return error;
  return error?.msg || error?.message || getIntl().formatMessage({ id: 'modelMgr.error.requestFail' });
};

export const isRequestCanceled = (error, signal) =>
  Boolean(
    signal?.aborted ||
      error?.code === 'ERR_CANCELED' ||
      error?.code === 'ABORT_ERR' ||
      error?.name === 'CanceledError' ||
      error?.name === 'AbortError' ||
      error?.__CANCEL__
  );

export default {
  namespace: 'modelMgr',
  state: {},
  effects: {
    *getModelListByPage({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(getModelListByPage, payload));
        if (response.code === 0) {
          success?.(response.data || {});
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'modelMgr.error.getModelListFail' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *getModelDetail({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(getModelDetail, payload));
        if (response.code === 0) {
          success?.(response.data || {});
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'modelMgr.error.getModelDetailFail' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *upsertModel({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(upsertModel, payload));
        if (response.code === 0) {
          success?.(response.data || response);
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'modelMgr.error.saveModelFail' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *setModelStatus({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(setModelStatus, payload));
        if (response.code === 0) {
          success?.(response.data);
        } else {
          showRequestErrorModal(
            response?.msg || getIntl().formatMessage({ id: 'modelMgr.error.updateModelStatusFail' })
          );
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *setDefaultModel({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(setDefaultModel, payload));
        if (response.code === 0) {
          success?.(response.data || response);
        } else {
          showRequestErrorModal(response?.msg || getIntl().formatMessage({ id: 'modelMgr.error.setDefaultModelFail' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *completeAllModelConfig({ success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(completeAllModelConfig));
        if (response.code === 0) {
          success?.(response.data || response);
        } else {
          showRequestErrorModal(
            response?.msg || getIntl().formatMessage({ id: 'modelMgr.error.completeModelConfigFail' })
          );
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *deleteModel({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(deleteModel, payload));
        if (response.code === 0) {
          success?.(response.data);
        } else {
          showRequestErrorModal(response?.msg || getIntl().formatMessage({ id: 'modelMgr.error.deleteModelFail' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *debugModel({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(debugModelStream, payload));
        if (response.code === 0 || response.code === 50010) {
          success?.(response.data ?? response);
          if (response.code !== 0) {
            fail?.(response || {});
          }
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'modelMgr.error.debugModelFail' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *debugModelRerank({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(debugModelNonStream, payload));
        if (response.code === 0 || response.code === 50010) {
          success?.(response.data ?? response);
          if (response.code !== 0) {
            fail?.(response || {});
          }
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'modelMgr.error.debugModelFail' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *debugModelEmbedding({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(debugModelEmbedding, payload));
        if (response.code === 0 || response.code === 50010) {
          success?.(response.data ?? response);
          if (response.code !== 0) {
            fail?.(response || {});
          }
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'modelMgr.error.debugModelFail' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *debugModelImageGeneration({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(debugModelImageGeneration, payload));
        if (response.code === 0) {
          const result = response.data ?? response;
          success?.({
            output: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          });
        } else {
          if (!payload?.signal?.aborted) {
            message.error(
              response?.msg || getIntl().formatMessage({ id: 'modelMgr.error.debugModelImageGenerationFail' })
            );
          }
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        if (!isRequestCanceled(error, payload?.signal)) {
          message.error(err.msg);
        }
        fail?.(err);
      }
    },
    *testModel({ payload, success, fail }, { call }) {
      try {
        const response = unwrapResponse(yield call(debugModelStream, payload));
        if (response.code === 0 || response.code === 50010) {
          success?.(response.data ?? response);
          if (response.code !== 0) {
            fail?.(response || {});
          }
        } else {
          message.error(response?.msg || getIntl().formatMessage({ id: 'modelMgr.error.debugModelFail' }));
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
  },
};
