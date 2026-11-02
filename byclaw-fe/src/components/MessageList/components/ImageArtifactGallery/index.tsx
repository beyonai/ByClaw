import { useContext, useEffect, useRef, useState } from 'react';
import { Button, Modal, Select, Spin, Tooltip, message } from 'antd';
import {
  DownloadOutlined,
  EnterOutlined,
  EyeOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import GlobalContext from '@/layout/components/provider/global';
import { ChatFileArtifact, downloadChatFileArtifact, resolveChatFileArtifacts } from '@/service/chatFileArtifact';
import { DragType } from '@/components/QueryInput/withDrag';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import { normalizeFileBrowserPath, normalizeReferenceItem } from '@/layout/sider/components/FileSiderPanel/utils';
import styles from './index.module.less';

function useCanvasText() {
  const intl = useIntl();
  return (key: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `imageCanvas.${key}` }, values);
}

function IconAction({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <Tooltip title={label}>
      <Button type="text" aria-label={label} icon={icon} onClick={onClick} />
    </Tooltip>
  );
}

function useImage(sessionId: string, path: string, enabled = true) {
  const [state, setState] = useState<{ url?: string; error?: boolean }>({});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    let url: string | undefined;
    setState({});
    downloadChatFileArtifact({ sessionId, path })
      .then(({ file }) => {
        if (!active) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Invalid image');
        url = URL.createObjectURL(file);
        setState({ url });
      })
      .catch(() => {
        if (active) setState({ error: true });
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [sessionId, path, retry, enabled]);
  return { ...state, retry: () => setRetry((value) => value + 1) };
}

function CanvasImage({
  sessionId,
  artifact,
  zoom,
  offset,
}: {
  sessionId: string;
  artifact: ChatFileArtifact;
  zoom: number;
  offset: { x: number; y: number };
}) {
  const t = useCanvasText();
  const image = useImage(sessionId, artifact.path);
  if (image.error) return <Button onClick={image.retry}>{t('retry')}</Button>;
  if (!image.url) return <Spin tip={t('loading')} />;
  return (
    <img
      draggable={false}
      src={image.url}
      alt={artifact.title || artifact.fileName}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
    />
  );
}

function ImageCard({
  artifact,
  sessionId,
  onOpen,
  onQuote,
  onDownload,
}: {
  artifact: ChatFileArtifact;
  sessionId: string;
  onOpen: () => void;
  onQuote: () => void;
  onDownload: () => void;
}) {
  const t = useCanvasText();
  const card = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !card.current) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [visible]);
  const image = useImage(sessionId, artifact.path, visible);
  return (
    <div className={styles.card} ref={card}>
      <button
        type="button"
        className={styles.preview}
        onClick={onOpen}
        aria-label={t('open', { name: artifact.fileName })}
      >
        {image.url ? (
          <img src={image.url} alt={artifact.title || artifact.fileName} loading="lazy" />
        ) : image.error ? (
          <span>{t('unavailable')}</span>
        ) : (
          <Spin />
        )}
        <span className={styles.openHint}>
          <EyeOutlined />
        </span>
      </button>
      <div className={styles.caption}>
        <span>
          {artifact.parentImageId ? t('derived') : t('generated')}
          {artifact.width && artifact.height ? ` · ${artifact.width} × ${artifact.height}` : ''}
        </span>
        <span className={styles.actions}>
          <IconAction label={t('view')} icon={<EyeOutlined />} onClick={onOpen} />
          <IconAction label={t('quote')} icon={<EnterOutlined />} onClick={onQuote} />
          <IconAction label={t('download')} icon={<DownloadOutlined />} onClick={onDownload} />
        </span>
      </div>
    </div>
  );
}

export default function ImageArtifactGallery({
  artifacts,
  sessionId,
}: {
  artifacts: ChatFileArtifact[];
  sessionId: string;
}) {
  const t = useCanvasText();
  const { EventEmitter } = useContext(GlobalContext);
  const [selected, setSelected] = useState<ChatFileArtifact>();
  const [versions, setVersions] = useState<ChatFileArtifact[]>([]);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const activeEmployee = useActiveSiderAgent();
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | undefined>(undefined);
  const generation = useRef(0);
  const reset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };
  const close = () => {
    generation.current++;
    setSelected(undefined);
  };
  useEffect(() => {
    close();
    return () => {
      generation.current++;
    };
  }, [sessionId]);

  const open = async (artifact: ChatFileArtifact) => {
    const current = ++generation.current;
    setSelected(artifact);
    setVersions([artifact]);
    reset();
    const chain = [artifact];
    let parent = artifact.parentImageId;
    const seen = new Set([artifact.fileName]);
    while (
      parent &&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}\.(png|jpe?g|webp)$/i.test(parent) &&
      !seen.has(parent) &&
      chain.length < 20
    ) {
      seen.add(parent);
      try {
        const items = await resolveChatFileArtifacts({
          sessionId,
          paths: [`/by/.sessions/${sessionId}/image/${parent}`],
        });
        if (generation.current !== current) return;
        const previous = items[0];
        if (!previous) break;
        chain.unshift(previous);
        setVersions([...chain]);
        parent = previous.parentImageId;
      } catch {
        break;
      }
    }
  };
  const quote = (artifact = selected) => {
    if (!artifact) return;
    const path = normalizeFileBrowserPath(artifact.path).replace(/^\/by(?=\/)/, '');
    const item = normalizeReferenceItem(
      { name: artifact.fileName, path, isDir: false, size: artifact.fileSize },
      activeEmployee.resourceId || ''
    );
    close();
    EventEmitter?.emit('queryInput-insert-item', { item, type: DragType.commonFile });
  };
  const download = async (artifact = selected) => {
    if (!artifact) return;
    try {
      const { file, fileName } = await downloadChatFileArtifact({ sessionId, path: artifact.path });
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName || artifact.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      message.error(t('downloadFailed'));
    }
  };
  return (
    <>
      <div className={styles.gallery} data-testid="image-artifact-gallery">
        {artifacts.map((artifact) => (
          <ImageCard
            key={artifact.path}
            artifact={artifact}
            sessionId={sessionId}
            onOpen={() => open(artifact)}
            onQuote={() => quote(artifact)}
            onDownload={() => download(artifact)}
          />
        ))}
      </div>
      <Modal
        open={Boolean(selected)}
        onCancel={close}
        footer={null}
        width="min(1200px, 96vw)"
        centered
        title={t('title')}
        destroyOnHidden
        className={styles.modal}
      >
        {selected && (
          <>
            <div className={styles.toolbar}>
              <Select
                aria-label={t('versions')}
                value={selected.path}
                onChange={(path) => {
                  generation.current++;
                  setSelected(versions.find((version) => version.path === path));
                  reset();
                }}
                options={versions.map((version, index) => ({
                  value: version.path,
                  label: `${t('version', { number: index + 1 })}${
                    index === 0 && !version.parentImageId ? ` · ${t('original')}` : ''
                  }`,
                }))}
              />
              <span className={styles.spacer} />
              <Button
                aria-label={t('zoomOut')}
                icon={<MinusOutlined />}
                onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))}
              />
              <span className={styles.scale}>{Math.round(zoom * 100)}%</span>
              <Button
                aria-label={t('zoomIn')}
                icon={<PlusOutlined />}
                onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
              />
              <Button aria-label={t('fit')} icon={<ReloadOutlined />} onClick={reset} />
              <IconAction label={t('download')} icon={<DownloadOutlined />} onClick={() => download()} />
              <IconAction label={t('quote')} icon={<EnterOutlined />} onClick={() => quote()} />
            </div>
            <div
              className={styles.canvas}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                drag.current = { x: event.clientX, y: event.clientY, startX: offset.x, startY: offset.y };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (drag.current)
                  setOffset({
                    x: drag.current.startX + event.clientX - drag.current.x,
                    y: drag.current.startY + event.clientY - drag.current.y,
                  });
              }}
              onPointerUp={() => {
                drag.current = undefined;
              }}
              onPointerCancel={() => {
                drag.current = undefined;
              }}
            >
              <CanvasImage key={selected.path} artifact={selected} sessionId={sessionId} zoom={zoom} offset={offset} />
            </div>
            <div className={styles.description}>
              {selected.title || selected.fileName}
              <span>{t('hint')}</span>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
