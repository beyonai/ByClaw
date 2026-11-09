import { randomUUID } from 'node:crypto';
import { extname, isAbsolute } from 'node:path';

const MIB = 1024 * 1024;
const formats = {
  '.jpg': { kind: 'image', type: 'image/jpeg', magic: (bytes) => bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
  '.png': { kind: 'image', type: 'image/png', magic: (bytes) => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  '.wav': { kind: 'audio', type: 'audio/wav', magic: (bytes) => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE' },
  '.mp3': { kind: 'audio', type: 'audio/mpeg', magic: (bytes) => bytes.toString('ascii', 0, 3) === 'ID3'
    || (bytes.length >= 4 && bytes[0] === 0xff && (bytes[1] & 0xe6) === 0xe2) },
};

function readOssConfig() {
  const { OSS_BUCKET, OSS_REGION, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_SESSION_TOKEN } = process.env;
  const region = OSS_REGION?.replace(/^oss-/u, '');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(OSS_BUCKET ?? '')
    || !/^[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(region ?? '')
    || !OSS_ACCESS_KEY_ID?.trim() || !OSS_ACCESS_KEY_SECRET?.trim()) {
    throw new Error('DIGITAL_HUMAN_OSS_CONFIGURATION_REQUIRED: 请配置 OSS_BUCKET、OSS_REGION、OSS_ACCESS_KEY_ID 和 OSS_ACCESS_KEY_SECRET。');
  }
  return { bucket: OSS_BUCKET, region: `oss-${region}`, accessKeyId: OSS_ACCESS_KEY_ID,
    accessKeySecret: OSS_ACCESS_KEY_SECRET, stsToken: OSS_SESSION_TOKEN || undefined, secure: true, authorizationV4: true };
}

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

export async function uploadMedia(fs, workspace, path, kind, signal) {
  signal?.throwIfAborted();
  const config = readOssConfig();
  const { bytes, extension, contentType } = await readMedia(fs, workspace, path, kind, signal);
  const key = `digital-human/${randomUUID()}${extension}`;
  const headers = { 'content-type': contentType, 'x-oss-object-acl': 'public-read' };
  let signedUrl;
  try {
    const { default: OSS } = await import('ali-oss');
    const client = new OSS(config);
    signedUrl = new URL(await client.signatureUrlV4('PUT', 600, { headers }, key));
    if (signedUrl.origin !== `https://${config.bucket}.${config.region}.aliyuncs.com`) throw new Error('Unexpected OSS endpoint');
  } catch {
    throw new Error('DIGITAL_HUMAN_OSS_SIGN_FAILED: 请检查 OSS SDK 和环境变量。');
  }

  const timeout = AbortSignal.timeout(60000);
  const uploadSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  uploadSignal.throwIfAborted();
  let response;
  try {
    response = await fetch(signedUrl, { method: 'PUT', headers, body: bytes, signal: uploadSignal, redirect: 'error' });
    await response.body?.cancel();
  } catch {
    signal?.throwIfAborted();
    throw new Error('DIGITAL_HUMAN_OSS_UPLOAD_UNCERTAIN: 上传结果未知，请先检查 OSS 中的对象。');
  }
  if (!response.ok) {
    const code = response.headers.get('x-oss-ec');
    const detail = /^\d{4}-\d{8}$/u.test(code ?? '') ? `，OSS ${code}` : '';
    throw new Error(`DIGITAL_HUMAN_OSS_UPLOAD_FAILED: HTTP ${response.status}${detail}`);
  }
  signal?.throwIfAborted();
  return `${signedUrl.origin}${signedUrl.pathname}`;
}
