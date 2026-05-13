import { getContentFeedbackType } from '@/service/message';
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { isEmpty, get } from 'lodash';

import { bathQryPropertyKey } from '@/service/system';

import type {
  SettingItemKey,
  ISettingConfContent,
  ISettingConf,
  IOriginObject,
  IParamValueConfig,
} from '@/typescript/cloud';

// 将res改为数组，同时将key作为每个对象的key
const transformData = (obj?: Record<SettingItemKey, IParamValueConfig>) => {
  if (!obj) return [];
  return Object.keys(obj).map((key) => {
    const item = get(obj, key) || {};
    return {
      ...item,
      key,
      choiceValue: item.defaultValue,
    };
  }) as ISettingConfContent[];
};

export interface IFeedbackTypeItem {
  paramName: string;
  paramValue: string;
  paramCode: string;
}

export interface ISuggestQuestionItem {
  content: string;
  icon?: string;
}

type IState = {
  isSiderCollapsed: boolean;
  setSiderCollapsed: (isCollapsed: boolean) => void;

  feedbackType: Record<string, IFeedbackTypeItem[]>;
  getFeedbackType: () => Promise<void>;

  isUserCollectModalOpen: boolean;
  setUserCollectModalOpen: (isOpen: boolean) => void;

  isLoginModalOpen: boolean;
  setLoginModalOpen: (isOpen: boolean) => void;

  ENV: string[];
  setENV: (env: string[]) => void;

  STTOpts: { type?: string; options?: Record<string, unknown> };
  getSTTOpts: () => Promise<{ type?: string; options?: Record<string, unknown> }>;

  // 全局云配置，初始为空对象，真正有值时为完整的 ISettingConf
  cloudSettings: Partial<ISettingConf>;
  cleanCloudSettings: () => void;
  setCloudSettings: (settings: string) => void;

  devConfig: {
    devPortalUrl?: string;
    agentDetailUrl?: string;
  };
  setDevConfig: (settings: string) => void;

  suggestQuestions: Array<ISuggestQuestionItem>;
  setSuggestQuestions: (questions: ISuggestQuestionItem[]) => void;
};

const useAppStore = create<IState>()(
  devtools(
    persist(
      (set, get) => {
        return {
          isSiderCollapsed: false,
          setSiderCollapsed: (isCollapsed: boolean) => set({ isSiderCollapsed: isCollapsed }),

          // 反馈类型
          feedbackType: {
            FEEDBACK: [],
          },

          isUserCollectModalOpen: false,
          setUserCollectModalOpen: (isOpen: boolean) => set({ isUserCollectModalOpen: isOpen }),

          isLoginModalOpen: false,
          setLoginModalOpen: (isOpen: boolean) => set({ isLoginModalOpen: isOpen }),

          ENV: [],
          setENV: (env: string[]) => set({ ENV: env }),

          STTOpts: {},
          async getSTTOpts() {
            let sttOpts = get().STTOpts;

            if (sttOpts && !isEmpty(sttOpts)) {
              return sttOpts;
            }

            const res = await bathQryPropertyKey({
              keys: ['env.voice.type', 'env.voice.options.id', 'env.voice.options.secret', 'env.voice.options.key'],
            });

            const { data } = res || {};

            if (!data || isEmpty(data)) {
              return sttOpts;
            }

            sttOpts = {
              type: data['env.voice.type'],
              options: {
                id: data['env.voice.options.id'],
                secret: data['env.voice.options.secret'],
                key: data['env.voice.options.key'],
              },
            };

            set({ STTOpts: sttOpts });
            return sttOpts;
          },

          async getFeedbackType() {
            try {
              const res = await getContentFeedbackType();
              const { FEEDBACK = [] } = res || {};
              set({ feedbackType: { FEEDBACK } });
            } catch {
              set({ feedbackType: { FEEDBACK: [] } });
            }
          },

          cloudSettings: {},
          cleanCloudSettings: () => set({ cloudSettings: {} }),
          setCloudSettings: (res: string) => {
            let data: IOriginObject = {};
            if (typeof res === 'string') {
              try {
                data = JSON.parse(res);
              } catch (error) {
                data = {
                  dataCloud: {} as Record<SettingItemKey, IParamValueConfig>,
                  functionCloud: {} as Record<SettingItemKey, IParamValueConfig>,
                  memory: {} as Record<SettingItemKey, IParamValueConfig>,
                };
              }
            } else {
              data = res;
            }

            const newConfigJson: ISettingConf = {
              dataCloud: transformData(data?.dataCloud),
              functionCloud: transformData(data?.functionCloud),
              memory: transformData(data?.memory),
            };

            set({ cloudSettings: newConfigJson });
          },

          devConfig: {},
          setDevConfig: (res: string) => {
            try {
              const devConfig = JSON.parse(res);
              set({ devConfig });
            } catch (error) {
              console.error('开发平台配置解析失败', error);
            }
          },

          suggestQuestions: [],
          setSuggestQuestions: (questions: ISuggestQuestionItem[]) => set({ suggestQuestions: questions }),
        };
      },
      {
        name: 'appStore',
        partialize: () => ({}),
      }
    )
  )
);

export default useAppStore;
