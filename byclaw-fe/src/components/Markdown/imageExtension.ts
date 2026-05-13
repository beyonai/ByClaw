/* eslint-disable max-len */
import md5 from 'md5';
import styles from './index.module.less';

export function getImageUniqueCode(src: string) {
  return md5(src);
}

// 图片信息类型定义
interface ImageInfo {
  src: string;
  alt: string;
  title?: string;
  width?: string;
  height?: string;
}

const imageCollectedIds = new Set<string>();
const cancelCollectedIds = new Set<string>();

export function addImageCollectedIds(ids: string[]) {
  ids.forEach((id) => {
    if (!cancelCollectedIds.has(id)) {
      imageCollectedIds.add(id);
    }
  });
}

export const collectedStarHtml =
  '<svg style="color:#F7BA1E" viewBox="64 64 896 896" focusable="false" data-icon="star" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M908.1 353.1l-253.9-36.9L540.7 86.1c-3.1-6.3-8.2-11.4-14.5-14.5-15.8-7.8-35-1.3-42.9 14.5L369.8 316.2l-253.9 36.9c-7 1-13.4 4.3-18.3 9.3a32.05 32.05 0 00.6 45.3l183.7 179.1-43.4 252.9a31.95 31.95 0 0046.4 33.7L512 754l227.1 119.4c6.2 3.3 13.4 4.4 20.3 3.2 17.4-3 29.1-19.5 26.1-36.9l-43.4-252.9 183.7-179.1c5-4.9 8.3-11.3 9.3-18.3 2.7-17.5-9.5-33.7-27-36.3z"></path></svg>';
export const unCollectedStarHtml =
  '<svg viewBox="64 64 896 896" focusable="false" data-icon="star" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M908.1 353.1l-253.9-36.9L540.7 86.1c-3.1-6.3-8.2-11.4-14.5-14.5-15.8-7.8-35-1.3-42.9 14.5L369.8 316.2l-253.9 36.9c-7 1-13.4 4.3-18.3 9.3a32.05 32.05 0 00.6 45.3l183.7 179.1-43.4 252.9a31.95 31.95 0 0046.4 33.7L512 754l227.1 119.4c6.2 3.3 13.4 4.4 20.3 3.2 17.4-3 29.1-19.5 26.1-36.9l-43.4-252.9 183.7-179.1c5-4.9 8.3-11.3 9.3-18.3 2.7-17.5-9.5-33.7-27-36.3zM664.8 561.6l36.1 210.3L512 672.7 323.1 772l36.1-210.3-152.8-149L417.6 382 512 190.7 606.4 382l211.2 30.7-152.8 148.9z"></path></svg>';
export const loadingStarHtml =
  '<svg viewBox="0 0 1024 1024" focusable="false" data-icon="loading" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M988 548c-19.9 0-36-16.1-36-36 0-59.4-11.6-117-34.6-171.3a440.45 440.45 0 00-94.3-139.9 437.71 437.71 0 00-139.9-94.3C629 83.6 571.4 72 512 72c-19.9 0-36-16.1-36-36s16.1-36 36-36c69.1 0 136.2 13.5 199.3 40.3C772.3 66 827 103 874 150c47 47 83.9 101.8 109.7 162.7 26.7 63.1 40.2 130.2 40.2 199.3.1 19.9-16 36-35.9 36z"></path></svg>';

const downloadButtonHtml =
  '<svg t="1763445923924" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="22894" width="1em" height="1em"><path d="M512.192 96a32 32 0 0 1 32 32l-0.064 519.936 201.216-201.216a32 32 0 0 1 40.832-3.712l4.48 3.712a32 32 0 0 1 0 45.248l-256 256a32 32 0 0 1-45.312 0l-256-256a32 32 0 1 1 45.312-45.248l201.472 201.472V128a32 32 0 0 1 32-32zM768 864a32 32 0 1 1 0 64H256a32 32 0 1 1 0-64h512z" p-id="22895"></path></svg>';

export function toggleImageCollected(htmlElement: HTMLElement) {
  const src = htmlElement.getAttribute('data-image-src');
  if (!src) return;
  const code = getImageUniqueCode(src);
  const collected = htmlElement.getAttribute('data-image-collected') === 'true';
  if (collected) {
    imageCollectedIds.delete(code);
    cancelCollectedIds.add(code);
    htmlElement.innerHTML = unCollectedStarHtml;
  } else {
    imageCollectedIds.add(code);
    cancelCollectedIds.delete(code);
    htmlElement.innerHTML = collectedStarHtml;
  }
  htmlElement.classList.remove(styles.loadingIcon);
  htmlElement.setAttribute('data-image-collected', `${!collected}`);
}

// 图片收集扩展 - 使用 DOM API 解析（非正则），并为图片添加收藏按钮
export default function createImageCollectorExtension({
  onImagesCollected,
  wrap,
  hideButtonList = [],
}: {
  onImagesCollected?: (images: ImageInfo[]) => void;
  wrap?: React.RefObject<HTMLDivElement | null>;
  hideButtonList?: string[];
}) {
  const images: ImageInfo[] = [];

  return {
    type: 'html' as const,
    filter(html: string) {
      if (typeof document !== 'undefined') {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const imgElements = tempDiv.querySelectorAll('img');

        images.length = 0; // 清空之前的图片
        imgElements.forEach((img) => {
          const src = img.getAttribute('src') || '';
          const alt = img.getAttribute('alt') || '';
          const title = img.getAttribute('title') || undefined;
          const width = img.getAttribute('width') || undefined;
          const height = img.getAttribute('height') || undefined;

          const md5Src = getImageUniqueCode(src);

          img.setAttribute('data-md5-src', md5Src);

          images.push({
            src,
            alt,
            title,
            width,
            height,
          });

          // 为每个图片添加收藏按钮
          // 创建包装容器
          const wrapper = document.createElement('div');
          wrapper.className = styles.markdownImageWrapper;
          wrapper.setAttribute('data-image-src', md5Src);

          // 创建收藏按钮
          const starButton = document.createElement('span');
          starButton.className = styles.markdownImageStar;
          starButton.style.cssText = 'font-size: 15px';
          starButton.setAttribute('data-image-src', src);
          const isCollected = imageCollectedIds.has(md5Src);
          starButton.setAttribute('data-image-collected', isCollected ? 'true' : 'false');
          starButton.setAttribute('data-image-title', alt || title || '');
          starButton.innerHTML = isCollected ? collectedStarHtml : unCollectedStarHtml;
          if (isCollected) {
            starButton.style.color = '#F7BA1E';
          }

          const downloadButton = document.createElement('span');
          downloadButton.className = styles.markdownImageDownload;
          downloadButton.style.cssText = 'font-size: 18px';
          downloadButton.setAttribute('data-image-src', src);
          downloadButton.setAttribute('data-image-title', alt || title || '');
          downloadButton.innerHTML = downloadButtonHtml;

          // 处理加载状态，加载失败不展示按钮
          const clonedImg = img.cloneNode(true) as HTMLImageElement;
          const handleLoad = () => {
            const p = wrap?.current?.querySelector(`div[data-image-src="${md5Src}"]`);
            const hasSartBtn = p?.querySelector(`.${styles.markdownImageStar}`);
            const hasDownloadBtn = p?.querySelector(`.${styles.markdownImageDownload}`);

            if (!hasSartBtn && !hideButtonList.includes('star')) {
              p?.appendChild(starButton);
            }
            if (!hasDownloadBtn && !hideButtonList.includes('download')) {
              p?.appendChild(downloadButton);
            }
          };
          const handleError = () => {
            const p = wrap?.current?.querySelector(`[data-child-image-src="${md5Src}"]`);
            const hasSartBtn = p?.querySelector(`.${styles.markdownImageStar}`);
            const hasDownloadBtn = p?.querySelector(`.${styles.markdownImageDownload}`);

            if (hasSartBtn) {
              p?.removeChild(starButton);
            }
            if (hasDownloadBtn) {
              p?.removeChild(downloadButton);
            }
          };
          clonedImg.addEventListener('load', handleLoad);
          clonedImg.addEventListener('error', handleError);
          // 若图片已缓存完成，根据状态直接处理
          if (clonedImg.complete) {
            if (clonedImg.naturalWidth > 0) {
              handleLoad();
            } else {
              handleError();
            }
          }

          // 将图片和按钮包装在一起
          const parent = img.parentNode;
          if (parent) {
            wrapper.appendChild(clonedImg);
            parent.replaceChild(wrapper, img);
          }
        });

        // 更新HTML
        const updatedHtml = tempDiv.innerHTML;

        // 回调通知收集到的图片
        if (onImagesCollected && images.length > 0) {
          onImagesCollected([...images]);
        }

        return updatedHtml;
      }

      return html;
    },
    // 提供获取图片的方法
    getImages: () => [...images],
  };
}
