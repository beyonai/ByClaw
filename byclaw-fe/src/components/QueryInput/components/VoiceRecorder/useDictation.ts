import { getDcSystemConfig } from '@/pages/manager/service/session';
import { useIntl } from '@umijs/max';
import { message } from 'antd';
import { useLayoutEffect, useRef, useState } from 'react';
import XunfeiSTT from '../STTComp/STT/XunfeiSTT';
import { microphoneErrorId } from './microphone';

type Status =
  | 'voice.dictationLoadingConfig'
  | 'voice.dictationConnecting'
  | 'voice.microphoneWaiting'
  | 'voice.dictating'
  | 'voice.dictationFinishing';

type ManagedConfigResponse = { paramValue?: string; data?: { paramValue?: string } };

type ServiceConfig = {
  protocol?: string;
  appIdEncrypted?: string;
  credentials?: { apiKeyEncrypted?: string; apiSecretEncrypted?: string };
  endpoints?: { stream?: string };
};

type ManagedConfig = {
  services?: { speechDictation?: ServiceConfig; realtimeTranscription?: ServiceConfig };
};

type Dictation = {
  handler?: XunfeiSTT;
  insert?: (text?: string, preview?: boolean) => void;
  configTimeout?: number;
  text: string;
  phase: 'connecting' | 'recording' | 'finishing';
};

export default function useDictation(
  captureInsertion?: () => ((text?: string, preview?: boolean) => void) | undefined
) {
  const intl = useIntl();
  const current = useRef<Dictation>(undefined);
  const [status, setStatus] = useState<Status>();
  const [level, setLevel] = useState(0);

  function dispose(text?: string) {
    const dictation = current.current;
    current.current = undefined;
    if (!dictation) return;
    window.clearTimeout(dictation.configTimeout);
    dictation.handler?.offAllEvent();
    dictation.handler?.disconnectToService();
    dictation.insert?.(text);
  }

  useLayoutEffect(() => () => dispose(), []);

  function finish(dictation: Dictation, commit: boolean, errorId?: string, code?: string) {
    if (current.current !== dictation) return;
    const text = dictation.text.trim();
    dispose(commit ? text : undefined);
    setStatus(undefined);
    setLevel(0);
    if (errorId) message.error(intl.formatMessage({ id: errorId }, { code }));
    else if (commit && !text) message.info(intl.formatMessage({ id: 'voice.emptyTranscript' }));
  }

  function cancel() {
    if (current.current) finish(current.current, false);
  }

  function close() {
    const dictation = current.current;
    if (dictation) finish(dictation, Boolean(dictation.text.trim()));
  }

  function stop() {
    const dictation = current.current;
    if (!dictation) return;
    if (dictation.phase === 'finishing') return;
    if (dictation.phase !== 'recording' || !dictation.handler?.pauseToService()) finish(dictation, false);
  }

  async function start() {
    if (current.current) return;
    const dictation: Dictation = { insert: captureInsertion?.(), text: '', phase: 'connecting' };
    current.current = dictation;
    setStatus('voice.dictationLoadingConfig');
    dictation.configTimeout = window.setTimeout(() => finish(dictation, false, 'voice.dictationConfigTimeout'), 10000);
    let errorId = 'voice.dictationConfigFetchFailed';
    try {
      const response = await getDcSystemConfig<ManagedConfigResponse>(
        { paramCode: 'XUNFEI_SERVICE_CONFIG' },
        { responseCfg: { hideErrorTips: true } }
      );
      if (current.current !== dictation) return;
      window.clearTimeout(dictation.configTimeout);
      if (typeof response === 'string') {
        finish(dictation, false, errorId);
        return;
      }
      const raw = response?.paramValue ?? response?.data?.paramValue;
      if (!raw) {
        finish(dictation, false, 'voice.dictationConfigMissing');
        return;
      }
      errorId = 'voice.dictationConfigInvalid';
      const config: ManagedConfig = JSON.parse(raw);
      const speechDictation = config?.services?.speechDictation;
      const service = speechDictation ?? config?.services?.realtimeTranscription;
      const appId = service?.appIdEncrypted;
      const apiKey = service?.credentials?.apiKeyEncrypted;
      const stream = service?.endpoints?.stream;
      if (
        typeof appId !== 'string' ||
        !appId.trim() ||
        typeof apiKey !== 'string' ||
        !apiKey.trim() ||
        typeof stream !== 'string' ||
        !stream.trim()
      ) {
        finish(dictation, false, errorId);
        return;
      }

      let sttParams: ConstructorParameters<typeof XunfeiSTT>[0]['sttParams'];
      if (speechDictation) {
        const secret = speechDictation.credentials?.apiSecretEncrypted;
        if (
          speechDictation.protocol !== 'iat-v2' ||
          stream !== 'wss://iat-api.xfyun.cn/v2/iat' ||
          typeof secret !== 'string' ||
          !secret.trim()
        ) {
          finish(dictation, false, errorId);
          return;
        }
        sttParams = { id: appId, key: apiKey, secret };
      } else if (service?.protocol === 'rtasr-standard-v1') {
        sttParams = { protocol: 'rtasr-standard-v1', id: appId, key: apiKey, stream };
      } else {
        finish(dictation, false, errorId);
        return;
      }

      const updateTranscript = (text: string) => {
        if (current.current !== dictation) return;
        dictation.text = text;
        dictation.insert?.(text, true);
      };
      const handler = new XunfeiSTT({
        sttParams,
        onRecognized: (text) => updateTranscript(dictation.text + text),
        onTranscript: speechDictation ? updateTranscript : undefined,
        onLevel: (power) => {
          if (current.current === dictation) setLevel(power);
        },
        onComplete: () => finish(dictation, true),
        onFinishing: () => {
          dictation.phase = 'finishing';
          setStatus('voice.dictationFinishing');
        },
      });
      dictation.handler = handler;
      handler.on('connecting', () => setStatus('voice.dictationConnecting'));
      handler.on('recording', () => {
        dictation.phase = 'recording';
        setStatus('voice.dictating');
      });
      handler.on('error', (error, code) => {
        const errorId = typeof error === 'string' ? error : error ? microphoneErrorId(error) : 'voice.transcribeFailed';
        finish(dictation, true, errorId, code);
      });
      setStatus('voice.microphoneWaiting');
      if (!handler.connectToService()) finish(dictation, false, errorId);
    } catch {
      finish(dictation, false, errorId);
    }
  }

  return { active: Boolean(status), status, level, start, stop, cancel, close };
}
