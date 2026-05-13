import { useState, useCallback, useEffect, useRef } from 'react';
import { POST } from '@/service/common/request';
import { IAgentCache } from '@/typescript/agent';
import { useSelector } from '@umijs/max';

export interface IAgentFileUploadConf {
  enabled: boolean;
  allowedFileTypes: string[];
  maxFileSize: number;
  maxFileCount: number;
}

async function qrySuperAssistantDetail(): Promise<IAgentFileUploadConf | null> {
  const res = await POST<any>('/byaiService/system/staticdata/getDcSystemConfig', {
    paramCode: 'DIG_EMPLOYEE_FILE_UPLOAD_CONFIG',
  },{responseCfg: {
    customHandle: true,
  }});
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

type AgentDetailMap = Record<string, IAgentFileUploadConf | null>;

export default function useAgentUploadFileConfig(employeesList: IAgentCache[]) {
  const [globalConfig, setGlobalConfig] = useState<IAgentFileUploadConf | null>(null);
  const agentMap = useRef<AgentDetailMap>({});
  const userInfo = useSelector(({ user }) => user.userInfo);

  useEffect(() => {
    if (userInfo) {
      qrySuperAssistantDetail().then(setGlobalConfig);
    }
  }, [userInfo]);

  const getAgentUploadFileConfig = useCallback(
    (agentId?: string) => {
      if (globalConfig && !globalConfig.enabled) {
        return globalConfig;
      }
      if (agentId) {
        if (agentMap.current[agentId]) {
          return agentMap.current[agentId];
        }
        const agent = employeesList.find((item) => `${item.id}` === `${agentId}`);
        if (!agent) {
          return globalConfig;
        }
        const { prologue } = agent;
        if (prologue) {
          try {
            const { fileUpload } = JSON.parse(prologue);
            agentMap.current[agentId] = fileUpload;
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

  return getAgentUploadFileConfig;
}
