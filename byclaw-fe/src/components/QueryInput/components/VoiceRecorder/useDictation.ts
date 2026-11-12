import { POST } from '@/service/common/request';
import { useIntl } from '@umijs/max';
import { message } from 'antd';
import { useLayoutEffect, useRef, useState } from 'react';
import { StreamSTT } from './StreamSTT';
import { createVoiceStream } from './voiceStreamProtocol';
import { microphoneErrorId } from './microphone';

type Status =
  | 'voice.dictationLoadingConfig'
  | 'voice.dictationConnecting'
  | 'voice.microphoneWaiting'
  | 'voice.dictating'
  | 'voice.dictationFinishing';

type ManagedConfigResponse = { paramValue?: string; data?: { paramValue?: string } };

type Dictation = {
  handler?: StreamSTT;
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
    dictation.handler?.disconnectToService();
    dictation.insert?.(text);
  }

  useLayoutEffect(() => () => dispose(), []);

  function finish(dictation: Dictation, commit: boolean, errorId?: string) {
    if (current.current !== dictation) return;
    const text = dictation.text.trim();
    dispose(commit ? text : undefined);
    setStatus(undefined);
    setLevel(0);
    if (errorId) message.error(intl.formatMessage({ id: errorId }));
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
      const response = await POST<ManagedConfigResponse | string>(
        '/byaiService/system/staticdata/getDcSystemConfig',
        { paramCode: 'VOICE_STREAM_SERVICE_CONFIG' },
        { responseCfg: { hideErrorTips: true } }
      );
      if (current.current !== dictation) return;
      window.clearTimeout(dictation.configTimeout);
      if (typeof response === 'string') {
        finish(dictation, false, errorId);
        return;
      }
      const raw = response?.paramValue ?? response?.data?.paramValue;
      if (raw === undefined || raw === null || raw === '') {
        finish(dictation, false, 'voice.dictationConfigMissing');
        return;
      }
      errorId = 'voice.dictationConfigInvalid';
      const protocol = await createVoiceStream(raw);
      if (current.current !== dictation) return;

      const updateTranscript = (text: string) => {
        if (current.current !== dictation) return;
        dictation.text = text;
        dictation.insert?.(text, true);
      };
      const handler = new StreamSTT(protocol, {
        onTranscript: updateTranscript,
        onLevel: (power) => {
          if (current.current === dictation) setLevel(power);
        },
        onComplete: () => finish(dictation, true),
        onFinishing: () => {
          dictation.phase = 'finishing';
          setStatus('voice.dictationFinishing');
        },
        onConnecting: () => setStatus('voice.dictationConnecting'),
        onRecording: () => {
          dictation.phase = 'recording';
          setStatus('voice.dictating');
        },
        onError: (error) => {
          finish(dictation, true, typeof error === 'string' ? error : microphoneErrorId(error));
        },
      });
      dictation.handler = handler;
      setStatus('voice.microphoneWaiting');
      handler.connectToService();
    } catch {
      finish(dictation, false, errorId);
    }
  }

  return { active: Boolean(status), status, level, start, stop, cancel, close };
}
