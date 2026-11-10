import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileTransferProgress } from '@/service/resumableFileUpload';

export interface FileTransferContext {
  key: string;
  resourceId: string;
  ownerKey: string;
  sessionId: string;
}

export interface FileTransferTask {
  id: string;
  file: File;
  path: string;
  overwrite: boolean;
  checkActive?: () => void;
  context?: FileTransferContext;
  knowledge?: { resourceId: string | number; directoryPath: string; processFrontMatter: boolean };
}

export interface FileTransferRow extends FileTransferTask {
  status: 'pending' | 'uploading' | 'success' | 'failed';
  progress: FileTransferProgress;
  error?: string;
}

type Upload = (task: FileTransferTask, report: (progress: FileTransferProgress) => void) => Promise<unknown>;

/** Task callbacks retain their destination; old context generations cannot publish or retry. */
export default function useFileTransferQueue(upload: Upload, contextKey = '') {
  const [state, setState] = useState<{ key: string; rows: FileTransferRow[] }>({ key: contextKey, rows: [] });
  const rowsRef = useRef<FileTransferRow[]>([]);
  const scope = useRef(contextKey);
  const generation = useRef(0);
  const mounted = useRef(true);
  const active = useRef(new Set<string>());
  const cancelled = useRef(new Set<string>());
  const attempts = useRef(new Map<string, number>());
  const uploaders = useRef(new Map<string, Upload>());
  if (scope.current !== contextKey) {
    scope.current = contextKey;
    generation.current += 1;
    rowsRef.current = [];
    cancelled.current.clear();
    attempts.current.clear();
    uploaders.current.clear();
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  const update = useCallback((id: string, change: Partial<FileTransferRow>, epoch: number) => {
    if (!mounted.current || epoch !== generation.current) return;
    setState((current) => {
      if (epoch !== generation.current || current.key !== scope.current) return current;
      const next = current.rows.map((row) => (row.id === id ? { ...row, ...change } : row));
      rowsRef.current = next;
      return { key: current.key, rows: next };
    });
  }, []);

  const run = useCallback(
    async (row: FileTransferRow, epoch: number) => {
      const key = `${epoch}:${row.id}`;
      const current = () => mounted.current && epoch === generation.current && !cancelled.current.has(key);
      if (!current() || active.current.has(key)) return false;
      active.current.add(key);
      const attempt = (attempts.current.get(key) || 0) + 1;
      attempts.current.set(key, attempt);
      update(row.id, { status: 'uploading', error: undefined }, epoch);
      try {
        const invoke = uploaders.current.get(key) || upload;
        await invoke(
          {
            ...row,
            checkActive: () => {
              if (!current()) throw new Error('Upload cancelled');
            },
          },
          (progress) => {
            if (current() && attempts.current.get(key) === attempt && active.current.has(key))
              update(row.id, { progress }, epoch);
          }
        );
        if (!current()) return false;
        update(
          row.id,
          { status: 'success', progress: { ...row.progress, loaded: row.file.size, phase: 'uploading' } },
          epoch
        );
        return current();
      } catch (error: any) {
        if (!current()) return false;
        update(
          row.id,
          { status: 'failed', error: typeof error === 'string' ? error : error?.message || String(error) },
          epoch
        );
        return false;
      } finally {
        active.current.delete(key);
      }
    },
    [update, upload]
  );

  const start = useCallback(
    async (tasks: FileTransferTask[]) => {
      if (tasks.some((task) => task.context && task.context.key !== scope.current)) return false;
      const epoch = generation.current;
      const next: FileTransferRow[] = tasks.map((task) => ({
        ...task,
        status: 'pending',
        progress: { loaded: 0, total: task.file.size, phase: 'uploading', fileName: task.file.name },
      }));
      next.forEach((row) => uploaders.current.set(`${epoch}:${row.id}`, upload));
      rowsRef.current = next;
      setState({ key: scope.current, rows: next });
      let cursor = 0;
      const results: boolean[] = [];
      const worker = async () => {
        while (cursor < next.length && epoch === generation.current) {
          const index = cursor;
          cursor += 1;
          results[index] = await run(next[index], epoch);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, next.length) }, () => worker()));
      return epoch === generation.current && results.every(Boolean);
    },
    [run, upload]
  );

  const retry = useCallback(
    async (id: string) => {
      const row = rowsRef.current.find((item) => item.id === id);
      if (row?.status !== 'failed') return false;
      cancelled.current.delete(`${generation.current}:${id}`);
      return run(row, generation.current);
    },
    [run]
  );

  const reset = useCallback(() => {
    generation.current += 1;
    rowsRef.current = [];
    uploaders.current.clear();
    cancelled.current.clear();
    attempts.current.clear();
    setState({ key: scope.current, rows: [] });
  }, []);

  const cancelQueued = useCallback(
    (message?: string) => {
      rowsRef.current.forEach((row) => {
        if (row.status === 'pending' || (row.status === 'uploading' && row.progress.phase === 'queued')) {
          cancelled.current.add(`${generation.current}:${row.id}`);
          update(row.id, { status: 'failed', error: message }, generation.current);
        }
      });
    },
    [update]
  );

  return { cancelQueued, rows: state.key === contextKey ? state.rows : [], start, retry, reset };
}
