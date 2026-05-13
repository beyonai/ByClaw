// @ts-nocheck
import { message } from 'antd';
import {
  debugModelEmbedding,
  debugModelNonStream,
  debugModelStream,
  deleteModel,
  getModelDetail,
  getModelListByPage,
  setModelStatus,
  upsertModel,
} from '@/pages/manager/service/ModelMgr';

export const unwrapResponse = (response) => {
  if (response && typeof response === 'object' && 'code' in response) {
    return response;
  }
  return { code: 0, data: response };
};

export const getErrorText = (error) => {
  if (!error) return '请求失败';
  if (typeof error === 'string') return error;
  return error?.msg || error?.message || '请求失败';
};

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
          message.error(response?.msg || '获取模型列表失败');
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
          message.error(response?.msg || '获取模型详情失败');
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
          message.error(response?.msg || '保存模型失败');
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
          message.error(response?.msg || '更新模型状态失败');
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
          message.error(response?.msg || '删除模型失败');
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
          message.error(response?.msg || '模型调试失败');
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
          message.error(response?.msg || '模型调试失败');
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
          message.error(response?.msg || '模型调试失败');
          fail?.(response || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
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
          message.error(response?.msg || '模型调试失败');
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
