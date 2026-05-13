import { useEffect } from 'react';
import { App } from 'antd';
import { registerAppModalError } from '@/utils/antdAppModal';

/** 将 App.useApp().modal 注册到全局，避免在 axios 里使用 Modal.error 静态方法触发主题上下文告警 */
const AntdAppModalHolder = () => {
  const { modal } = App.useApp();

  useEffect(() => {
    registerAppModalError((config) => {
      modal.error(config);
    });
    return () => registerAppModalError(null);
  }, [modal]);

  return null;
};

export default AntdAppModalHolder;
