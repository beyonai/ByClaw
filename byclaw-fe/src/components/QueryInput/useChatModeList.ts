import { useState, useEffect } from 'react';
import { useSelector } from '@umijs/max';
import { IChatModeType } from '@/constants/query';
import { GET } from '@/service/common/request';

export type IChatMode = {
  modeCode: IChatModeType;
  modeName: string;
  isDefault: '0' | '1'; // 是否默认模式
  showDigitalHuman: '0' | '1'; // 是否显示数字员工
  relations?: {
    resourceId: string; // 数字员工ID
    resourceName: string; // 数字员工名称
  }[];
};

/** 前端缓存：有数据时不再重复请求 */
let cachedChatModeList: IChatMode[] | null = null;

export function useChatModeList() {
  const [chatModeList, setChatModeList] = useState<IChatMode[]>([]);
  const userInfo = useSelector((state: { user: { userInfo?: unknown } }) => state.user?.userInfo);

  useEffect(() => {
    // 无 userInfo 时不发起请求
    if (!userInfo) {
      return;
    }
    // 有缓存时直接使用，不再请求
    if (cachedChatModeList && cachedChatModeList.length > 0) {
      setChatModeList(cachedChatModeList);
      return;
    }
    GET<IChatMode[] | { list?: IChatMode[] }>('/byaiService/mode/getModeList')
      .then((res) => {
        const list = Array.isArray(res) ? res : res?.list ?? [];
        setChatModeList(list);
        cachedChatModeList = list;
      })
      .catch(() => {
        // 请求失败时保持当前 state，可在此增加错误提示
      });
  }, [userInfo]);

  return chatModeList;
}
