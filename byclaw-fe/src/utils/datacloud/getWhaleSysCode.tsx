import React from 'react';
import { createRoot } from 'react-dom/client';
import { CloseOutlined } from '@ant-design/icons';
import { getPublicPath } from '..';

// 创建模态框的函数
function createModal(iframe: HTMLIFrameElement, onClose: () => void) {
  // 创建遮罩层
  const modalMask = document.createElement('div');
  modalMask.style.position = 'fixed';
  modalMask.style.top = '0';
  modalMask.style.left = '0';
  modalMask.style.width = '100%';
  modalMask.style.height = '100%';
  modalMask.style.backgroundColor = '#00000080';
  modalMask.style.zIndex = '9999';
  modalMask.style.justifyContent = 'center';
  modalMask.style.alignItems = 'center';
  modalMask.style.display = 'none';

  // 创建模态框容器
  const modalContainer = document.createElement('div');
  modalContainer.style.width = '80vw';
  modalContainer.style.height = '80vh';
  modalContainer.style.backgroundColor = '#fff';
  modalContainer.style.borderRadius = '8px';
  modalContainer.style.overflow = 'hidden';
  modalContainer.style.position = 'relative';

  // 将 iframe 添加到模态框容器中
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';

  modalContainer.appendChild(iframe);

  // 创建关闭按钮
  const closeButton = document.createElement('button');
  // closeButton.textContent = '×';
  closeButton.style.position = 'absolute';
  closeButton.style.top = '10px';
  closeButton.style.right = '10px';
  closeButton.style.background = 'none';
  closeButton.style.border = 'none';
  closeButton.style.color = '#707680';
  closeButton.style.cursor = 'pointer';
  closeButton.style.zIndex = '10000';
  createRoot(closeButton).render(React.createElement(CloseOutlined));

  closeButton.onclick = () => {
    document.body.removeChild(modalMask);
    onClose();
  };

  modalContainer.appendChild(closeButton);
  modalMask.appendChild(modalContainer);

  return modalMask;
}

export default function getWhaleSysCode(
  authUrl: string,
  params: {
    displayIframe?: boolean;
  }
) {
  return new Promise((resolve, reject) => {
    let isResolved = false;
    let modal: HTMLDivElement | null = null;

    // 构建完整的 redirectUrl
    const redirectUrl = `${window.location.origin}${getPublicPath()}datacloud/loginByCode`;

    // 为 authUrl 添加 redirectUrl 参数
    const url = new URL(authUrl);
    url.searchParams.set('redirectUrl', redirectUrl);

    const iframe: HTMLIFrameElement = document.createElement('iframe');
    iframe.src = url.toString();

    const listener = (e: MessageEvent) => {
      if (e && e.data && e.data.type === 'datacloud-login-code') {
        isResolved = true;
        // 移除模态框
        if (modal && document.body.contains(modal)) {
          document.body.removeChild(modal);
          modal = null;
        }
        if (e.data.code) {
          resolve(e.data.code);
        } else {
          reject(new Error('Failed to get code'));
        }
        window.removeEventListener('message', listener);
      }
    };
    const onClose = () => {
      window.removeEventListener('message', listener);
      modal = null;
      reject(new Error('User refused to login'));
    };

    modal = createModal(iframe, onClose);
    if (params.displayIframe) {
      modal.style.display = 'flex';
    }
    document.body.appendChild(modal);

    window.addEventListener('message', listener);

    // 设置 2 秒超时
    const timeoutId = setTimeout(() => {
      if (!isResolved && modal) {
        modal.style.display = 'flex';
      }
    }, 2000);

    iframe.onerror = () => {
      // 移除模态框
      if (modal && document.body.contains(modal)) {
        document.body.removeChild(modal);
        modal = null;
      }
      clearTimeout(timeoutId);
      reject(new Error('Failed to load sso auth url'));
    };
  });
}
