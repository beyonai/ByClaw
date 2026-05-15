import { message } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IntlShape } from 'react-intl';
import { normalizeModelType } from './modelFormUtils';
import { copyTextToClipboard } from '@/pages/manager/utils/copy';

type Params = {
  intl: IntlShape;
  dispatch: any;
  open: boolean;
  currentModelType?: any;
  getCurrentModelId: () => string | number | undefined;
};

const TYPE_INTERVAL_MS = 20;

const useModelDebug = ({ intl, dispatch, open, currentModelType, getCurrentModelId }: Params) => {
  const [debugInputMode, setDebugInputMode] = useState<'template' | 'auto'>('auto');
  const [debugInput, setDebugInput] = useState('');
  const [debugOutput, setDebugOutput] = useState('');
  const [rerankResult, setRerankResult] = useState<any>(null);
  const [rerankView, setRerankView] = useState<'table' | 'json'>('table');
  const [debugOutputLoading, setDebugOutputLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const outBufRef = useRef<string>('');
  const rafIdRef = useRef<number | null>(null);
  const typeTimerRef = useRef<number | null>(null);
  const charQueueRef = useRef<string[]>([]);
  const gotDeltaRef = useRef(false);
  const streamDoneRef = useRef(false);

  const flushOutput = useCallback(() => {
    const chunk = outBufRef.current;
    if (!chunk) return;
    outBufRef.current = '';
    setDebugOutput((prev) => `${prev || ''}${chunk}`);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      flushOutput();
    });
  }, [flushOutput]);

  const abortDebug = useCallback(() => {
    try {
      abortRef.current?.abort?.();
    } catch (e) {
      // ignore
    }
    abortRef.current = null;
    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (typeTimerRef.current !== null) {
      window.clearInterval(typeTimerRef.current);
      typeTimerRef.current = null;
    }
    charQueueRef.current = [];
    gotDeltaRef.current = false;
    streamDoneRef.current = false;
    outBufRef.current = '';
    setRerankResult(null);
    setDebugOutputLoading(false);
  }, []);

  const resetDebugState = useCallback(() => {
    abortDebug();
    setDebugOutput('');
    setRerankResult(null);
    setRerankView('table');
  }, [abortDebug]);

  const ensureTyping = useCallback(() => {
    if (typeTimerRef.current !== null) return;
    typeTimerRef.current = window.setInterval(() => {
      const q = charQueueRef.current;
      if (!q.length) {
        if (streamDoneRef.current) {
          if (typeTimerRef.current !== null) {
            window.clearInterval(typeTimerRef.current);
            typeTimerRef.current = null;
          }
          flushOutput();
        }
        return;
      }

      const len = q.length;
      const n = len > 400 ? 8 : len > 200 ? 5 : len > 80 ? 3 : 1;
      let chunk = '';
      for (let i = 0; i < n && q.length; i += 1) {
        chunk += q.shift();
      }
      if (chunk) {
        outBufRef.current += chunk;
        scheduleFlush();
      }
    }, TYPE_INTERVAL_MS);
  }, [flushOutput, scheduleFlush]);

  useEffect(() => {
    if (!open) {
      abortDebug();
    }
    return () => {
      abortDebug();
    };
  }, [abortDebug, open]);

  const runDebug = useCallback(() => {
    const currentModelId = getCurrentModelId();
    if (!debugInput?.trim()) {
      message.warning(intl.formatMessage({ id: 'modelMgr.modal.debugInputRequired' }));
      return;
    }
    if (currentModelId === null || currentModelId === undefined || currentModelId === '') {
      message.warning(intl.formatMessage({ id: 'modelMgr.modal.debugIdRequired' }));
      return;
    }

    abortDebug();
    abortRef.current = new AbortController();
    gotDeltaRef.current = false;
    streamDoneRef.current = false;

    setDebugOutput('');
    setRerankResult(null);
    setDebugOutputLoading(true);
    const currentType = normalizeModelType(currentModelType);
    const effectType =
      currentType === 'RERANK'
        ? 'modelMgr/debugModelRerank'
        : currentType === 'EMBEDDING'
          ? 'modelMgr/debugModelEmbedding'
          : 'modelMgr/debugModel';

    dispatch({
      type: effectType,
      payload: {
        id: `${currentModelId}`,
        input: `${debugInput}`,
        signal: abortRef.current.signal,
        onDelta: (delta: string) => {
          if (currentType === 'RERANK' || currentType === 'EMBEDDING') return;
          if (!delta) return;
          setDebugOutputLoading(false);
          gotDeltaRef.current = true;
          charQueueRef.current.push(...Array.from(delta));
          ensureTyping();
        },
      },
      success: (res: any) => {
        setDebugOutputLoading(false);
        if (currentType === 'RERANK' || currentType === 'EMBEDDING') {
          streamDoneRef.current = true;
          if (typeTimerRef.current !== null) {
            window.clearInterval(typeTimerRef.current);
            typeTimerRef.current = null;
          }
          charQueueRef.current = [];
          outBufRef.current = '';
          if (rafIdRef.current !== null) {
            window.cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
          }

          const unwrap = (v: any) => {
            let cur = v;
            for (let i = 0; i < 4; i += 1) {
              if (cur === null || cur === undefined) return cur;
              if (Array.isArray(cur)) return cur;
              if (typeof cur === 'string') return cur;
              if (typeof cur === 'object') {
                if ('data' in (cur as any)) {
                  cur = (cur as any).data;
                } else if ('output' in (cur as any)) {
                  cur = (cur as any).output;
                } else {
                  return cur;
                }
              } else {
                return cur;
              }
            }
            return cur;
          };

          let dataForShow: any = unwrap(res);
          if (typeof dataForShow === 'string') {
            const s = dataForShow.trim();
            if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'))) {
              try {
                dataForShow = JSON.parse(s);
              } catch (e) {
                // ignore
              }
            }
          }

          setRerankResult(dataForShow);
          setRerankView('table');

          if (dataForShow === null || dataForShow === undefined) {
            setDebugOutput('');
            return;
          }
          try {
            setDebugOutput(JSON.stringify(dataForShow, null, 2));
          } catch (e) {
            setDebugOutput(`${dataForShow}`);
          }
          return;
        }

        const text = `${res?.output ?? ''}`;
        if (!gotDeltaRef.current && text) {
          charQueueRef.current.push(...Array.from(text));
          ensureTyping();
        }
        streamDoneRef.current = true;
      },
      fail: () => {
        setDebugOutputLoading(false);
      },
    });
  }, [abortDebug, currentModelType, debugInput, dispatch, ensureTyping, getCurrentModelId, intl]);

  const copyText = useCallback(
    async (text: string, successMessageId: string) => {
      if (!text) return;
      try {
        await copyTextToClipboard(text);
        message.success(intl.formatMessage({ id: successMessageId }));
      } catch (e) {
        message.error(intl.formatMessage({ id: 'common.copyFail' }));
      }
    },
    [intl]
  );

  const rerankTableData = useMemo(() => {
    if (!Array.isArray(rerankResult)) return [];
    const normalized = rerankResult
      .map((it: any, idx: number) => ({
        __idx: idx,
        text: it?.text ?? '',
        metadataId: it?.metadata?.id,
        score: typeof it?.score === 'number' ? it.score : Number(it?.score),
        raw: it,
      }))
      .filter((it: any) => it.text !== '' || it.metadataId !== undefined || !Number.isNaN(it.score));

    return normalized.sort((a: any, b: any) => {
      const as = Number.isNaN(a.score) ? -Infinity : a.score;
      const bs = Number.isNaN(b.score) ? -Infinity : b.score;
      return bs - as;
    });
  }, [rerankResult]);

  const shouldShowRerankTable = useMemo(() => {
    const currentType = normalizeModelType(currentModelType);
    return currentType === 'RERANK' && Array.isArray(rerankResult) && rerankResult.length > 0;
  }, [currentModelType, rerankResult]);

  return {
    copyText,
    debugInput,
    debugInputMode,
    debugOutput,
    debugOutputLoading,
    rerankTableData,
    rerankView,
    resetDebugState,
    runDebug,
    setDebugInput,
    setDebugInputMode,
    setDebugOutput,
    setRerankView,
    shouldShowRerankTable,
  };
};

export default useModelDebug;
