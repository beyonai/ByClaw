import { uploadImage } from '@/service/file';
import { createElement, useMemo, useRef, useState } from 'react';

enum UPLOAD_FOLDER {
  TEMP = 'TEMP',
}

/**
 * ### 限制等比尺寸大小
 * @param width 原宽
 * @param height 原高
 * @param maxWidth 限制最大宽，不传默认不限制
 * @param maxHeight 限制最大高，不传默认不限制
 * @returns
 */
const limtSize = (width: number, height: number, maxWidth = Infinity, maxHeight = Infinity) => {
  const ratio = Math.min(maxWidth / width, maxHeight / height);
  return ratio >= 1 ? { width, height } : { width: Math.floor(width * ratio), height: Math.floor(height * ratio) };
};

export const useUpload = () => {
  const [result, update] = useState<string>();
  const [uploading, setUploading] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement>(null);

  const pick = () =>
    new Promise<File | undefined>((resolve) => {
      const input = document.createElement('input');

      input.type = 'file';
      input.accept = '.jpeg,.jpg,.png,.gif,.bmp,.webp';
      input.multiple = false;

      input.style.zIndex = '-9999';
      input.style.position = 'absolute';
      input.style.width = '0';
      input.style.height = '0';
      input.style.opacity = '0';

      input.onchange = (e) => {
        const io = e.target as HTMLInputElement;
        resolve(io.files?.[0]);
        io.remove();
      };

      input.oncancel = (e) => {
        const io = e.target as HTMLInputElement;
        resolve(undefined);
        io.remove();
      };

      input.click();
      ref.current?.append(input);
    });

  const upload = async (file?: File) => {
    let temp = file;
    if (!temp) {
      setUploading(true);
      temp = await pick();

      if (!temp) {
        setUploading(false);
        return;
      }
    }
    const formData = new window.FormData();
    formData.append('file', temp);
    formData.append('module', UPLOAD_FOLDER.TEMP);

    setUploading(true);
    const mino = await uploadImage(formData);
    setUploading(false);
    if (!mino || !mino.fullPathName) {
      return;
    }
    update(mino.fullPathName);
  };

  const compress = async (file: File | string, maxw = 400, maxh?: number) => {
    const temp = file instanceof File ? window.URL.createObjectURL(file) : file;
    const name = file instanceof File ? file.name.replace(/^(.+)\.(.+)$/, '$1').concat('.jpeg') : `${Date.now()}.jpeg`;

    const canvas = document.createElement('canvas');
    canvas.style.zIndex = '-9999';
    canvas.style.opacity = '0';
    canvas.style.position = 'absolute';

    const img = new window.Image();

    const task = new Promise<File | null>((resolve) => {
      img.onload = () => {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }

        const { width, height } = limtSize(img.width, img.height, maxw, maxh);
        console.log('原图尺寸%s x %s，压缩尺寸 %s x %s', img.width, img.height, width, height);

        canvas.width = width;
        canvas.height = height;

        ctx.drawImage(img, 0, 0, width, height);

        ctx.canvas.toBlob((blob) => resolve(blob ? new File([blob], name) : null), 'image/jpeg', 0.5);
      };
      img.onerror = () => {
        resolve(null);
      };

      img.src = temp;
    });

    // 最后释放资源
    task.finally(() => {
      if (file instanceof File) window.URL.revokeObjectURL(temp);
    });
    return task;
  };

  const upload2 = async (file?: File, maxSize = 150000, maxWidth = 400, maxHeight?: number) => {
    let temp = file;
    if (!temp) {
      setUploading(true);
      temp = await pick();

      if (!temp) {
        setUploading(false);
        return undefined;
      }
    }

    if (maxSize && temp.size > maxSize) {
      const tmp = await compress(temp, maxWidth, maxHeight);

      console.log('原图大小 %s, 压缩后 %s', temp.size, tmp?.size);

      temp = tmp || temp;
    }

    return upload(temp);
  };

  const clear = () => {
    update(undefined);
  };

  /** 需要指定弹出位置的可选 - 如H5页面 */
  const holder = useMemo(() => createElement('div', { ref }), []);

  return { result, pick, clear, holder, upload, upload2, compress, uploading };
};
