import { useIntl } from '@umijs/max';
import { cancelVoicePlayback, enqueueVoicePlayback, skipVoicePlayback } from '@/utils/voicePlayback';
import { loadVoiceAudio, transcribeVoice } from '@/service/voice';
import { getVoiceDurationSeconds, type VoiceMessage as VoiceData } from '@/utils/voice';
import { DownOutlined, LoadingOutlined } from '@ant-design/icons';
import { Button, Dropdown, message } from 'antd';
import classNames from 'classnames';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './index.module.less';

type Props = {
  sessionId?: string;
  autoPlayKey?: string;
  autoPlayEpoch?: number;
  autoPlay?: boolean;
  autoTranscribe?: boolean;
  onTranscript?: (text: string) => void;
  showTranscribe?: boolean;
  label?: string;
  variant?: 'user' | 'assistant';
} & (
  | { voice: VoiceData; loadAudio?: () => Promise<Blob>; transcribeAudio?: () => Promise<{ text: string }> }
  | {
      voice: Omit<VoiceData, 'fileId'>;
      loadAudio: () => Promise<Blob>;
      transcribeAudio: () => Promise<{ text: string }>;
    }
);

// Only one voice bubble plays at once, including across separate message lists.
const PLAY_EVENT = 'byclaw-voice-play';

export default function VoiceMessage({
  voice,
  sessionId,
  onTranscript,
  loadAudio,
  showTranscribe = true,
  label,
  variant = 'user',
  transcribeAudio,
  autoPlayKey,
  autoPlayEpoch,
  autoPlay = false,
  autoTranscribe = false,
}: Props) {
  const intl = useIntl();
  const audioRef = useRef<HTMLAudioElement>(null);
  const sourceRef = useRef('');
  const blobRequestRef = useRef<Promise<Blob> | undefined>(undefined);
  const autoTranscribedRef = useRef(false);
  const transcribingRef = useRef(false);
  const aliveRef = useRef(true);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState(voice.transcript || '');
  const [transcriptExpanded, setTranscriptExpanded] = useState(Boolean(voice.transcript));
  const [audioDurationMs, setAudioDurationMs] = useState(voice.durationMs > 0 ? voice.durationMs : undefined);
  const seconds = audioDurationMs ? getVoiceDurationSeconds(audioDurationMs) : undefined;
  const fileId = 'fileId' in voice ? voice.fileId : undefined;

  useEffect(() => {
    aliveRef.current = true;
    const audio = audioRef.current;
    const pauseOther = (event: Event) => {
      if ((event as CustomEvent).detail !== audio) audio?.pause();
    };
    window.addEventListener(PLAY_EVENT, pauseOther);
    return () => {
      aliveRef.current = false;
      window.removeEventListener(PLAY_EVENT, pauseOther);
      audio?.pause();
      if (sourceRef.current) URL.revokeObjectURL(sourceRef.current);
    };
  }, []);

  const ensureAudioSource = useCallback(async () => {
    if (sourceRef.current) return;
    if (!blobRequestRef.current) {
      if (loadAudio) blobRequestRef.current = loadAudio();
      else if (fileId !== undefined) blobRequestRef.current = loadVoiceAudio(fileId);
      else throw new Error(intl.formatMessage({ id: 'voice.sourceUnavailable' }));
    }
    try {
      const blob = await blobRequestRef.current;
      if (!aliveRef.current || sourceRef.current || !audioRef.current) return;
      sourceRef.current = URL.createObjectURL(blob);
      audioRef.current.src = sourceRef.current;
    } catch (error) {
      blobRequestRef.current = undefined;
      throw error;
    }
  }, [fileId, loadAudio, intl]);

  useEffect(() => {
    if (voice.durationMs > 0) return;
    let active = true;
    setLoading(true);
    void ensureAudioSource()
      .catch(() => undefined)
      .finally(() => {
        if (active && aliveRef.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ensureAudioSource, voice.durationMs]);

  const sourceLoaderRef = useRef(ensureAudioSource);
  sourceLoaderRef.current = ensureAudioSource;

  useEffect(() => {
    if (!autoPlayKey) return;
    if (!autoPlay) {
      skipVoicePlayback(autoPlayKey);
      return;
    }
    return enqueueVoicePlayback(
      autoPlayKey,
      (signal) =>
        new Promise<void>((resolve) => {
          const audio = audioRef.current;
          if (!audio || signal.aborted) {
            resolve();
            return;
          }
          let abort: () => void;
          const finish = () => {
            audio.removeEventListener('ended', finish);
            audio.removeEventListener('error', finish);
            signal.removeEventListener('abort', abort);
            resolve();
          };
          abort = () => {
            audio.pause();
            finish();
          };
          signal.addEventListener('abort', abort, { once: true });
          audio.addEventListener('ended', finish, { once: true });
          audio.addEventListener('error', finish, { once: true });
          void sourceLoaderRef
            .current()
            .then(async () => {
              if (signal.aborted || !aliveRef.current) {
                finish();
                return;
              }
              window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: audio }));
              await audio.play();
            })
            .catch((error) => {
              // Autoplay restrictions require a user gesture; leave the bubbles playable manually.
              if (error?.name === 'NotAllowedError') cancelVoicePlayback();
              finish();
            });
        }),
      autoPlayEpoch
    );
  }, [autoPlayKey, autoPlay, autoPlayEpoch]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || loading) return;
    const wasPlaying = !audio.paused;
    cancelVoicePlayback();
    if (wasPlaying) {
      audio.pause();
      return;
    }
    setLoading(true);
    try {
      await ensureAudioSource();
      if (!aliveRef.current) return;
      window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: audio }));
      await audio.play();
    } catch {
      if (aliveRef.current) message.error(intl.formatMessage({ id: 'voice.playFailed' }));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  };

  const transcribe = async () => {
    if (transcribingRef.current) return;
    transcribingRef.current = true;
    setTranscribing(true);
    try {
      if (!transcribeAudio && fileId === undefined)
        throw new Error(intl.formatMessage({ id: 'voice.sourceUnavailable' }));
      const result = transcribeAudio ? await transcribeAudio() : await transcribeVoice({ fileId: fileId!, sessionId });
      if (!aliveRef.current) return;
      const text = result.text?.trim();
      if (!text) {
        message.info(intl.formatMessage({ id: 'voice.emptyTranscript' }));
        return;
      }
      setTranscript(text);
      setTranscriptExpanded(true);
      onTranscript?.(text);
    } catch (error) {
      if (aliveRef.current)
        message.error(typeof error === 'string' ? error : intl.formatMessage({ id: 'voice.transcribeFailed' }));
    } finally {
      transcribingRef.current = false;
      if (aliveRef.current) setTranscribing(false);
    }
  };

  const transcribeRef = useRef(transcribe);
  transcribeRef.current = transcribe;
  useEffect(() => {
    if (!autoTranscribe || variant !== 'user' || transcript || autoTranscribedRef.current) return;
    autoTranscribedRef.current = true;
    void transcribeRef.current();
  }, [autoTranscribe, transcript, variant]);

  const transcriptMenu = {
    items: [
      {
        key: 'transcript',
        label: transcriptExpanded
          ? intl.formatMessage({ id: 'voice.collapseTranscript' })
          : intl.formatMessage({ id: 'voice.transcribe' }),
        disabled: transcribing,
      },
    ],
    onClick: () => {
      if (transcriptExpanded) setTranscriptExpanded(false);
      else if (transcript) setTranscriptExpanded(true);
      else void transcribe();
    },
  };
  const bubble = (
    <button
      type="button"
      className={classNames(styles.bubble, { [styles.playing]: playing })}
      style={{ width: seconds ? Math.min(260, 112 + seconds * 2) : 112 }}
      aria-label={intl.formatMessage(
        { id: playing ? 'voice.pause' : 'voice.play' },
        {
          label:
            label ||
            (seconds
              ? intl.formatMessage({ id: 'voice.audioDuration' }, { seconds })
              : intl.formatMessage({ id: 'voice.audio' })),
        }
      )}
      aria-pressed={playing}
      onClick={togglePlay}
      disabled={loading}
    >
      <span className={styles.duration}>
        {seconds ? `${seconds}″` : <LoadingOutlined aria-label={intl.formatMessage({ id: 'voice.loadingDuration' })} />}
      </span>
      {loading ? (
        <LoadingOutlined />
      ) : (
        <svg className={styles.soundIcon} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="19" cy="12" r="1.5" fill="currentColor" />
          <path className={styles.waveNear} d="M15 8a6 6 0 0 0 0 8" />
          <path className={styles.waveFar} d="M10.5 4a11 11 0 0 0 0 16" />
        </svg>
      )}
    </button>
  );

  return (
    <div className={classNames(styles.voiceMessage, { [styles.assistantMessage]: variant === 'assistant' })}>
      <div className={styles.voiceRow}>
        {showTranscribe ? (
          <Dropdown trigger={['contextMenu']} menu={transcriptMenu}>
            {bubble}
          </Dropdown>
        ) : (
          bubble
        )}
        {showTranscribe && (
          <Dropdown trigger={['click']} menu={transcriptMenu}>
            <Button
              type="text"
              size="small"
              className={styles.menuButton}
              aria-label={intl.formatMessage({ id: 'voice.menu' })}
              loading={transcribing}
              icon={<DownOutlined />}
            />
          </Dropdown>
        )}
      </div>
      <audio
        ref={audioRef}
        preload={voice.durationMs > 0 ? 'none' : 'metadata'}
        onLoadedMetadata={() => {
          const duration = audioRef.current?.duration;
          if (duration && Number.isFinite(duration)) setAudioDurationMs(duration * 1000);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          if (sourceRef.current) URL.revokeObjectURL(sourceRef.current);
          sourceRef.current = '';
          blobRequestRef.current = undefined;
        }}
      />
      {transcriptExpanded && transcript && <div className={styles.transcript}>{transcript}</div>}
    </div>
  );
}
