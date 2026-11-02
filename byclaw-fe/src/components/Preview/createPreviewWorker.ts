import { PreviewWorkerClient } from './previewWorkerClient';

export function createPreviewWorker() {
  // 使用 webpack 5 的 worker 入口，让部署子路径和带 hash 的资源地址随构建产物解析。
  return new PreviewWorkerClient(new Worker(new URL('./preview.worker.ts', import.meta.url)));
}
