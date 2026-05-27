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

  const { pluginAppId, pluginMachineId, rule, title, description, formId, ...res } = resp;

  set(content, 'pluginAppId', pluginAppId);
  set(content, 'pluginMachineId', pluginMachineId);
  set(content, 'formId', formId);
  set(content, 'title', title);
  set(content, 'description', description);
  set(content, 'substance', rule || []);
  set(content, 'formStatus', IFormStatus.INIT);
  set(content, 'stepId', stepId);
  set(content, 'extParam', {
    ...res,
  });

  set(content, 'orginContent', resp);

  return content;
};
