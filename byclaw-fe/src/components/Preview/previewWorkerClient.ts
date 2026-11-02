import { BinaryPreviewError, PREVIEW_WORKER_TIMEOUT, type PreviewOperations } from './binaryPreview';

export class PreviewWorkerClient {
  private sequence = 0;
  private closed = false;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(private worker: Worker) {
    worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      clearTimeout(request.timer);
      if (data.error) request.reject(new BinaryPreviewError(data.error));
      else request.resolve(data.result);
    };
    worker.onerror = () => this.dispose('invalid');
    worker.onmessageerror = () => this.dispose('invalid');
  }

  request<K extends keyof PreviewOperations>(
    operation: K,
    input: PreviewOperations[K]['input'],
    transfer: Transferable[] = []
  ): Promise<PreviewOperations[K]['output']> {
    if (this.closed) return Promise.reject(new BinaryPreviewError('closed'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.dispose('timeout'), PREVIEW_WORKER_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ id, operation, input }, transfer);
      } catch {
        this.dispose('invalid');
      }
    });
  }

  dispose(code: BinaryPreviewError['code'] = 'closed') {
    this.closed = true;
    this.worker.terminate();
    this.pending.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(new BinaryPreviewError(code));
    });
    this.pending.clear();
  }
}
