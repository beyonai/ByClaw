export interface CoverDrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const COVER_OUTPUT_WIDTH = 900;
export const COVER_OUTPUT_HEIGHT = 1200;

const getDrawRect = (
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  scale: number
): CoverDrawRect => {
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
};

export const getCoverDrawRect = (
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): CoverDrawRect =>
  getDrawRect(
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
  );

export const getContainDrawRect = (
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): CoverDrawRect =>
  getDrawRect(
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
  );

const loadImage = (file: File): Promise<{ image: HTMLImageElement; sourceUrl: string }> => {
  const sourceUrl = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ image, sourceUrl });
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error('Unable to read cover image'));
    };
    image.src = sourceUrl;
  });
};

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('Unable to generate cover image'));
    }, 'image/png');
  });

export const normalizeSkillGroupCover = async (file: File): Promise<File> => {
  const { image, sourceUrl } = await loadImage(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = COVER_OUTPUT_WIDTH;
    canvas.height = COVER_OUTPUT_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');

    const backgroundRect = getCoverDrawRect(
      image.naturalWidth,
      image.naturalHeight,
      COVER_OUTPUT_WIDTH,
      COVER_OUTPUT_HEIGHT
    );
    const foregroundRect = getContainDrawRect(
      image.naturalWidth,
      image.naturalHeight,
      COVER_OUTPUT_WIDTH,
      COVER_OUTPUT_HEIGHT
    );

    context.fillStyle = '#0b1530';
    context.fillRect(0, 0, COVER_OUTPUT_WIDTH, COVER_OUTPUT_HEIGHT);
    context.save();
    context.filter = 'blur(28px) brightness(0.72)';
    context.globalAlpha = 0.9;
    context.drawImage(
      image,
      backgroundRect.x,
      backgroundRect.y,
      backgroundRect.width,
      backgroundRect.height
    );
    context.restore();
    context.drawImage(
      image,
      foregroundRect.x,
      foregroundRect.y,
      foregroundRect.width,
      foregroundRect.height
    );

    const blob = await canvasToBlob(canvas);
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'cover';
    return new File([blob], `${baseName}-3x4.png`, { type: 'image/png', lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
};
