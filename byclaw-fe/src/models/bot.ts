import { logged } from '@/service/bot';
import { getssoToken } from '@/utils/auth';
import { setBotSelectedTenantID, getBotSelectedTenantID } from '@/utils/bot';
import { message } from 'antd';

const getSecurity = async () => {
  const { default: security } = await import('@lingxiteam/security');
  return security;
};

export interface IBotState {
  hasLogined: boolean;
}

export default {
  namespace: 'bot',

  state: {
    hasLogined: false,
  },

  effects: {
    *botLogin(_: any, { select, put, call }: any): any {
      const hasLogined = yield select((state: any) => state.bot.hasLogined);

      if (hasLogined) return getBotSelectedTenantID();

      try {
        const boteInfo = yield call(logged, {
          'sso-token': getssoToken(),
          systemCode: 'BYAI',
        });

        const { defaultTenantId } = boteInfo.loginInfo || {};

        setBotSelectedTenantID(defaultTenantId);

        yield put({
          type: 'save',
          payload: {
            hasLogined: true,
          },
        });

        if (boteInfo?.secretKey && boteInfo?.secretValue) {
          const security = yield call(getSecurity);
          // 开启加签加密
          security.httpEncryption.start({
            mode: boteInfo?.securityMode,
            sign: {
              saltKey: boteInfo?.secretKey,
              saltValue: boteInfo?.secretValue,
            },
            serverTime: Number(boteInfo?.serverTime),
            ignore: (url: string) => !url.match('/bote/'), // 只对博特平台请求进行处理
          });
        }

        return defaultTenantId;
      } catch (e) {
        message.error('bot Login error');
      }

      return false;
    },
  },

  reducers: {
    save(state: IBotState, action: { payload: Partial<IBotState> }) {
      return {
        ...state,
        ...action.payload,
      };
    },
  },
};
