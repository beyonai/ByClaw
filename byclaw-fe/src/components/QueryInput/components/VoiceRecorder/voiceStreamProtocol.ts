import { getToken } from '@/utils/auth';
import { decryptBySM } from '@/utils/encrypt/sm';

type Update = { ready?: boolean; text?: string; final?: boolean };

export interface VoiceStreamProtocol {
  url: string;
  authenticate?: string;
  frameBytes: number;
  frameInterval: number;
  encode(bytes: Uint8Array | undefined, first: boolean, final: boolean): string | ArrayBuffer;
  receive(data: unknown): Update;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function hasCredential(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function credential(value: unknown): string {
  if (!hasCredential(value)) throw new Error();
  const decrypted = decryptBySM(value)?.trim();
  if (!decrypted) throw new Error();
  return decrypted;
}

function readWord(part: unknown): string {
  const candidates = record(part).cw;
  const word = Array.isArray(candidates) ? record(candidates[0]).w : undefined;
  return typeof word === 'string' ? word : '';
}

async function spark(config: Record<string, unknown>): Promise<VoiceStreamProtocol> {
  const appId = credential(config.appIdEncrypted);
  const credentials = record(config.credentials);
  const key = credential(credentials.apiKeyEncrypted);
  const secret = credential(credentials.apiSecretEncrypted);
  const resource = config.hotwordResourceId;
  if (resource !== undefined && (typeof resource !== 'string' || !resource.trim())) throw new Error();

  const url = new URL('wss://iat.cn-huabei-1.xf-yun.com/v1');
  const date = new Date().toUTCString();
  const input = `host: ${url.host}\ndate: ${date}\nGET ${url.pathname} HTTP/1.1`;
  const encoder = new TextEncoder();
  const signingKey = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await window.crypto.subtle.sign('HMAC', signingKey, encoder.encode(input));
  const signature = btoa(String.fromCharCode(...new Uint8Array(digest)));
  const authorization = btoa(
    `api_key="${key}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`
  );
  url.search = new URLSearchParams({ authorization, date, host: url.host }).toString();

  const parameter = {
    iat: {
      domain: 'spark_asr_v2',
      language: 'zh_cn',
      accent: 'mandarin',
      eos: 60000,
      dwa: 'wpgs',
      result: { encoding: 'utf8', compress: 'raw', format: 'json' },
    },
  };
  let sequence = 0;
  const seen = new Set<number>();
  const segments = new Map<number, string>();
  return {
    url: url.toString(),
    frameBytes: 1280,
    frameInterval: 40,
    encode(bytes, first, final) {
      const status = final ? 2 : first ? 0 : 1;
      return JSON.stringify({
        header: { app_id: appId, res_id: resource, status },
        parameter: first ? parameter : undefined,
        payload: {
          audio: {
            encoding: 'raw',
            sample_rate: 16000,
            channels: 1,
            bit_depth: 16,
            seq: ++sequence,
            status,
            audio: bytes ? btoa(String.fromCharCode(...bytes)) : '',
          },
        },
      });
    },
    receive(data) {
      if (typeof data !== 'string') throw new Error();
      const message = record(JSON.parse(data));
      const header = record(message.header);
      if (header.code !== 0) throw new Error();
      const final = header.status === 2;
      const encoded = record(record(message.payload).result).text;
      if (typeof encoded !== 'string' || !encoded) return { final };
      const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const result = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      if (typeof result.ret === 'number' && result.ret !== 0) throw new Error();
      const { sn, rg, ws } = result;
      if (typeof sn !== 'number' || seen.has(sn)) return { final };
      seen.add(sn);
      if (result.pgs === 'rpl' && Array.isArray(rg) && rg.length === 2) {
        for (const id of segments.keys()) if (id >= rg[0] && id <= rg[1]) segments.delete(id);
      }
      const words = Array.isArray(ws) ? ws.map(readWord).join('') : '';
      segments.set(sn, words);
      const text = [...segments]
        .sort(([a], [b]) => a - b)
        .map(([, value]) => value)
        .join('');
      return { final, text };
    },
  };
}

function packet(kind: number, serialization: number, bytes: Uint8Array = new Uint8Array()): ArrayBuffer {
  const buffer = new ArrayBuffer(8 + bytes.length);
  const view = new DataView(buffer);
  view.setUint8(0, 0x11);
  view.setUint8(1, kind);
  view.setUint8(2, serialization);
  view.setUint32(4, bytes.length);
  new Uint8Array(buffer, 8).set(bytes);
  return buffer;
}

function volcengine(config: Record<string, unknown>): VoiceStreamProtocol {
  const resource = config.resourceId;
  if (resource !== 'volc.seedasr.sauc.duration' && resource !== 'volc.seedasr.sauc.concurrent') throw new Error();
  const credentials = record(config.credentials);
  if (credentials.apiKeyEncrypted === undefined) {
    if (!hasCredential(config.appIdEncrypted) || !hasCredential(credentials.accessTokenEncrypted)) throw new Error();
  } else if (!hasCredential(credentials.apiKeyEncrypted)) {
    throw new Error();
  }
  const token = getToken();
  if (!token) throw new Error();
  const url = new URL('/byaiService/voice/stream', window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return {
    url: url.toString(),
    authenticate: JSON.stringify({ token }),
    frameBytes: 6400,
    frameInterval: 200,
    encode: (bytes, _first, final) => packet(final ? 0x22 : 0x20, 0, bytes),
    receive(data) {
      if (typeof data === 'string' && record(JSON.parse(data)).ready === true) return { ready: true };
      if (!(data instanceof ArrayBuffer) || data.byteLength < 8) throw new Error();
      const view = new DataView(data);
      const header = view.getUint8(0);
      const type = view.getUint8(1);
      const flags = type & 15;
      const headerBytes = (header & 15) * 4;
      if (header >> 4 !== 1 || headerBytes < 4 || type >> 4 !== 9 || flags > 3 || view.getUint8(2) !== 0x10) {
        throw new Error();
      }
      const sizeOffset = headerBytes + (flags & 1 ? 4 : 0);
      const offset = sizeOffset + 4;
      if (view.getUint32(sizeOffset) !== data.byteLength - offset) throw new Error();
      const result = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(data, offset))));
      const text = record(result.result).text;
      if (text !== undefined && typeof text !== 'string') throw new Error();
      return { text, final: Boolean(flags & 2) };
    },
  };
}

export async function createVoiceStream(raw: string): Promise<VoiceStreamProtocol> {
  const config = record(JSON.parse(raw));
  if (config.type === 'xunfei-spark-asr-v2') return spark(config);
  if (config.type === 'volcengine-streaming-asr-v2') return volcengine(config);
  throw new Error();
}
