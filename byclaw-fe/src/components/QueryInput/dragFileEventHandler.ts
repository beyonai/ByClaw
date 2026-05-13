// @ts-ignore
import { getIntl } from '@umijs/max';
import type { IAgentFileUploadConf } from '@/hooks/useAgentUploadFileConfig';
import { validateAccept } from '@/utils/file';
import { message } from 'antd';

interface Props {
  onDropFile: (files: File[]) => any;
  uploadFileConfig?: () => IAgentFileUploadConf | undefined;
  // setIsDraggingFile: (isDraggingFile: boolean) => void;
}

function preventDefault(e: DragEvent) {
  e.preventDefault();
}

export default class DragFileEventHandler {
  private dragEnterCount = 0;

  props: Props;

  container: HTMLElement | null;

  maskElement: HTMLElement | null = null;

  constructor(container: HTMLElement, props: Props) {
    this.container = container;
    this.props = props;

    container.addEventListener('dragenter', this.handleDragEnter);
    container.addEventListener('dragleave', this.handleDragLeave);
    container.addEventListener('drop', this.handleDrop);
    container.addEventListener('dragover', preventDefault);
  }

  private setIsDraggingFile = (isDraggingFile: boolean) => {
    if (!this.container) return;
    let enable = true;
    if (this.props.uploadFileConfig) {
      const config = this.props.uploadFileConfig();
      if (config) {
        enable = config.enabled;
      }
    }
    if (!enable) return;
    if (isDraggingFile) {
      if (this.maskElement) return;
      const maskElement = document.createElement('div');
      maskElement.style.position = 'absolute';
      maskElement.style.top = '0';
      maskElement.style.left = '0';
      maskElement.style.width = '100%';
      maskElement.style.height = '100%';
      maskElement.style.backgroundColor = 'rgba(255,255,255,0.6)';
      maskElement.style.zIndex = '1000';
      maskElement.style.display = 'flex';
      maskElement.style.flexDirection = 'column';
      maskElement.style.alignItems = 'center';
      maskElement.style.justifyContent = 'center';
      maskElement.style.backdropFilter = 'blur(4px)';
      maskElement.style.gap = '10px';

      const iconElement = document.createElement('span');
      iconElement.innerHTML = `
<span role="img" _nk="RCQh33" class="anticon" style="font-size: 48px; color: var(--${PREFIX_NAME}-color-primary);">
  <svg width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false" class="">
    <use xlink:href="#icon-a-File-addition-onewenjiantianjia1"></use>
  </svg>
</span>`;
      maskElement.appendChild(iconElement);

      const titleElement = document.createElement('div');
      // textElement.style.color = '#fff';
      const intl = getIntl();
      titleElement.style.fontSize = '18px';
      titleElement.style.fontWeight = 'bold';
      titleElement.innerHTML = intl.formatMessage({ id: 'common.dragFileHere' });
      maskElement.appendChild(titleElement);
      if (this.props.uploadFileConfig) {
        const config = this.props.uploadFileConfig();

        console.log('upload file config', config);

        const requirements: string[] = [];
        if (config && config.maxFileCount > 0) {
          requirements.push(intl.formatMessage({ id: 'upload.maxFilesLimit' }, { count: config.maxFileCount }));
        }
        if (config && Array.isArray(config.allowedFileTypes) && config.allowedFileTypes.length > 0) {
          const acceptedFileTypes = config.allowedFileTypes;
          requirements.push(
            `${intl.formatMessage({ id: 'common.supportedFileTypes' })}${acceptedFileTypes
              .map((type) => type.trim())
              .join(', ')}`
          );
        }
        if (config && config.maxFileSize > 0) {
          requirements.push(intl.formatMessage({ id: 'upload.fileSizeLimit' }, { size: config.maxFileSize }));
        }
        if (requirements.length > 0) {
          const element = document.createElement('div');
          element.style.fontSize = '14px';
          element.style.color = `var(--${PREFIX_NAME}-color-text-secondary)`;
          element.innerHTML = requirements.join(', ');
          maskElement.appendChild(element);
        }
      }

      this.container.appendChild(maskElement);
      this.maskElement = maskElement;
    } else if (this.maskElement) {
      this.maskElement.remove();
      this.maskElement = null;
    }
  };

  private handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    if (this.props.uploadFileConfig) {
      const config = this.props.uploadFileConfig();
      if (config && !config.enabled) {
        return;
      }
    }
    const hasFiles = e.dataTransfer?.types.some((type) => type === 'Files');
    if (hasFiles) {
      this.dragEnterCount += 1;
      this.setIsDraggingFile(true);
    }
  };

  private handleDragLeave = () => {
    // 使用计数器来准确判断是否真的离开了文档区域
    this.dragEnterCount -= 1;
    if (this.dragEnterCount <= 0) {
      this.dragEnterCount = 0;
      this.setIsDraggingFile(false);
    }
  };

  private handleDrop = (e: DragEvent) => {
    this.dragEnterCount = 0;
    e.preventDefault();
    this.setIsDraggingFile(false);
    const files = e.dataTransfer?.files;
    if (!files) return;
    let acceptFiles = Array.from(files);
    let fileCount = acceptFiles.length;
    if (this.props.uploadFileConfig) {
      const config = this.props.uploadFileConfig();
      if (config) {
        if (!config.enabled) return;
        if (config.allowedFileTypes && config.allowedFileTypes.length > 0) {
          const accept = config.allowedFileTypes.join(',');
          acceptFiles = acceptFiles.filter((file) => validateAccept(file, accept));
          if (acceptFiles.length !== fileCount) {
            message.error(`${getIntl().formatMessage({ id: 'common.supportedFileTypes' })}${accept}`);
          }
        }
        fileCount = acceptFiles.length;
        if (config.maxFileSize) {
          const maxFileSize = Number(config.maxFileSize) * 1024 * 1024;
          acceptFiles = acceptFiles.filter((file) => file.size <= maxFileSize);
          if (acceptFiles.length !== fileCount) {
            message.error(getIntl().formatMessage({ id: 'upload.fileSizeLimit' }, { size: config.maxFileSize }));
          }
        }
      }
    }
    if (acceptFiles.length > 0) {
      e.preventDefault();
      this.props.onDropFile(acceptFiles);
    }
  };

  destroy() {
    this.container?.removeEventListener('dragenter', this.handleDragEnter);
    this.container?.removeEventListener('dragleave', this.handleDragLeave);
    this.container?.removeEventListener('drop', this.handleDrop);
    this.container?.removeEventListener('dragover', preventDefault);
    this.container = null;
    this.maskElement = null;
  }
}
