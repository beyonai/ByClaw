import { publicUrl, readJson } from './volcengine.js';
import { extname, isAbsolute } from 'node:path';

const MIB = 1024 * 1024;
const formats = {
  '.jpg': { kind: 'image', type: 'image/jpeg', magic: (bytes) => bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
  '.png': { kind: 'image', type: 'image/png', magic: (bytes) => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  '.wav': { kind: 'audio', type: 'audio/wav', magic: (bytes) => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE' },
  '.mp3': { kind: 'audio', type: 'audio/mpeg', magic: (bytes) => bytes.toString('ascii', 0, 3) === 'ID3'
    || (bytes.length >= 4 && bytes[0] === 0xff && (bytes[1] & 0xe6) === 0xe2) },
};

async function readMedia(fs, workspace, path, kind, signal) {
  if (typeof workspace !== 'string' || !isAbsolute(workspace)) throw new Error('DIGITAL_HUMAN_WORKSPACE_REQUIRED');
  const suffix = extname(path).toLowerCase();
  const extension = suffix === '.jpeg' ? '.jpg' : suffix;
  const format = formats[extension];
  if (format?.kind !== kind || /[\u0000-\u001f\u007f]/u.test(path)) throw new Error('DIGITAL_HUMAN_MEDIA_FORMAT_UNSUPPORTED');

  const limit = kind === 'image' ? 10 * MIB : 32 * MIB;
  let bytes;
  try {
    const root = await fs.resolve(workspace, { signal });
    const target = await fs.resolve(path, { cwd: workspace, signal });
    if (!fs.contains(root, target)) throw new Error('Outside the session workspace');
    const info = await fs.lstat(path, { cwd: workspace }, signal);
    if (info?.type !== 'file' || info.size > limit) throw new Error('Invalid file metadata');
    bytes = Buffer.from(await fs.readBytes(target, signal, limit));
  } catch {
    signal?.throwIfAborted();
    throw new Error('DIGITAL_HUMAN_MEDIA_UNREADABLE: 需要会话工作区内可读的普通文件，图片至多 10 MiB，音频至多 32 MiB。');
  }
  if (bytes.length > limit || !format.magic(bytes)) throw new Error('DIGITAL_HUMAN_MEDIA_FORMAT_UNSUPPORTED');
  return { bytes, extension, contentType: format.type };
}

// Keep public source media available through queueing and provider fetches.
export const ARTIFACT_TTL_SECONDS = 86400;

export async function uploadMedia(fs, workspace, path, kind, resolveBackend, signal) {
  signal?.throwIfAborted();
  const { bytes, extension, contentType } = await readMedia(fs, workspace, path, kind, signal);
  const backend = await resolveBackend(signal);
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: contentType }), `digital-human${extension}`);
  form.set('publishMode', 'FILE');
  form.set('expiresInSeconds', String(ARTIFACT_TTL_SECONDS));
  const timeout = AbortSignal.timeout(60000);
  const uploadSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  uploadSignal.throwIfAborted();
  let response;
  try {
    response = await fetch(backend.url, { method: 'POST', redirect: 'error', signal: uploadSignal,
      headers: { 'Beyond-Token': backend.token, 'X-User-Code': backend.userCode }, body: form });
  } catch {
    signal?.throwIfAborted();
    throw new Error('DIGITAL_HUMAN_ARTIFACT_UPLOAD_UNCERTAIN: 上传结果未知，请先检查已发布的 Artifact；不会自动重试或提交火山任务。');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`DIGITAL_HUMAN_ARTIFACT_UPLOAD_FAILED: HTTP ${response.status}`);
  }
  let result;
  try {
    const payload = await readJson(response);
    result = payload.data;
    if (![0, '0'].includes(payload.code) || result?.status !== 'READY' || result.kind !== 'FILE'
      || typeof result.artifactId !== 'string' || !result.artifactId
      || typeof result.previewUrl !== 'string' || !result.previewUrl.startsWith('https://')
      || typeof result.expiresAt !== 'string' || Date.parse(result.expiresAt) < Date.now() + 3600000
      || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error('Invalid publication');
    publicUrl(result.previewUrl);
  } catch {
    signal?.throwIfAborted();
    throw new Error('DIGITAL_HUMAN_ARTIFACT_INVALID_RESPONSE: 需要 READY 文件、公网 HTTPS 预览地址及至少一小时剩余有效期；请检查 ARTIFACT_PUBLIC_BASE_URL。');
  }
  signal?.throwIfAborted();
  // Never forward the management accessKey or the user's login token to Volcengine.
  return result.previewUrl;
}
