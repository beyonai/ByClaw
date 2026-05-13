import dayjs from 'dayjs';

/**
 * 对象转成 query 字符串
 */
export const Obj2Query = (obj: Record<string, string | number>) => {
  const queryParams = new URLSearchParams();
  // eslint-disable-next-line guard-for-in
  for (const key in obj) {
    queryParams.append(key, `${obj[key]}`);
  }
  return queryParams.toString();
};

export const areAllValuesPresent = (jsonObject: Record<string, any>) => {
  for (const key in jsonObject) {
    if (!jsonObject[key] && jsonObject[key] !== 0) {
      return false;
    }
  }
  return true;
};

/**
 * parse string to query object
 */
export const parseQueryString = (str: string) => {
  const queryObject: Record<string, any> = {};

  const splitStr = str.split('?');

  // eslint-disable-next-line no-param-reassign
  str = splitStr[1] || splitStr[0];

  // 将字符串按照 '&' 分割成键值对数组
  const keyValuePairs = str.split('&');

  // 遍历键值对数组，将每个键值对解析为对象的属性和值
  keyValuePairs.forEach((keyValuePair) => {
    const pair = keyValuePair.split('=');
    const key = decodeURIComponent(pair[0]);
    const value = decodeURIComponent(pair[1] || '');

    // 如果对象中已经存在该属性，则将值转换为数组
    if (queryObject.hasOwnProperty(key)) {
      if (!Array.isArray(queryObject[key])) {
        queryObject[key] = [queryObject[key]];
      }
      queryObject[key].push(value);
    } else {
      queryObject[key] = value;
    }
  });

  return queryObject;
};

/**
 * 格式化时间成聊天格式
 */
export const formatTimeToChatTime = (time: Date) => {
  const now = dayjs();
  const target = dayjs(time);

  // 如果传入时间小于60秒，返回刚刚
  if (now.diff(target, 'second') < 60) {
    return '刚刚';
  }

  // 如果时间是今天，展示几时:几秒
  if (now.isSame(target, 'day')) {
    return target.format('HH:mm');
  }

  // 如果是昨天，展示昨天
  if (now.subtract(1, 'day').isSame(target, 'day')) {
    return '昨天';
  }

  // 如果是前天，展示前天
  if (now.subtract(2, 'day').isSame(target, 'day')) {
    return '前天';
  }

  // 如果是今年，展示某月某日
  if (now.isSame(target, 'year')) {
    return target.format('M月D日');
  }

  // 如果是更久之前，展示某年某月某日
  return target.format('YYYY/M/D');
};

// 将数组转成树
export function arrayToTree(
  array: any[],
  id: string = 'grpId',
  pid: string = 'parentGrpId',
  children: string = 'children'
) {
  const data = [...array];
  const result: any[] = [];
  const hash: { [key: string]: any } = {};
  data.forEach((item) => {
    hash[item[id]] = item;
  });
  data.forEach((item) => {
    // 判断一些有些奇葩数据就是 自己是根节点的时候自己的pId === id
    const hashVP = item[pid] === item[id] ? undefined : hash[item[pid]];
    if (hashVP) {
      if (!hashVP[children]) {
        hashVP[children] = [];
      }
      hashVP[children].push(item);
    } else {
      result.push(item);
    }
  });
  return result;
}

export const getParentsIdsByList = (
  array: Record<any, any>[],
  currentId: string = '',
  id: string = 'grpId',
  pid: string = 'parentGrpId'
) => {
  const ids: string[] = [];
  const loop = (array: Record<any, any>[], currentId: string) => {
    array.forEach((item) => {
      if (item[id] === currentId) {
        ids.push(item[pid]);
        loop(array, item[pid]);
      }
    });
  };

  loop(array, currentId);
  return ids;
};

export const getLabelInArray = (
  datasource: any[] = [],
  value: number | string,
  labelField: string = 'label',
  valueField: string = 'value'
) => {
  const obj = datasource.find((o) => o[valueField] === value);
  return obj ? obj[labelField] : '';
};

// 转义正则表达式特殊字符的函数
export function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function debounceByIdleCallback(fn: (...args: any[]) => void) {
  let callCount = 0;
  return function (...args: any[]) {
    callCount += 1;
    const run = () => {
      if (callCount === 1) {
        fn(...args);
      } else {
        callCount -= 1;
      }
    };
    requestIdleCallback(run);
  };
}
