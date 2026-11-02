// @ts-nocheck
import { getIntl, getLocale } from '@umijs/max';
import { GET, POST } from '@/service/common/request';
import { removeCachedModelHealth } from '@/service/modelHealth';
import { getSessionKey, getssoToken, getToken, ssotokenKey, tokenKey } from '@/pages/manager/utils/auth';
import { generateSignature } from '@/pages/manager/utils/signature';

const withCustomHandle = {
  responseCfg: {
    customHandle: true,
  },
};

export interface ModelListByPageParams {
  pageNum: number;
  pageSize: number;
  modelType?: string;
  status?: string;
  keyword?: string;
  ability?: string;
  system?: string;
  ownerType?: string;
}

export interface ModelListItem {
  id?: string;
  modelId?: string;
  modelName?: string;
  displayName?: string;
  modelCode?: string;
  modelType?: string;
  status?: string;
}

export interface ModelListPageData {
  rows?: ModelListItem[];
  list?: ModelListItem[];
  pageNum?: number;
  pageIndex?: number;
  pageSize?: number;
  total?: number;
}

export interface ModelListByPageResponse {
  code?: number;
  msg?: string;
  data?: ModelListPageData;
  rows?: ModelListItem[];
  list?: ModelListItem[];
}

export async function getModelListByPage(params: ModelListByPageParams): Promise<ModelListByPageResponse> {
  return POST<ModelListByPageResponse>('/byaiService/new/model/getModelListByPage', { ...params }, withCustomHandle);
}

export async function getPersonalModelList(params: ModelListByPageParams): Promise<ModelListByPageResponse> {
  return POST<ModelListByPageResponse>('/byaiService/personal/model/list', { ...params }, withCustomHandle);
}

export async function getPublicModelList(params: ModelListByPageParams): Promise<ModelListByPageResponse> {
  return POST<ModelListByPageResponse>('/byaiService/personal/model/listPublic', { ...params }, withCustomHandle);
}

export async function getModelDetail(params: any) {
  return POST('/byaiService/new/model/getModelDetail', { ...params }, withCustomHandle);
}

export async function upsertModel(params: any) {
  return POST('/byaiService/new/model/upsertModel', { ...params }, withCustomHandle);
}

export async function deleteModel(params: any) {
  const response = await POST('/byaiService/new/model/deleteModel', { ...params }, withCustomHandle);
  if (response?.code === 0 && response?.success !== false && response?.data !== false)
    await removeCachedModelHealth(params.id);
  return response;
}

export async function setModelStatus(params: any) {
  return POST('/byaiService/new/model/setModelStatus', { ...params }, withCustomHandle);
}

export async function setDefaultModel(params: any) {
  return POST('/byaiService/new/model/setDefaultModel', { ...params }, withCustomHandle);
}

export async function completeAllModelConfig() {
  return GET('/byaiService/new/model/completeAllModelConfig', {}, { ...withCustomHandle, languageConf: false });
}

const getDeltaText = (payload: any) => {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;

  // Responses 的正文增量直接位于 delta；结束事件含完整正文，不能再次追加。
  if (typeof payload?.type === 'string' && payload.type.startsWith('response.')) {
    return payload.type === 'response.output_text.delta' && typeof payload.delta === 'string' ? payload.delta : '';
  }

  // Anthropic Messages API SSE: content_block_delta + delta.text
  if (payload?.type === 'content_block_delta') {
    const anthropicText = payload?.delta?.text;
    if (typeof anthropicText === 'string') return anthropicText;
  }

  return (
    payload?.choices?.[0]?.delta?.content ||
    payload?.choices?.[0]?.message?.content ||
    payload?.delta?.content ||
    payload?.delta?.text ||
    payload?.content ||
    payload?.output ||
    ''
  );
};

export async function debugModelNonStream(params: any) {
  const { signal, onDelta, ...payload } = params || {};
  void signal;
  void onDelta;
  return POST('/byaiService/new/model/debugModelRerank', { ...payload }, withCustomHandle);
}

export async function debugModelEmbedding(params: any) {
  const { signal, onDelta, ...payload } = params || {};
  void signal;
  void onDelta;
  return POST('/byaiService/new/model/debugModelEmbedding', { ...payload }, withCustomHandle);
}

export async function debugModelImageGeneration(params: any) {
  const { signal, onDelta, ...payload } = params || {};
  void onDelta;
  return POST(
    '/byaiService/new/model/debugModelImageGeneration',
    { ...payload },
    {
      ...withCustomHandle,
      cancelToken: signal ? ({ signal } as AbortController) : undefined,
      timeout: 125000,
    }
  );
}

async function requestModelDebugStream(endpoint: string, params: any) {
  const { signal, onDelta, ...payload } = params || {};
  const finalPayload = {
    ...payload,
    language: getLocale(),
  };

  const headers = {
    'Content-Type': 'application/json',
    [tokenKey]: getToken(),
    [ssotokenKey]: getssoToken(),
    'x-session-id': getSessionKey(),
    language: getLocale(),
    ...generateSignature('POST', finalPayload),
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(finalPayload),
    signal,
  });

  const contentType = response.headers.get('content-type') || '';
  const assertSuccessful = (payload: any) => {
    if (
      payload?.success === false ||
      (payload?.code !== undefined && `${payload.code}` !== '0') ||
      payload?.error ||
      ['response.failed', 'response.incomplete', 'error'].includes(payload?.type)
    ) {
      throw new Error(
        payload?.msg ||
          payload?.response?.error?.message ||
          payload?.error?.message ||
          payload?.message ||
          getIntl().formatMessage({ id: 'modelMgr.error.invalidDebugResponse' })
      );
    }
  };

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || `HTTP ${response.status}`);
  }

  if (!contentType.includes('text/event-stream')) {
    const json = await response.json();
    assertSuccessful(json);
    throw new Error(getIntl().formatMessage({ id: 'modelMgr.error.invalidDebugResponse' }));
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error(getIntl().formatMessage({ id: 'modelMgr.error.invalidDebugResponse' }));
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let output = '';
  let eventType = '';
  let eventData: string[] = [];

  const flushEvent = (): boolean => {
    const raw = eventData.join('\n').trim();
    const type = eventType;
    eventData = [];
    eventType = '';
    if (type === 'error' && !raw)
      throw new Error(getIntl().formatMessage({ id: 'modelMgr.error.invalidDebugResponse' }));
    if (!raw) return false;
    if (raw === '[DONE]' && type !== 'error') return true;

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(getIntl().formatMessage({ id: 'modelMgr.error.invalidDebugResponse' }));
    }
    assertSuccessful(parsed);
    if (type === 'error') {
      throw new Error(parsed?.message || getIntl().formatMessage({ id: 'modelMgr.error.invalidDebugResponse' }));
    }
    const delta = getDeltaText(parsed);
    if (typeof delta === 'string' && delta) {
      output += delta;
      onDelta?.(delta);
    }

    return false;
  };

  const handleDataLine = (line: string): boolean => {
    if (!line) return flushEvent();
    if (line.startsWith('event:')) eventType = line.slice(6).trim();
    if (line.startsWith('data:')) {
      eventData.push(line.slice(5).trimStart());
      const raw = eventData.join('\n').trim();
      let complete = raw === '[DONE]';
      if (!complete) {
        try {
          JSON.parse(raw);
          complete = true;
        } catch {
          // Keep accumulating multi-line JSON until the event boundary or a complete value.
        }
      }
      // Preserve support for gateways that omit the blank line between complete JSON events.
      if (complete) return flushEvent();
    }
    return false;
  };

  const flushBufferLines = (): boolean => {
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (handleDataLine(trimmed)) return true;
    }
    return false;
  };

  const result = () => {
    if (!output.trim()) throw new Error(getIntl().formatMessage({ id: 'modelMgr.error.invalidDebugResponse' }));
    return { code: 0, data: { output, success: true } };
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      if (flushBufferLines()) {
        return result();
      }
    }

    if (buffer.trim()) {
      handleDataLine(buffer.trim());
    }
    flushEvent();

    return result();
  } finally {
    await Promise.resolve(reader.cancel?.()).catch(() => undefined);
    reader.releaseLock?.();
  }
}

export async function debugModelAsr(params: any) {
  const { signal, input, id } = params || {};
  let audio: any;
  try {
    audio = JSON.parse(input || '{}');
  } catch {
    throw new Error(getIntl().formatMessage({ id: 'modelMgr.modal.asrInputInvalid' }));
  }
  return POST(
    '/byaiService/new/model/debugModelAsr',
    { ...audio, id },
    {
      ...withCustomHandle,
      cancelToken: signal ? ({ signal } as AbortController) : undefined,
      timeout: 185000,
    }
  );
}

export async function debugModelTts(params: any) {
  const { signal, input, id } = params || {};
  let speech: any;
  try {
    speech = JSON.parse(input || '{}');
  } catch {
    throw new Error(getIntl().formatMessage({ id: 'modelMgr.modal.ttsInputInvalid' }));
  }
  return POST(
    '/byaiService/new/model/debugModelTts',
    { ...speech, id },
    {
      ...withCustomHandle,
      cancelToken: signal ? ({ signal } as AbortController) : undefined,
      timeout: 185000,
    }
  );
}

export async function debugModelStream(params: any) {
  return requestModelDebugStream('/byaiService/new/model/debugModelStream', params);
}

export async function debugPersonalModelStream(params: any) {
  return requestModelDebugStream('/byaiService/personal/model/debug', params);
}
