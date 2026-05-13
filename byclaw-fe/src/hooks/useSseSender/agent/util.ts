import { set } from 'lodash';

import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';

export const formatSSEDate = (objStr: string, stepId?: string) => {
  const content = {
    substance: [],
  };

  let resp: any = {};

  try {
    resp = JSON.parse(objStr) || {};
  } catch (e) {
    console.error(e, objStr);
    return resp;
  }

  const { pluginAppId, pluginMachineId, rule, rules, title, ...res } = resp;

  set(content, 'pluginAppId', pluginAppId);
  set(content, 'pluginMachineId', pluginMachineId);
  set(content, 'title', title);
  set(content, 'substance', rule || rules || []);
  set(content, 'formStatus', IFormStatus.INIT);
  set(content, 'stepId', stepId);
  set(content, 'extParam', {
    ...res,
  });

  console.log('contentafterformat', content);

  return content;
};
