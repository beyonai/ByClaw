import { BinaryPreviewError, validateImageSize, type DecodedImagePage } from './binaryPreview';
import type { ImageDocument } from './imageDecoder';
import { MAX_RAW_BYTES, MAX_RAW_SENSOR_PIXELS } from './rawTypes';

/** RAW 在专用 worker 中解码；先查传感器尺寸，再进行高内存开销的 unpack/demosaic。 */
export async function openRawDocument(buffer: ArrayBuffer): Promise<ImageDocument> {
  if (!buffer.byteLength) throw new BinaryPreviewError('invalid');
  if (buffer.byteLength > MAX_RAW_BYTES) throw new BinaryPreviewError('limit');
  if (typeof BigInt !== 'function' || typeof BigInt64Array !== 'function' || typeof BigUint64Array !== 'function')
    throw new BinaryPreviewError('unsupported');
  const { loadRaw } = await import('./loadRaw');
  const decoder = await loadRaw();
  let disposed = false;
  const dispose = () => {
    if (!disposed) {
      disposed = true;
      decoder.dispose();
    }
  };
  try {
    decoder.open(buffer);
    const width = decoder.getRawWidth();
    const height = decoder.getRawHeight();
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
      throw new BinaryPreviewError('invalid');
    if (width > 20000 || height > 20000 || width * height > MAX_RAW_SENSOR_PIXELS)
      throw new BinaryPreviewError('limit');
    let rendered = false;
    return {
      count: 1,
      async render(index): Promise<DecodedImagePage> {
        if (disposed) throw new BinaryPreviewError('closed');
        if (index !== 0 || rendered) throw new BinaryPreviewError('invalid');
        rendered = true;
        try {
          // 预览使用半尺寸、相机白平衡和 8 位 sRGB；下载仍保留原始 RAW。
          decoder.setHalfSize(1);
          decoder.setUseCameraWb(1);
          decoder.setOutputColor(1);
          decoder.setOutputBps(8);
          decoder.setDemosaic(0);
          decoder.unpack();
          decoder.dcrawProcess();
          const image = decoder.dcrawMakeMemImage();
          validateImageSize(image.width, image.height);
          if (
            image.type_ !== 'LIBRAW_IMAGE_BITMAP' ||
            image.bits !== 8 ||
            ![1, 3].includes(image.colors) ||
            image.data.length !== image.width * image.height * image.colors
          )
            throw new BinaryPreviewError('unsupported');
          const pixels = new Uint8Array(image.width * image.height * 4);
          for (let source = 0, target = 0; target < pixels.length; source += image.colors, target += 4) {
            pixels[target] = image.data[source];
            pixels[target + 1] = image.data[source + (image.colors === 1 ? 0 : 1)];
            pixels[target + 2] = image.data[source + (image.colors === 1 ? 0 : 2)];
            pixels[target + 3] = 255;
          }
          // LibRaw 的 processed image 已按相机方向旋转，不能再次应用 EXIF 方向。
          return { width: image.width, height: image.height, pixels, orientation: 1 };
        } finally {
          dispose();
        }
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
