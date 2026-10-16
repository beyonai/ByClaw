import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Pagination, Space, Spin } from 'antd';
import { useIntl } from '@umijs/max';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES, type DecodedImagePage } from './binaryPreview';
import { createPreviewWorker } from './createPreviewWorker';
import type { PreviewWorkerClient } from './previewWorkerClient';
import { RAW_PREVIEW_TYPES } from './formats';
import { MAX_RAW_BYTES } from './rawTypes';
import styles from './BinaryPreview.module.less';

/** TIFF 方向标记包含镜像；仅用 CSS rotate 无法正确显示扫描件的全部 8 种方向。 */
export function paintDecodedImage(canvas: HTMLCanvasElement, page: DecodedImagePage, rotation = 0) {
  const { width, height, pixels, orientation } = page;
  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const sourceContext = source.getContext('2d');
  const oriented = document.createElement('canvas');
  const context = oriented.getContext('2d');
  const target = canvas.getContext('2d');
  if (!sourceContext || !context || !target) throw new BinaryPreviewError('unsupported');
  sourceContext.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  const transposed = orientation >= 5 && orientation <= 8;
  oriented.width = transposed ? height : width;
  oriented.height = transposed ? width : height;
  const transforms: Record<number, [number, number, number, number, number, number]> = {
    2: [-1, 0, 0, 1, width, 0],
    3: [-1, 0, 0, -1, width, height],
    4: [1, 0, 0, -1, 0, height],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, height, 0],
    7: [0, -1, -1, 0, height, width],
    8: [0, -1, 1, 0, 0, width],
  };
  context.setTransform(...(transforms[orientation] || [1, 0, 0, 1, 0, 0]));
  context.drawImage(source, 0, 0);
  // 把用户旋转写入画布尺寸，避免 CSS 旋转后的左侧/顶部内容无法滚动到。
  canvas.width = rotation % 180 ? oriented.height : oriented.width;
  canvas.height = rotation % 180 ? oriented.width : oriented.height;
  target.translate(canvas.width / 2, canvas.height / 2);
  target.rotate((rotation * Math.PI) / 180);
  target.drawImage(oriented, -oriented.width / 2, -oriented.height / 2);
  source.width = source.height = 0;
  oriented.width = oriented.height = 0;
}

const errorMessage = (error: unknown, raw = false) => {
  if (error instanceof BinaryPreviewError && error.code === 'limit')
    return raw ? 'fileRender.rawLimit' : 'fileRender.imageLimit';
  if (error instanceof BinaryPreviewError && error.code === 'timeout') return 'fileRender.binaryTimeout';
  return 'fileRender.imageDecodeFailed';
};

export default function DecodedImage({ data, type, title }: { data?: string | Blob; type: string; title?: string }) {
  const intl = useIntl();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [session, setSession] = useState<{ client: PreviewWorkerClient; count: number }>();
  const [page, setPage] = useState(1);
  const [pixels, setPixels] = useState<DecodedImagePage>();
  const [errorId, setErrorId] = useState<string>();
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const raw = RAW_PREVIEW_TYPES.includes(type);

  useEffect(() => {
    let active = true;
    let client: PreviewWorkerClient | undefined;
    setSession(undefined);
    setPixels(undefined);
    setErrorId(undefined);
    setPage(1);
    setZoom(1);
    setRotation(0);
    void (async () => {
      if (!(data instanceof Blob) || !data.size) throw new BinaryPreviewError('invalid');
      if (data.size > (raw ? MAX_RAW_BYTES : MAX_BINARY_PREVIEW_BYTES)) throw new BinaryPreviewError('limit');
      const buffer = await data.arrayBuffer();
      if (!active) return;
      client = createPreviewWorker();
      const count = await client.request('openImage', { buffer, type }, [buffer]);
      if (active) setSession({ client, count });
    })().catch((error) => {
      if (active) setErrorId(errorMessage(error, raw));
      client?.dispose();
    });
    return () => {
      active = false;
      client?.dispose();
    };
  }, [data, type, raw]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    setPixels(undefined);
    setErrorId(undefined);
    setZoom(1);
    setRotation(0);
    void session.client
      .request('imagePage', { page: page - 1 })
      .then((result) => {
        if (active) setPixels(result);
      })
      .catch((error) => {
        if (active) setErrorId(errorMessage(error, raw));
      });
    return () => {
      active = false;
    };
  }, [session, page, raw]);

  useEffect(() => {
    if (!pixels || !canvas.current) return;
    try {
      paintDecodedImage(canvas.current, pixels, rotation);
    } catch (error) {
      setErrorId(errorMessage(error));
    }
  }, [pixels, rotation]);

  const label = (id: string) => intl.formatMessage({ id: `fileRender.${id}` });
  return (
    <div className={styles.preview}>
      <Space wrap className={styles.toolbar}>
        {session && session.count > 1 && (
          <Pagination
            simple
            current={page}
            pageSize={1}
            total={session.count}
            onChange={setPage}
            disabled={!pixels && !errorId}
          />
        )}
        <Button disabled={!pixels || zoom <= 0.25} onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))}>
          {label('zoomOut')}
        </Button>
        <Button disabled={!pixels || zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + 0.25))}>
          {label('zoomIn')}
        </Button>
        <Button disabled={!pixels} onClick={() => setRotation((value) => (value + 90) % 360)}>
          {label('rotate')}
        </Button>
        <Button
          disabled={!pixels}
          onClick={() => {
            setZoom(1);
            setRotation(0);
          }}
        >
          {label('resetImage')}
        </Button>
      </Space>
      {type === 'jxl' && !errorId && <Alert showIcon type="info" message={label('staticPhotoNotice')} />}
      {raw && !errorId && <Alert showIcon type="info" message={label('rawNotice')} />}
      {errorId ? (
        <Alert showIcon type="warning" message={intl.formatMessage({ id: errorId })} />
      ) : !pixels ? (
        <Spin />
      ) : null}
      <div className={styles.imageViewport}>
        <canvas
          ref={canvas}
          role="img"
          aria-label={title || label('decodedImage')}
          hidden={!pixels || !!errorId}
          style={{ width: `${zoom * 100}%` }}
        />
      </div>
    </div>
  );
}
