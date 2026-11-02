import { POST, type ConfigType } from '@/service/common/request';

const CryptoJS = require('crypto-js');
const activeUploads = new Map<string, string>();

const HASH_BLOCK_SIZE = 4 * 1024 * 1024;
const MAX_TRANSFER_CHUNK_SIZE = 16 * 1024 * 1024;
const BASE = '/byaiService/fileBrowser/uploads';

async function postInContext<T = undefined>(
  checkContext: (() => void) | undefined,
  url: string,
  body = {},
  config: ConfigType = {}
): Promise<T> {
  checkContext?.();
  const response = await POST<T>(url, body, config);
  checkContext?.();
  return response;
}

interface UploadSession {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  totalSize: number;
  uploadedChunks: number[];
  sha256?: string;
  maxSize?: number;
  state: 'UPLOADING' | 'COMPLETED' | 'EXPIRED';
}

export interface FileTransferProgress {
  loaded: number;
  total: number;
  phase: 'hashing' | 'uploading' | 'verifying' | 'processing';
  fileName: string;
  resumed?: boolean;
}

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error('Cannot read file'));
    reader.readAsArrayBuffer(blob);
  });
}

async function hashBlob(blob: Blob) {
  const data = await readBlob(blob);
  return CryptoJS.SHA256(CryptoJS.lib.WordArray.create(new Uint8Array(data))).toString();
}

/** Bounded memory hashing verifies the entire reselected file, including middle blocks. */
export async function fingerprintFile(file: File, onHashProgress?: (loaded: number) => void): Promise<string> {
  const hash = CryptoJS.algo.SHA256.create();
  for (let start = 0; start < file.size; start += HASH_BLOCK_SIZE) {
    const end = Math.min(start + HASH_BLOCK_SIZE, file.size);
    hash.update(CryptoJS.lib.WordArray.create(new Uint8Array(await readBlob(file.slice(start, end)))));
    onHashProgress?.(end);
  }
  return hash.finalize().toString();
}

function newUploadId() {
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A metadata match is only a candidate: the server and the later full-content hash remain authoritative. */
export async function hasAdmittedUpload(
  resourceId: string | number,
  path: string,
  file: File,
  ownerKey: string,
  overwrite = false,
  checkContext?: () => void
): Promise<boolean> {
  checkContext?.();
  const stored = new Map(activeUploads);
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('byclaw-upload:')) {
        const id = localStorage.getItem(key);
        if (id) stored.set(key, id);
      }
    }
  } catch (error) {
    // The active-page map remains usable.
  }
  for (const [key, uploadId] of stored) {
    let identity: unknown;
    try {
      identity = JSON.parse(key.slice('byclaw-upload:'.length));
    } catch (error) {
      continue;
    }
    if (
      !Array.isArray(identity) ||
      identity[0] !== ownerKey ||
      identity[1] !== String(resourceId) ||
      identity[2] !== path ||
      identity[3] !== file.name ||
      identity[4] !== file.size ||
      identity[6] !== overwrite
    )
      continue;
    const target = { resourceId, path, fileName: file.name, uploadId };
    const config = { responseCfg: { hideErrorTips: true } };
    const status = await postInContext<Omit<UploadSession, 'state'> & { state: string }>(
      checkContext,
      `${BASE}/status`,
      target,
      config
    );
    if (
      status &&
      ['UPLOADING', 'COMPLETED'].includes(status.state) &&
      status.totalSize === file.size &&
      status.sha256 === identity[5]
    )
      return true;
    if (status?.state !== 'EXPIRED' && status?.state !== 'NOT_FOUND') throw new Error('Invalid stored upload session');
    if (status.state === 'EXPIRED') await postInContext(checkContext, `${BASE}/abort`, target, config);
    activeUploads.delete(key);
    try {
      localStorage.removeItem(key);
    } catch (error) {
      // Browser persistence is optional.
    }
  }
  return false;
}

export async function uploadResumableFile(
  resourceId: string | number,
  path: string,
  file: File,
  ownerKey: string,
  onProgress?: (progress: FileTransferProgress) => void,
  overwrite = false,
  currentMaxSize = Number.MAX_SAFE_INTEGER,
  checkContext?: () => void
) {
  const report = (loaded: number, phase: FileTransferProgress['phase'], resumed = false) => {
    onProgress?.({ loaded, total: file.size, phase, fileName: file.name, resumed });
  };
  checkContext?.();
  report(0, 'hashing');
  const sha256 = await fingerprintFile(file, (loaded) => {
    checkContext?.();
    report(loaded, 'hashing');
  });
  checkContext?.();
  const storageKey = `byclaw-upload:${JSON.stringify([
    ownerKey,
    String(resourceId),
    path,
    file.name,
    file.size,
    sha256,
    overwrite,
  ])}`;
  let uploadId: string | null = activeUploads.get(storageKey) || null;
  try {
    uploadId = uploadId || localStorage.getItem(storageKey);
  } catch (error) {
    // Storage may be unavailable; in-memory retry still preserves the active session.
  }
  if (!uploadId && file.size > currentMaxSize) {
    throw new Error(`${file.name}: maximum upload size is ${currentMaxSize / 1024 / 1024} MiB`);
  }
  uploadId = uploadId || newUploadId();
  activeUploads.set(storageKey, uploadId);
  try {
    localStorage.setItem(storageKey, uploadId);
  } catch (error) {
    // Uploads remain usable when the browser disables persistent storage.
  }
  const target = { resourceId, path, fileName: file.name, uploadId };
  const config = { responseCfg: { hideErrorTips: true } };
  const create = () =>
    postInContext<UploadSession>(
      checkContext,
      `${BASE}/create`,
      { ...target, totalSize: file.size, sha256, contentType: file.type || 'application/octet-stream', overwrite },
      config
    );
  let session = await create();
  if (session?.state === 'EXPIRED') {
    await postInContext(checkContext, `${BASE}/abort`, target, config);
    if (file.size > currentMaxSize) throw new Error('Expired upload exceeds the current maximum size');
    target.uploadId = newUploadId();
    activeUploads.set(storageKey, target.uploadId);
    try {
      localStorage.setItem(storageKey, target.uploadId);
    } catch (error) {
      // Browser storage is optional.
    }
    session = await create();
  }
  if (
    !session ||
    session.totalSize !== file.size ||
    session.chunkSize <= 0 ||
    session.chunkSize > MAX_TRANSFER_CHUNK_SIZE ||
    !Array.isArray(session.uploadedChunks) ||
    session.totalChunks !== Math.ceil(file.size / session.chunkSize) ||
    !['UPLOADING', 'COMPLETED'].includes(session.state) ||
    session.uploadedChunks.some((index) => !Number.isInteger(index) || index < 0 || index >= session.totalChunks)
  )
    throw new Error('Invalid upload session');
  if (session.state !== 'COMPLETED') {
    const uploaded = new Set(session.uploadedChunks);
    let acknowledged = 0;
    uploaded.forEach((index) => {
      acknowledged += Math.min(session.chunkSize, file.size - index * session.chunkSize);
    });
    const resumed = uploaded.size > 0;
    report(acknowledged, 'uploading', resumed);
    for (let index = 0; index < session.totalChunks; index += 1) {
      if (uploaded.has(index)) continue;
      const chunk = file.slice(index * session.chunkSize, Math.min((index + 1) * session.chunkSize, file.size));
      const chunkHash = await hashBlob(chunk);
      const formData = new FormData();
      Object.entries(target).forEach(([key, value]) => formData.append(key, String(value)));
      formData.append('index', String(index));
      formData.append('sha256', chunkHash);
      formData.append('chunk', chunk, file.name);
      const completedBytes = acknowledged;
      await postInContext(checkContext, `${BASE}/chunk`, formData, {
        ...config,
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (event) => {
          // Multipart framing is not file data; scale the current part to its real byte length.
          const bytes = event.total
            ? chunk.size * Math.min(1, event.loaded / event.total)
            : Math.min(chunk.size, event.loaded);
          report(Math.min(file.size, completedBytes + bytes), 'uploading', resumed);
        },
      });
      acknowledged += chunk.size;
      report(acknowledged, 'uploading', resumed);
    }
    report(file.size, 'verifying', resumed);
    const complete = await postInContext<UploadSession>(checkContext, `${BASE}/complete`, target, config);
    if (complete?.state !== 'COMPLETED') throw new Error('Upload completion was not acknowledged');
  }
  activeUploads.delete(storageKey);
  try {
    localStorage.removeItem(storageKey);
  } catch (error) {
    // Completion is already durable on the server.
  }
  report(file.size, 'uploading');
}
