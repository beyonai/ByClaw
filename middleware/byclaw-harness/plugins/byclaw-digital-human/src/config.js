export const CONNECTOR_CODE = 'volcengine-digital-human';
export const DEFAULT_CONFIG_PATH = '/by/.connector-auth/.model/video.json';
const MAX_CONFIG_BYTES = 16 * 1024;
const CONFIG_FAILURE = Symbol('digital-human-config-failure');
const FS_CODES = new Set(['FS_NOT_FOUND', 'FS_NOT_DIRECTORY', 'FS_NOT_TEXT', 'FS_NOT_REGULAR_FILE', 'FS_TOO_LARGE',
  'FS_PERMISSION_DENIED', 'FS_SANDBOX_DENIED', 'FS_IO_ERROR', 'FS_ABORTED']);

export function configurationRequired(stage = 'authentication', reason = 'AUTHENTICATION_FAILED') {
  return Object.assign(new Error(`MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: connectorCode=${CONNECTOR_CODE}; 火山数字人视频连接器不可用（stage=${stage}; reason=${reason}）。请点击工具结果中的配置按钮，检查并重新保存连接信息；配置完成前停止重试当前工具。`), {
    code: 'DIGITAL_HUMAN_CONFIGURATION_REQUIRED', connectorCode: CONNECTOR_CODE,
    configurationRequired: true, retryable: false, stage, reason, [CONFIG_FAILURE]: true,
  });
}

function credential(value, maximum = 4096) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && value === value.trim() && !/[\s\u0000-\u001f\u007f]/u.test(value);
}

async function readBounded(fs, target, info, signal) {
  if (typeof fs.readBytes === 'function') {
    const bytes = await fs.readBytes(target, signal, MAX_CONFIG_BYTES);
    if (bytes.byteLength > MAX_CONFIG_BYTES) throw configurationRequired('read', 'FILE_TOO_LARGE');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  // Older tool-environment providers expose text IO. Prefer streaming so a growing
  // projection can be rejected without buffering the whole replacement.
  if (typeof fs.streamText === 'function') {
    let text = '';
    let size = 0;
    for await (const chunk of await fs.streamText(target, signal)) {
      signal?.throwIfAborted();
      size += Buffer.byteLength(chunk, 'utf8');
      if (size > MAX_CONFIG_BYTES) throw configurationRequired('read', 'FILE_TOO_LARGE');
      text += chunk;
    }
    return text;
  }
  // Devflow's minimum structural provider has readText only. Require a known,
  // bounded size before reading and recheck content size after the provider read.
  if (typeof fs.readText !== 'function' || !Number.isSafeInteger(info.size) || info.size < 0) {
    throw configurationRequired('read', 'BOUNDED_READ_UNAVAILABLE');
  }
  const text = await fs.readText(target, signal);
  if (Buffer.byteLength(text, 'utf8') > MAX_CONFIG_BYTES) throw configurationRequired('read', 'FILE_TOO_LARGE');
  return text;
}

/** Read the live connector projection in the caller's filesystem world. Never cache credentials. */
export async function readConfiguration(fs, path, signal) {
  let stage = 'provider';
  try {
    signal?.throwIfAborted();
    if (!fs || typeof fs.lstat !== 'function' || typeof fs.resolve !== 'function') {
      throw configurationRequired(stage, 'FILESYSTEM_UNAVAILABLE');
    }
    stage = 'lstat';
    const info = await fs.lstat(path, undefined, signal);
    if (!info) throw configurationRequired(stage, 'FILE_NOT_FOUND');
    if (info.type !== 'file') throw configurationRequired(stage, info.type === 'symlink' ? 'SYMLINK_REJECTED' : 'NOT_REGULAR_FILE');
    if (info.size > MAX_CONFIG_BYTES) throw configurationRequired(stage, 'FILE_TOO_LARGE');
    stage = 'resolve';
    const target = await fs.resolve(path, { signal });
    stage = 'read';
    const text = await readBounded(fs, target, info, signal);
    stage = 'parse';
    const value = JSON.parse(text);
    stage = 'validate';
    if (value?.schemaVersion !== 1) throw configurationRequired(stage, 'SCHEMA_VERSION_INVALID');
    if (value.connectorCode !== CONNECTOR_CODE) throw configurationRequired(stage, 'CONNECTOR_CODE_MISMATCH');
    if (value.enabled !== true) throw configurationRequired(stage, 'CONNECTOR_DISABLED');
    if (!credential(value.accessKeyId, 256)) throw configurationRequired(stage, 'ACCESS_KEY_ID_INVALID');
    if (!credential(value.secretAccessKey)) throw configurationRequired(stage, 'SECRET_ACCESS_KEY_INVALID');
    if (value.securityToken !== undefined && !credential(value.securityToken)) throw configurationRequired(stage, 'SECURITY_TOKEN_INVALID');
    if (value.expiresAt !== undefined && (typeof value.expiresAt !== 'string'
      || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now())) throw configurationRequired(stage, 'CREDENTIAL_EXPIRED_OR_INVALID');
    signal?.throwIfAborted();
    return { accessKeyId: value.accessKeyId, secretAccessKey: value.secretAccessKey, securityToken: value.securityToken };
  } catch (error) {
    signal?.throwIfAborted();
    if (error?.[CONFIG_FAILURE]) throw error;
    // Only stage names and known fs codes survive. Never attach original errors or credential text.
    const reason = FS_CODES.has(error?.code) ? error.code : stage === 'parse' ? 'INVALID_JSON' : 'OPERATION_FAILED';
    throw configurationRequired(stage, reason);
  }
}
