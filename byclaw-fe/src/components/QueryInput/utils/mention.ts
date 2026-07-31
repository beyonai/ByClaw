import type { Resource } from '../RichInput/types';
import { ResourceType } from '../RichInput/utils/constants';

export const getLastMentionedDigitalEmployeeId = (resourceList: Resource[]) => {
  // resourceList 保持输入顺序，倒序命中的第一个员工就是最后一次 @ 的员工。
  const lastMentionedAgent = [...resourceList]
    .reverse()
    .find((item) => item.resourceType === ResourceType.digitalEmployee && item.resourceId);
  return lastMentionedAgent ? `${lastMentionedAgent.resourceId}` : '';
};
