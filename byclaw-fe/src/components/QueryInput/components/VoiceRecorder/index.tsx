import {
  ArrowLeftOutlined,
  ArrowUpOutlined,
  CloseOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  RedoOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import { Button, message, Tooltip } from 'antd';
import Recorder from 'recorder-core';
import 'recorder-core/src/engine/mp3';
import 'recorder-core/src/engine/mp3-engine';
import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import styles from './index.module.less';
import {
  getMicrophoneAudioContext,
  microphoneErrorId,
  openMicrophone,
  prepareMicrophoneAudioContext,
} from './microphone';
import useDictation from './useDictation';

export type VoiceInputMode = 'recording' | 'dictation';

type Props = {
  disabled?: boolean;
  onModeChange?: (mode?: VoiceInputMode) => void;
  onRecorded: (file: File, durationMs: number, cancelToken: AbortController) => Promise<void>;
  panelContainer?: () => HTMLElement | null;
  dictationContainer?: () => HTMLElement | null;
  captureInsertion?: () => ((text?: string, preview?: boolean) => void) | undefined;
};

type Status = 'idle' | 'opening' | 'recording' | 'limit' | 'sending' | 'retry';

type Press = {
  id: number;
  x: number;
  y: number;
  held: boolean;
  moved: boolean;
  timer?: number;
};

type Recording = {
  abort: AbortController;
  stream?: MediaStream;
  recorder?: ReturnType<typeof Recorder>;
  startedAt?: number;
  ticker?: number;
  limit?: number;
  encoding?: boolean;
  confirmed?: boolean;
  audio?: { file: File; durationMs: number };
};

const WAVE_HEIGHTS = [0.3, 0.55, 0.8, 0.45, 1, 0.6, 0.9, 0.5, 0.75, 0.4, 0.65, 0.35];
const RECORDING_WAVE_HEIGHTS = [0.3, 0.45, 0.65, 0.85, 1, 0.9, 0.7, 0.5, 0.34];
const HOLD_DELAY = 350;
const CANCEL_DISTANCE = 60;
const HOLD_STYLE = { '--voice-hold-duration': `${HOLD_DELAY}ms` } as CSSProperties;

function closeCapture(recording: Recording) {
  window.clearInterval(recording.ticker);
  window.clearTimeout(recording.limit);
  recording.stream?.getTracks().forEach((track) => track.stop());
  recording.stream = undefined;
  recording.recorder?.close();
  recording.recorder = undefined;
}

export default function VoiceRecorder({
  disabled,
  onModeChange,
  onRecorded,
  panelContainer,
  dictationContainer,
  captureInsertion,
}: Props) {
  const intl = useIntl();
  const label = (id: string) => intl.formatMessage({ id });
  const dictation = useDictation(captureInsertion);
  const mounted = useRef(false);
  const pressRef = useRef<Press>(undefined);
  const recordingRef = useRef<Recording>(undefined);
  const [status, setStatus] = useState<Status>('idle');
  const [power, setPower] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [dictationSeconds, setDictationSeconds] = useState(0);
  const [canceling, setCanceling] = useState(false);
  const [holding, setHolding] = useState(false);
  const [retryError, setRetryError] = useState<string>();
  const locked = status !== 'idle' && status !== 'retry';
  const mode = locked ? 'recording' : dictation.active ? 'dictation' : undefined;

  const listening = dictation.status === 'voice.dictating';
  const showDictationTime = listening || dictation.status === 'voice.dictationFinishing';

  useLayoutEffect(() => {
    if (!dictation.active) setDictationSeconds(0);
    if (!listening) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setDictationSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [dictation.active, listening]);

  function clearPress() {
    const press = pressRef.current;
    window.clearTimeout(press?.timer);
    pressRef.current = undefined;
    if (press && mounted.current) setHolding(false);
    return press;
  }

  function disposeRecording() {
    const recording = recordingRef.current;
    recordingRef.current = undefined;
    if (recording) {
      recording.abort.abort();
      closeCapture(recording);
    }
  }

  function resetRecording() {
    disposeRecording();
    setCanceling(false);
    setStatus('idle');
    setRetryError(undefined);
  }

  useLayoutEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  const handleCancelRef = useRef<() => void>(undefined);
  handleCancelRef.current = () => {
    clearPress();
    if (!recordingRef.current?.confirmed || status === 'retry') resetRecording();
    dictation.cancel();
  };

  useLayoutEffect(() => {
    mounted.current = true;
    const cancel = () => handleCancelRef.current?.();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    const onVisibilityChange = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      mounted.current = false;
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearPress();
      disposeRecording();
    };
  }, []);

  useLayoutEffect(() => {
    if (
      disabled &&
      (dictation.active || pressRef.current || (recordingRef.current && !recordingRef.current.confirmed))
    ) {
      handleCancelRef.current?.();
    }
  }, [disabled]);

  async function sendRecording(recording: Recording) {
    if (!recording.audio || recording.abort.signal.aborted) return;
    setStatus('sending');
    try {
      await onRecorded(recording.audio.file, recording.audio.durationMs, recording.abort);
      if (!recording.abort.signal.aborted) resetRecording();
    } catch (error) {
      if (recording.abort.signal.aborted) return;
      setRetryError(typeof error === 'string' ? error : undefined);
      setStatus('retry');
    }
  }

  function finishCapture(recording: Recording) {
    if (!recording.recorder || recording.encoding) return;
    recording.encoding = true;
    window.clearInterval(recording.ticker);
    window.clearTimeout(recording.limit);
    recording.recorder.stop(
      (blob: Blob, durationMs: number) => {
        if (recording.abort.signal.aborted) return;
        closeCapture(recording);
        if (durationMs < 500) {
          message.warning(label('voice.tooShort'));
          resetRecording();
          return;
        }
        recording.audio = { file: new File([blob], `voice-${Date.now()}.mp3`, { type: 'audio/mpeg' }), durationMs };
        if (recording.confirmed) void sendRecording(recording);
      },
      () => {
        if (recording.abort.signal.aborted) return;
        message.error(label('voice.recordFailed'));
        resetRecording();
      }
    );
    recording.stream?.getTracks().forEach((track) => track.stop());
    recording.stream = undefined;
  }

  async function startRecording() {
    const recording: Recording = { abort: new AbortController() };
    recordingRef.current = recording;
    setStatus('opening');
    try {
      const stream = await openMicrophone(recording.abort.signal, () => {
        if (recording.abort.signal.aborted || recording.encoding) return;
        message.error(label('voice.microphoneInterrupted'));
        resetRecording();
      });
      if (!stream || recording.abort.signal.aborted) {
        stream?.getTracks().forEach((track) => track.stop());
        if (
          mounted.current &&
          recording.abort.signal.reason === 'released' &&
          !recordingRef.current &&
          !document.hidden
        ) {
          message.info(label('voice.microphoneGranted'));
        }
        return;
      }
      recording.stream = stream;
      recording.recorder = Recorder({
        type: 'mp3',
        sampleRate: 16000,
        bitRate: 32,
        sourceStream: stream,
        runningContext: getMicrophoneAudioContext(),
        onProcess: (_buffers: unknown, level: number) => {
          if (!recording.abort.signal.aborted && !recording.encoding) setPower(level);
        },
      });
      recording.recorder.open(
        () => {
          if (recording.abort.signal.aborted) return;
          recording.recorder?.start();
          const startedAt = Date.now();
          recording.startedAt = startedAt;
          setSeconds(0);
          setPower(0);
          setStatus('recording');
          recording.ticker = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
          recording.limit = window.setTimeout(() => {
            setSeconds(60);
            setStatus('limit');
            finishCapture(recording);
          }, 60000);
        },
        () => {
          if (recording.abort.signal.aborted) return;
          message.error(label('voice.microphoneUnavailable'));
          resetRecording();
        }
      );
    } catch (error) {
      if (recording.abort.signal.aborted) return;
      message.error(label(microphoneErrorId(error)));
      resetRecording();
    }
  }

  function toggleDictation() {
    if (recordingRef.current) return;
    if (dictation.active) dictation.stop();
    else if (!disabled) {
      prepareMicrophoneAudioContext();
      void dictation.start();
    }
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || pressRef.current || recordingRef.current || (disabled && !dictation.active)) return;
    // Keep the Slate caret available for dictation and keep the same button under capture.
    event.preventDefault();
    if (!dictation.active) prepareMicrophoneAudioContext();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const press: Press = { id: event.pointerId, x: event.clientX, y: event.clientY, held: false, moved: false };
    pressRef.current = press;
    if (!dictation.active) {
      setHolding(true);
      press.timer = window.setTimeout(() => {
        press.held = true;
        setHolding(false);
        void startRecording();
      }, HOLD_DELAY);
    }
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const press = pressRef.current;
    if (!press || press.id !== event.pointerId) return;
    if (press.held) {
      setCanceling(press.x - event.clientX >= CANCEL_DISTANCE);
    } else if (Math.hypot(press.x - event.clientX, press.y - event.clientY) > 12) {
      press.moved = true;
      window.clearTimeout(press.timer);
      setHolding(false);
    }
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (pressRef.current?.id !== event.pointerId) return;
    const press = clearPress();
    if (!press) return;
    if (!press.held) {
      if (!press.moved && Math.hypot(press.x - event.clientX, press.y - event.clientY) <= 12) toggleDictation();
      return;
    }
    const recording = recordingRef.current;
    if (!recording) return;
    if (press.x - event.clientX >= CANCEL_DISTANCE) {
      resetRecording();
    } else if (recording.startedAt === undefined) {
      recording.abort.abort('released');
      resetRecording();
    } else {
      recording.confirmed = true;
      setCanceling(false);
      setStatus('sending');
      if (recording.audio) void sendRecording(recording);
      else finishCapture(recording);
    }
  }

  function onPointerCancel(event: PointerEvent<HTMLButtonElement>) {
    if (pressRef.current?.id !== event.pointerId) return;
    if (clearPress()?.held) resetRecording();
  }

  let hint = 'voice.recordingHint';
  if (status === 'sending') hint = 'voice.sending';
  else if (canceling) hint = 'voice.releaseCancelAndReturn';
  else if (status === 'opening') hint = 'voice.microphoneWaiting';
  else if (status === 'limit') hint = 'voice.recordingLimitReached';

  const showMeter = status === 'recording' || status === 'limit';
  const panel =
    status === 'retry' ? (
      <div className={styles.retry} role="group" aria-label={label('voice.sendFailed')}>
        <span className={styles.retryMessage} role="alert">
          <ExclamationCircleOutlined aria-hidden="true" />
          <span>{retryError || label('voice.sendFailed')}</span>
        </span>
        <span className={styles.retryActions}>
          <Button size="small" type="text" onClick={resetRecording}>
            {label('voice.discardRecording')}
          </Button>
          <Button
            size="small"
            icon={<RedoOutlined aria-hidden="true" />}
            disabled={disabled}
            onClick={() => recordingRef.current && void sendRecording(recordingRef.current)}
          >
            {label('voice.retrySend')}
          </Button>
        </span>
      </div>
    ) : showMeter ? (
      <div className={styles.recordingPanel} data-canceling={canceling || undefined}>
        <div className={styles.recordingMeter}>
          <div className={styles.waveform} aria-hidden="true">
            {RECORDING_WAVE_HEIGHTS.map((weight, index) => (
              <span
                key={index}
                style={{ height: `${Math.max(6, weight * (24 + (status === 'recording' ? power : 0) * 0.48))}px` }}
              />
            ))}
          </div>
          <span className={styles.duration} role="timer">
            {seconds === 60 ? '01:00' : `00:${String(seconds).padStart(2, '0')}`}
          </span>
        </div>
      </div>
    ) : null;
  const dictationControls = (
    <div className={styles.dictationPill} role="group" aria-label={label('voice.transcribe')}>
      <Button
        type="text"
        shape="circle"
        className={styles.dictationCancel}
        icon={<CloseOutlined aria-hidden="true" />}
        aria-label={label('voice.closeDictation')}
        title={label('voice.closeDictation')}
        onClick={dictation.close}
      />
      {listening ? (
        <div className={styles.dictationWave} aria-hidden="true">
          {WAVE_HEIGHTS.map((weight, index) => (
            <span key={index} style={{ height: Math.max(3, weight * dictation.level * 0.22) }} />
          ))}
        </div>
      ) : (
        <span className={styles.dictationStatus} role="status" title={label(dictation.status || 'voice.dictating')}>
          {label(dictation.status || 'voice.dictating')}
        </span>
      )}
      {showDictationTime && (
        <span className={styles.dictationTime} role="timer">
          {dictationSeconds}″
        </span>
      )}
      <Button
        type="primary"
        shape="circle"
        className={styles.dictationFinish}
        icon={listening ? <ArrowUpOutlined aria-hidden="true" /> : <LoadingOutlined aria-hidden="true" />}
        aria-label={label('voice.stopDictation')}
        title={label('voice.stopDictation')}
        disabled={!listening}
        onClick={dictation.stop}
      />
    </div>
  );
  const dictationSlot = dictationContainer?.();
  const panelSlot = locked ? panelContainer?.() : dictationSlot;
  const micLabel = label('voice.inputHint');

  return (
    <>
      {dictation.active ? (
        dictationControls
      ) : (
        <div className={styles.recordButtonWrap}>
          {locked && (
            <span className={styles.recordingHint} role="status" data-canceling={canceling || undefined}>
              {showMeter ? (
                canceling ? (
                  <CloseOutlined aria-hidden="true" />
                ) : (
                  <ArrowLeftOutlined aria-hidden="true" />
                )
              ) : (
                <LoadingOutlined aria-hidden="true" />
              )}
              {label(hint)}
            </span>
          )}
          <Tooltip title={holding || locked || status === 'retry' ? null : micLabel}>
            <Button
              type="text"
              aria-label={micLabel}
              aria-pressed={locked}
              className={styles.recordButton}
              data-holding={holding || undefined}
              data-canceling={canceling || undefined}
              style={HOLD_STYLE}
              disabled={status === 'retry' || (disabled && !locked)}
              icon={<AntdIcon type="icon-yuyin" />}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onLostPointerCapture={onPointerCancel}
              onContextMenu={(event) => event.preventDefault()}
              onClick={(event) => {
                if (event.detail === 0) toggleDictation();
              }}
            />
          </Tooltip>
        </div>
      )}
      {panelSlot ? createPortal(panel, panelSlot) : panel}
    </>
  );
}
