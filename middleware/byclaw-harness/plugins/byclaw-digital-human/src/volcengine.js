import { createHash, createHmac } from 'node:crypto';
import { configurationRequired } from './config.js';

export const MODES = Object.freeze({
  normal: ['realman_avatar_picture_create_role', 'realman_avatar_picture_v2'],
  loopy: ['realman_avatar_picture_create_role_loopy', 'realman_avatar_picture_loopy'],
  loopyb: ['realman_avatar_picture_create_role_loopyb', 'realman_avatar_picture_loopyb'],
});
const HOST = 'visual.volcengineapi.com';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

function failure(code, message = code, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

/** Volcengine HMAC-SHA256; fixed service route prevents credential forwarding to arbitrary hosts. */
export function signedRequest(credentials, action, payload, now = new Date()) {
  if (!['CVSubmitTask', 'CVGetResult'].includes(action)) throw failure('DIGITAL_HUMAN_INVALID_ACTION');
  const body = JSON.stringify(payload);
  const date = now.toISOString().replace(/[:-]|\.\d{3}/gu, '');
  const day = date.slice(0, 8);
  const query = `Action=${action}&Version=2022-08-31`;
  const headers = { 'content-type': 'application/json', host: HOST, 'x-content-sha256': hash(body), 'x-date': date };
  if (credentials.securityToken) headers['x-security-token'] = credentials.securityToken;
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonical = ['POST', '/', query, names.map((key) => `${key}:${headers[key]}\n`).join(''), signedHeaders, hash(body)].join('\n');
  const scope = `${day}/cn-north-1/cv/request`;
  const signingKey = hmac(hmac(hmac(hmac(credentials.secretAccessKey, day), 'cn-north-1'), 'cv'), 'request');
  const signature = hmac(signingKey, `HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).toString('hex');
  headers.authorization = `HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `https://${HOST}/?${query}`, init: { method: 'POST', redirect: 'error', headers, body } };
}

export async function readJson(response) {
  if (!response.body) throw failure('DIGITAL_HUMAN_INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw failure('DIGITAL_HUMAN_INVALID_RESPONSE');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    await reader.cancel().catch(() => {});
    throw failure('DIGITAL_HUMAN_INVALID_RESPONSE');
  } finally { reader.releaseLock(); }
}

export function publicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw failure('DIGITAL_HUMAN_INVALID_URL'); }
  const host = url.hostname.toLowerCase();
  // Provider fetches these URLs, so reject local addresses and embedded credentials.
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash
    || !host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
    || /^[\d.]+$/u.test(host) || host.includes(':')) throw failure('DIGITAL_HUMAN_INVALID_URL');
  return value;
}

export async function invoke(credentials, stage, mode, args, query, signal) {
  const reqKey = MODES[mode][stage === 'role' ? 0 : 1];
  const payload = { req_key: reqKey, ...(query ? { task_id: args.taskId }
    : stage === 'role' ? { image_url: publicUrl(args.imageUrl) }
      : { resource_id: args.resourceId, audio_url: publicUrl(args.audioUrl) }) };
  const { url, init } = signedRequest(credentials, query ? 'CVGetResult' : 'CVSubmitTask', payload);
  const timeout = AbortSignal.timeout(60000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  combined.throwIfAborted();
  let response;
  let value;
  try {
    response = await fetch(url, { ...init, signal: combined });
    value = await readJson(response);
  } catch (error) {
    signal?.throwIfAborted();
    if (error?.code === 'DIGITAL_HUMAN_INVALID_RESPONSE') throw error;
    // A lost submit response can still mean the paid task was accepted. Never retry automatically.
    throw failure('DIGITAL_HUMAN_REQUEST_UNCERTAIN', query ? '查询失败，可稍后查询原任务。' : '提交结果不确定，任务可能已受理；请先检查供应商任务记录，勿直接重复提交。', { retryable: false });
  }
  combined.throwIfAborted();
  if ([401, 403].includes(response.status) || value?.code === 50400 || value?.ResponseMetadata?.Error?.Code?.startsWith('InvalidAccessKey')) {
    throw configurationRequired();
  }
  if (!response.ok || value?.code !== 10000) {
    const providerCode = Number.isSafeInteger(value?.code) ? String(value.code) : `HTTP_${response.status}`;
    throw failure('DIGITAL_HUMAN_PROVIDER_ERROR', `火山单图音频驱动请求失败（${providerCode}）；未自动重试。`, { providerCode, retryable: false });
  }
  return normalizeResult(value, stage, mode, args, query);
}

function identifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/u.test(value);
}

export function normalizeResult(value, stage, mode, args, query) {
  const data = value.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure('DIGITAL_HUMAN_INVALID_RESPONSE');
  const result = { stage, mode, taskId: query ? args.taskId : data.task_id, status: query ? data.status : 'submitted' };
  if (!identifier(result.taskId)) throw failure('DIGITAL_HUMAN_INVALID_RESPONSE');
  if (identifier(value.request_id)) result.requestId = value.request_id;
  if (!query) return result;
  if (!['in_queue', 'generating', 'done', 'not_found', 'expired'].includes(data.status)) throw failure('DIGITAL_HUMAN_INVALID_RESPONSE');
  if (['in_queue', 'generating'].includes(data.status)) return { ...result, pollAfterSeconds: 10 };
  if (data.status !== 'done') return result;
  let nested = {};
  try { nested = data.resp_data ? JSON.parse(data.resp_data) : {}; } catch { throw failure('DIGITAL_HUMAN_INVALID_RESPONSE'); }
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) throw failure('DIGITAL_HUMAN_INVALID_RESPONSE');
  if ([nested.code, nested.algorithm_status_code, stage === 'role' ? nested.status : undefined]
    .some((code) => code !== undefined && code !== 0)) throw failure('DIGITAL_HUMAN_TASK_FAILED');
  if (stage === 'role') {
    if (!identifier(nested.resource_id)) throw failure('DIGITAL_HUMAN_INVALID_RESPONSE');
    return { ...result, resourceId: nested.resource_id };
  }
  const urls = data.video_url ? [data.video_url] : typeof nested.preview_url === 'string' ? [nested.preview_url] : nested.preview_url;
  if (!Array.isArray(urls) || !urls.length || urls.length > 8 || urls.some((url) => typeof url !== 'string' || url.length > 16384)) throw failure('DIGITAL_HUMAN_INVALID_RESPONSE');
  return { ...result, videoUrls: urls.map(publicUrl), urlValidForSeconds: 3600 };
}
