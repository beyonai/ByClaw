import { getIntl } from '@umijs/max';

// 标签随语言变化；value 仍使用历史任务配置中的原始枚举。
const OPTION_MESSAGE_IDS: Record<string, string> = {
  公众号文章: 'projectSpace.operation.taskForm.content.type.wechatArticle',
  小红书图文: 'projectSpace.operation.taskForm.content.type.xiaohongshuPost',
  短视频脚本: 'taskTemplate.content.video',
  微信公众号: 'projectSpace.operation.platform.wechat',
  小红书: 'projectSpace.operation.platform.xiaohongshu',
  微信视频号: 'taskTemplate.platform.channels',
  抖音: 'projectSpace.operation.platform.douyin',
  账号整体分析: 'taskTemplate.analysis.account',
  指定作品分析: 'taskTemplate.analysis.posts',
  '近 7 天': 'taskTemplate.range.week',
  '近 30 天': 'taskTemplate.range.month',
  本季度: 'projectSpace.taskDatePreset.currentQuarter',
  钉钉: 'projectSpace.detail.source.type.dingtalk',
  企业微信: 'taskTemplate.connector.wecom',
  飞书: 'taskTemplate.connector.feishu',
};

export const taskTemplateOptionLabel = (value: string) => {
  const id = OPTION_MESSAGE_IDS[value];
  return id ? getIntl().formatMessage({ id }) : value;
};
