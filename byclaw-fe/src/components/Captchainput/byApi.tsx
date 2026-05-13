import React, { useState, useImperativeHandle, forwardRef } from 'react';
import { useIntl } from '@umijs/max';
import { getCaptcha } from '@/service/auth';
import styles from './byApi.module.less';

type CaptchaInputByApiProps = Record<string, never>;

interface CaptchaInputByApiRef {
  validate: (value: string) => boolean;
  refresh: () => void;
}

function CaptchaInputByApi(_props: CaptchaInputByApiProps, ref: React.Ref<CaptchaInputByApiRef>) {
  const intl = useIntl();
  const [captchaImage, setCaptchaImage] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // 加载验证码图片
  const loadCaptcha = async () => {
    try {
      setLoading(true);

      // 设置 responseType 为 'blob' 来接收图片数据
      const response = await getCaptcha();

      let blobData: Blob | null = null;

      // 处理不同的响应格式
      if (response instanceof Blob) {
        // 直接是 Blob 对象
        blobData = response;
      } else if (response && typeof response === 'object' && response.file instanceof Blob) {
        // 是包含 file 属性的对象（来自请求拦截器）
        blobData = response.file;
      } else {
        console.error('无法从响应中提取 Blob 数据:', response);
        // message.error('获取验证码失败：响应格式错误');
        return;
      }

      if (blobData) {
        // 检查 Blob 类型
        // 创建 Blob URL 用于显示图片
        const imageUrl = URL.createObjectURL(blobData);
        setCaptchaImage(imageUrl);
      }
    } catch (error) {
      console.error('获取验证码失败:', error);
      // message.error('获取验证码失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  // 暴露给父组件的方法
  useImperativeHandle(ref, () => ({
    validate: () => {
      return true;
    },
    refresh: loadCaptcha,
  }));

  // 处理刷新按钮点击
  const handleRefresh = () => {
    // 清理之前的图片 URL 避免内存泄漏
    if (captchaImage) {
      URL.revokeObjectURL(captchaImage);
    }
    loadCaptcha();
  };

  // 组件挂载时加载验证码
  React.useEffect(() => {
    loadCaptcha();

    // 组件卸载时清理资源
    return () => {
      if (captchaImage) {
        URL.revokeObjectURL(captchaImage);
      }
    };
  }, []);

  return (
    <div className={styles.captchaContainer}>
      <div className={styles.captchaImageContainer}>
        {captchaImage && (
          <img
            src={captchaImage}
            alt={intl.formatMessage({ id: 'login.verificationCode' })}
            className={styles.captchaImage}
            onClick={handleRefresh}
            style={{ cursor: 'pointer' }}
          />
        )}
        {!captchaImage && loading && (
          <div className={styles.captchaPlaceholder}>{intl.formatMessage({ id: 'common.loading' })}</div>
        )}
        {!captchaImage && !loading && (
          <div className={styles.captchaPlaceholder} onClick={handleRefresh}>
            {intl.formatMessage({ id: 'captchaInput.clickToRefresh' })}
          </div>
        )}
      </div>
    </div>
  );
}

export default forwardRef<CaptchaInputByApiRef, CaptchaInputByApiProps>(CaptchaInputByApi);
