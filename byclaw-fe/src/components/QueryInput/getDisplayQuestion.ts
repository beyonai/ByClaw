import { ResourceTypeMap } from '@/constants/resource';
import { RichInputResourceList } from './RichInput';
import { getChatResourceId } from './RichInput/utils';
import { getElementDisplayText } from './RichInput/utils/getElementData';
import { IdInBracesRegex } from './RichInput/utils';

export default function getDisplayQuestion(params: {
  text: string | undefined;
  resourceList?: RichInputResourceList;
  isMarkdown?: boolean;
}) {
  const { text, resourceList, isMarkdown } = params;
  if (!Array.isArray(resourceList) || !resourceList.length) {
    return text;
  }
  if (!text) return text;
  const resourceMap = resourceList.reduce((pre, cur) => {
    if (!cur.resourceType) {
      cur.resourceType = ResourceTypeMap.user;
    }
    if (cur.id) {
      pre[cur.id] = cur;
    } else {
      pre[getChatResourceId(cur.resourceId, cur.resourceType)] = cur;
    }
    return pre;
  }, {} as Record<string, RichInputResourceList[0]>);
  return text.replace(/{{(.*?)}}/g, (match, p1) => {
    let resource = resourceMap[p1];
    // 这种是数字员工的技能，显示的名称格式为：数字员工名称#技能名称，因此需要获取agentName
    if (IdInBracesRegex.test(p1)) {
      // agentResId是数字员工资源的id，由getChatResourceId方法生成
      // 这个数字员工的信息，正常情况下是在resourceList中可以找到的
      const [agentResId, toolResId] = p1.split('#');
      if (resourceMap[agentResId]) {
        const agentName = resourceMap[agentResId].resourceName;
        resource = resourceMap[toolResId];
        return (
          getElementDisplayText({
            isMarkdown,
            resourceType: resource?.resourceType,
            data: { agentName, name: resource?.resourceName },
          }) || match
        );
      }
    }
    if (!resource) return match;
    return (
      getElementDisplayText({
        isMarkdown,
        resourceType: resource.resourceType,
        data: { name: resource.resourceName },
      }) || match
    );
  });
}
