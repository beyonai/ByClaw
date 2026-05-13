import type { ReactNode } from 'react';
import { message } from 'antd';

type ModalErrorFn = (config: { content: ReactNode }) => void;

let appModalError: ModalErrorFn | null = null;

/** 由 AntdAppModalHolder 在 App 挂载后注入，供 request 等非组件代码使用 */
export function registerAppModalError(fn: ModalErrorFn | null) {
  appModalError = fn;
}

/** 业务接口 code !== 0 等场景：优先用 App 上下文 modal，未就绪时降级为 message */
export function showRequestErrorModal(content: ReactNode) {
  const display = typeof content === 'string' && content.trim() !== '' ? content : '请求失败';
  if (appModalError) {
    appModalError({ content: display });
  } else {
    void message.error(display);
  }
}
