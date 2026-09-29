import { ResourceTypeMap } from '@/constants/resource';

const resourcePrefixes = Object.values(ResourceTypeMap).map((type) => `${type}_`);

/** 只移除输入框序列化的 @ / 引用节点，保留正文中的普通 @、模板文字和换行。 */
export function getQuestionCopyText(text: string): string {
  return text
    .replace(/\{\{([^{}]+)\}\}/g, (match, resourceId: string) =>
      resourcePrefixes.some((prefix) => resourceId.startsWith(prefix)) ? '' : match
    )
    .trim();
}
