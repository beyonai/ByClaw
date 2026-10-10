import { useState, useCallback, useEffect } from 'react';
import { POST } from '@/service/common/request';
import { IAgentCache } from '@/typescript/agent';
import { useSelector } from '@umijs/max';

export interface IAgentFileUploadConf {
  enabled: boolean;
  allowedFileTypes: string[];
  /** 单个文件大小上限，按 1024 * 1024 字节换算；0 表示不限。 */
  maxFileSize: number;
  /** 当前输入框附件数量上限；0 表示不限。 */
  maxFileCount: number;
}

async function qrySuperAssistantDetail(): Promise<IAgentFileUploadConf | null> {
  const res = await POST<any>(
    '/byaiService/system/staticdata/getDcSystemConfig',
    {
      paramCode: 'DIG_EMPLOYEE_FILE_UPLOAD_CONFIG',
    },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
  if (res?.code === 0 && res.data && res.data.paramValue) {
    try {
      const config = JSON.parse(res.data.paramValue);
      return config;
    } catch (error) {
      console.error(error);
    }
  }
  return null;
}

const default_globalConfig = {
  // 未配置全局参数时默认展示上传入口，仅显式的 enabled=false 关闭。
  enabled: true,
  allowedFileTypes: [],
  maxFileSize: 0,
  maxFileCount: 0,
};

export default function useAgentUploadFileConfig(employeesList: IAgentCache[]) {
  const [globalConfig, setGlobalConfig] = useState<IAgentFileUploadConf>(default_globalConfig);
  const userInfo = useSelector(({ user }) => user.userInfo);

  useEffect(() => {
    if (userInfo) {
      qrySuperAssistantDetail().then((config) => {
        setGlobalConfig(config || default_globalConfig);
      });
    }
  }, [userInfo]);

  const getAgentUploadFileConfig = useCallback(
    (agentId?: string) => {
      if (globalConfig && !globalConfig.enabled) {
        return globalConfig;
      }
      if (agentId) {
        const agent = employeesList.find((item) => `${item.id}` === `${agentId}`);
        if (!agent) {
          return globalConfig;
        }

        const { prologue } = agent;
        if (prologue) {
          try {
            const { fileUpload } = JSON.parse(prologue);
            return fileUpload;
          } catch (error) {
            console.error(error);
          }
        }
        return {
          ...(globalConfig || {}),
          enabled: false,
        };
      }
      return globalConfig;
    },
    [globalConfig, employeesList]
  );

  return {
    getAgentUploadFileConfig,
    globalConfig,
  };
}
