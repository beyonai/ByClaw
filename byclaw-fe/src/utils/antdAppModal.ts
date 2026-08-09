import type { ReactNode } from 'react';
import { message } from 'antd';

type ModalErrorFn = (config: { content: ReactNode }) => void;

/** 由 AntdAppModalHolder 在 App 挂载后注入，供 request 等非组件代码使用 */
export function registerAppModalError(fn: ModalErrorFn | null) {
  // 保留注册接口以兼容现有 Provider，但请求错误不再使用阻塞式 Modal。
  void fn;
}

/** 业务接口 code !== 0 等场景统一使用非阻塞提示，避免遮挡业务表单。 */
export function showRequestErrorModal(content: ReactNode) {
  const display = typeof content === 'string' && content.trim() !== '' ? content : '请求失败';
  void message.error(display);
}
