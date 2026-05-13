import dayjs from 'dayjs';
import { PictureOutlined } from '@ant-design/icons';
import { isNumber, isNil } from 'lodash';

export const formatTime = (updateTimeStr: string, createTime: string) => {
  const myUpdateTimeStr = Number(updateTimeStr) ? Number(updateTimeStr) : updateTimeStr;
  const myCreateTime = Number(createTime) ? Number(createTime) : createTime;

  let timeStr: number | string = myUpdateTimeStr;
  if (isNumber(timeStr) && timeStr < 0) {
    timeStr = myCreateTime;
  } else if (isNil(timeStr)) {
    timeStr = myCreateTime;
  }

  let displayCreateTime = timeStr;
  if (displayCreateTime) {
    const createTimeDayjsObj = dayjs(displayCreateTime);
    const isSameDay = createTimeDayjsObj.isSame(dayjs(), 'day');

    if (isSameDay) {
      displayCreateTime = createTimeDayjsObj.format('HH:mm');
    } else {
      displayCreateTime = createTimeDayjsObj.format('MM-DD');
    }
  }

  return displayCreateTime;
};

/**
 * 处理伪 JSON 格式的 sessionContent，提取 step_topic 字段
 * @param content 原始内容
 * @returns 处理后的内容
 */
export const processSessionContent = (content: string): React.ReactNode => {
  if (!content || typeof content !== 'string') {
    return '';
  }

  // 检查是否包含伪 JSON 格式的特征
  if (content.includes('"steps"') || content.includes('"step_topic"')) {
    // JSON 解析失败，使用正则表达式提取
    const stepTopicMatch = content.match(/"step_topic"\s*:\s*"([^"]+)"/);
    if (stepTopicMatch && stepTopicMatch[1]) {
      return stepTopicMatch[1];
    }

    return '';
  }
  // 将markdown的代码格式去掉，保留内容即可
  const handledContent = content
    .replace(/^\s+/, '')
    .replace(/^\\n+/, '')
    .replace(/```\w+\s/, '')
    .replace(/\s```/, '')
    .replace(/#+\s/g, '')
    .replace(/\{\{[^}]+\}\}/g, '');
  if (/<img\s+[^>]*src=/i.test(handledContent)) {
    // 将图片换成这个icon。暂时发现以这个开头的话，整个内容都是图片了。
    return <PictureOutlined />;
  }
  if (handledContent.startsWith('{"')) {
    // 不展示JSON。暂时发现以这个开头的话，整个内容都是JSON了。
    return '';
  }
  return handledContent;
};
