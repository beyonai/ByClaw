import type { DefaultValueSchema } from '@/components/QueryInput/RichInput/types';
import type { AutomationFormValues } from './types';

export interface AutomationCreationDraft {
  values: AutomationFormValues;
  prompt: DefaultValueSchema;
}

// 定时任务独立使用页面内存草稿，不复用普通聊天的空会话 ID；模板入口也各自隔离。
const creationDrafts = new Map<string, AutomationCreationDraft>();
const getKey = (templateKey?: string) => (templateKey ? `template:${templateKey}` : 'new');

export const getAutomationCreationDraft = (templateKey?: string) => creationDrafts.get(getKey(templateKey));

export const saveAutomationCreationDraft = (draft: AutomationCreationDraft, templateKey?: string) => {
  creationDrafts.set(getKey(templateKey), draft);
};

export const clearAutomationCreationDraft = (templateKey?: string) => {
  creationDrafts.delete(getKey(templateKey));
};
