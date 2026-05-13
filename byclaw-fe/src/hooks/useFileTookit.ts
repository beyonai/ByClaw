import { createElement, useMemo, useRef, useState } from 'react';
import { compressImgFileAndUpload } from '@/pages/manager/utils/file';

type PickOpts = {
  accept?: string;
  maxSize?: number;
};

type PickFn = {
  (opts: PickOpts & { multiple: true; count?: number; totalSize?: number }): Promise<File[] | undefined>;
  (opts: PickOpts & { multiple: false }): Promise<File | undefined>;
  (opts?: PickOpts): Promise<File | undefined>;
};

type iFileToolkit = {
  file: File | undefined;
  files: File[] | undefined;
  pick: PickFn;
  clear: () => void;
  holder: React.ReactNode;
  upload: (opts: PickOpts & { maxWidth?: number; maxHeight?: number }) => Promise<void>;
  toBase64: (file: File) => Promise<string>;
  compress: (file: File | string, maxw: number, maxh?: number) => Promise<File | undefined>;

  message?: string;
};

interface UseFileToolkit {
  (): iFileToolkit;
  upload: (file: File) => Promise<void>;
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

/**
 * ## 使用文件工具集
 * - 选择文件
 * - 图片尺寸控制
 * - 上传文件
 * @returns
 */
export const useFileTookit: UseFileToolkit = () => {
  const [file, setFile] = useState<File>();
  const [files, setFiles] = useState<File[]>();
  const [message, setMessage] = useState<string>();
  const ref = useRef<HTMLDivElement>(null);

  /** 选择文件 */
  const pick: PickFn = (opts = {}) =>
    new Promise<any>((resolve, reject) => {
      let multiple = false;
      let count = 1;
      let totalSize = 0;
      if ('count' in opts) count = opts.count || 1;
      if ('multiple' in opts) ({ multiple } = opts);
      if ('totalSize' in opts) totalSize = opts.totalSize || 0;

      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = multiple;
      if (opts.accept) input.accept = opts.accept;

      input.style.zIndex = '-9999';
      input.style.position = 'absolute';
      input.style.width = '0';
      input.style.height = '0';
      input.style.opacity = '0';

      const cleanup = () => {
        requestAnimationFrame(() => {
          input.remove();
        });
      };

      input.onchange = (e) => {
        let files = Array.from((e.target as HTMLInputElement).files || []);
        const file = files[0];

        if (multiple && totalSize) {
          let size = 0;
          for (let i = 0; i < files.length; i += 1) {
            const temp = files[i];
            size += temp.size;
            if (size > totalSize) {
              files = files.slice(0, i);
              break;
            }
          }
          if (files.length > count) {
            files = files.slice(0, count);
            const msg = `单次最多选择${count}个文件`;
            setMessage(msg);
          }
        }

        if (opts.maxSize && file && file.size > opts.maxSize) {
          const msg = `文件大小超出限制，最大${opts.maxSize / 1024 / 1024}MB`;
          reject(new Error(msg, { cause: file }));
          setMessage(msg);
          cleanup();
          return;
        }

        if (multiple) {
          setFiles(files);
        } else {
          setFile(file);
        }
        resolve(multiple ? files : file);

        cleanup();
      };

      input.oncancel = () => {
        setFile(undefined);
        resolve(undefined);
        cleanup();
      };

      input.click();
      ref.current?.append(input);
    });

  /** 压缩图片 */
  const compress = async (file: File | string, maxw = 400, maxh?: number) => {
    const temp = file instanceof File ? window.URL.createObjectURL(file) : file;
    const name = file instanceof File ? file.name.split('.').slice(0, -1).join('.') : `${Date.now()}`;

    const canvas = document.createElement('canvas');
    canvas.style.zIndex = '-9999';
    canvas.style.opacity = '0';
    canvas.style.position = 'absolute';

    const img = new window.Image();

    const task = new Promise<File | undefined>((resolve) => {
      img.onload = () => {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(undefined);
          return;
        }

        const { width, height } = limtSize(img.width, img.height, maxw, maxh);
        console.log('原图尺寸%s x %s，压缩尺寸 %s x %s', img.width, img.height, width, height);

        canvas.width = width;
        canvas.height = height;

        ctx.drawImage(img, 0, 0, width, height);

        ctx.canvas.toBlob(
          (blob) => {
            if (blob) {
              const file = new File([blob], `${name}.${blob.type.split('/').pop() || 'png'}`, { type: blob.type });
              resolve(file);
            } else {
              resolve(undefined);
            }
          },
          'image/png',
          0.5
        );
      };
      img.onerror = () => {
        resolve(undefined);
      };

      img.src = temp;
    });

    // 最后释放资源
    task.finally(() => {
      if (file instanceof File) window.URL.revokeObjectURL(temp);
    });
    return task;
  };

  /** 上传文件 */
  const upload = async (opts: PickOpts & { maxWidth?: number; maxHeight?: number } = {}) => {
    let file: File | undefined = await pick(opts);

    // 需要压缩尺寸
    if (file && (opts.maxWidth || opts.maxHeight)) {
      file = await compress(file, opts.maxWidth, opts.maxHeight);
    }
    // 直接上传
    if (file) {
      // 使用公共上传方式
      return useFileTookit.upload(file);
    }
    return undefined;
  };

  /** 文件转Base64 */
  const toBase64 = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const result = reader.result as string;

        resolve(result);
      };

      reader.onerror = () => {
        reject(new Error('文件读取失败'));
      };

      // 读取文件为base64
      reader.readAsDataURL(file);
    });
  };

  /** 清空文件 */
  const clear = () => setFile(undefined);

  const holder = useMemo(() => createElement('div', { ref }), []);

  return {

    /** 当前选择的文件 */
    file,

    /** 当前选择的文件列表 */
    files,

    /** 选择文件 */
    pick,

    /** 清空文件 */
    clear,

    /** 上传文件 */
    upload,

    /** 需要指定弹出位置的可选 - 如H5页面 */
    holder,

    /** 文件转Base64 */
    toBase64,

    /** 压缩图片 */
    compress,

    /** 错误信息 */
    message,
  };
};

useFileTookit.upload = async (file: File) => compressImgFileAndUpload({ file });
