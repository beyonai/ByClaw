// @ts-nocheck
import { getLocale } from '@umijs/max';
import { POST } from '@/service/common/request';
import { getSessionKey, getssoToken, getToken, ssotokenKey, tokenKey } from '@/pages/manager/utils/auth';
import { generateSignature } from '@/pages/manager/utils/signature';

const withCustomHandle = {
  responseCfg: {
    customHandle: true,
  },
};

export async function getModelListByPage(params: any) {
  return POST('/byaiService/new/model/getModelListByPage', { ...params }, withCustomHandle);
}

export async function getModelDetail(params: any) {
  return POST('/byaiService/new/model/getModelDetail', { ...params }, withCustomHandle);
}

export async function upsertModel(params: any) {
  return POST('/byaiService/new/model/upsertModel', { ...params }, withCustomHandle);
}

export async function deleteModel(params: any) {
  return POST('/byaiService/new/model/deleteModel', { ...params }, withCustomHandle);
}

export async function setModelStatus(params: any) {
  return POST('/byaiService/new/model/setModelStatus', { ...params }, withCustomHandle);
}

export async function setDefaultModel(params: any) {
  return POST('/byaiService/new/model/setDefaultModel', { ...params }, withCustomHandle);
}

const getDeltaText = (payload: any) => {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;

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

export async function debugModelStream(params: any) {
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

  const response = await fetch('/byaiService/new/model/debugModelStream', {
    method: 'POST',
    headers,
    body: JSON.stringify(finalPayload),
    signal,
  });

  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || `HTTP ${response.status}`);
  }

  if (!contentType.includes('text/event-stream')) {
    const json = await response.json();
    return json;
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    return {
      code: 0,
      data: {
        output: '',
        success: true,
      },
    };
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let output = '';

  const handleDataLine = (line: string): boolean => {
    if (!line.startsWith('data:')) return false;
    const raw = line.slice(5).trim();
    if (!raw) return false;
    if (raw === '[DONE]') return true;

    try {
      const parsed = JSON.parse(raw);
      const delta = getDeltaText(parsed);
      if (delta) {
        output += delta;
        onDelta?.(delta);
      }
    } catch (error) {
      output += raw;
      onDelta?.(raw);
    }

    return false;
  };

  const flushBufferLines = (): boolean => {
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (handleDataLine(trimmed)) return true;
    }
    return false;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    if (flushBufferLines()) {
      return {
        code: 0,
        data: {
          output,
          success: true,
        },
      };
    }
  }

  if (buffer.trim()) {
    handleDataLine(buffer.trim());
  }

  return {
    code: 0,
    data: {
      output,
      success: true,
    },
  };
}
