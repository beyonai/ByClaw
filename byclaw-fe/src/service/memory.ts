import { POST } from '@/service/common/request';

// 固化记忆生成
export async function generateFixedMemory(params: any, abortController: AbortController) {
  return POST<any>('/byaiService/chat/generateFixedMemory', params, {
    cancelToken: abortController,
  });
}

// 固化记忆保存
export async function saveFixedMemory(params: any, abortController?: AbortController) {
  return POST<any>('/byaiService/chat/saveFixedMemory', params, {
    cancelToken: abortController,
  });
}

// 分页查询固化记忆
export async function selectFixedMemoryByQo(params: any, abortController?: AbortController) {
  return POST<any>('/byaiService/chat/selectFixedMemoryByQo', params, {
    cancelToken: abortController,
  });
}

// 删除固化记忆
export async function removeFixedMemory(params: any, abortController?: AbortController) {
  return POST<any>('/byaiService/chat/removeFixedMemory', params, {
    cancelToken: abortController,
  });
}
