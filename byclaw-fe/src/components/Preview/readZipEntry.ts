import type JSZip from 'jszip';
import { BinaryPreviewError } from './binaryPreview';

/** 按实际解压输出计数，不能相信 ZIP 目录里声明的大小。 */
export function readZipEntry(entry: JSZip.JSZipObject, limit: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let stopped = false;
    // JSZip 3.10 运行时提供条目流，声明文件只暴露了 ZIP 生成流。
    const stream = (
      entry as JSZip.JSZipObject & {
        internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
      }
    ).internalStream('uint8array');
    stream.on('data', (chunk: Uint8Array) => {
      if (stopped) return;
      size += chunk.length;
      if (size > limit) {
        stopped = true;
        stream.pause();
        chunks.length = 0;
        reject(new BinaryPreviewError('limit'));
      } else {
        chunks.push(chunk);
      }
    });
    stream.on('error', (error: Error) => {
      stopped = true;
      chunks.length = 0;
      reject(error);
    });
    stream.on('end', () => {
      if (stopped) return;
      const bytes = new Uint8Array(size);
      let offset = 0;
      chunks.forEach((chunk) => {
        bytes.set(chunk, offset);
        offset += chunk.length;
      });
      resolve(bytes.buffer);
    });
    stream.resume();
  });
}
