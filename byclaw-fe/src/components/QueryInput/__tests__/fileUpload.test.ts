import type { IAgentFileUploadConf } from '@/hooks/useAgentUploadFileConfig';
import { isUploadFileButtonVisible, isUploadFileCountExceeded, isUploadFileSizeExceeded } from '../utils/fileUpload';

describe('upload button visibility', () => {
  it.each([0, 5])('hides when explicitly disabled regardless of maxFileCount=%s', (maxFileCount) => {
    expect(isUploadFileButtonVisible({ enabled: false, maxFileSize: 0, maxFileCount })).toBe(false);
  });

  it.each([undefined, null, {}, { maxFileSize: 10, maxFileCount: 0 }])(
    'shows without an explicit upload switch: %p',
    (config) => {
      expect(isUploadFileButtonVisible(config)).toBe(true);
    }
  );

  it.each([true, undefined, null, 0, 1, '', 'false', 'true'])(
    'does not treat non-false JSON values as disabled: %p',
    (enabled) => {
      // 系统参数为 JSON，防止旧配置中的字符串或数字被按真假值误判为关闭。
      const config = { enabled } as unknown as Partial<IAgentFileUploadConf>;
      expect(isUploadFileButtonVisible(config)).toBe(true);
    }
  );

  it.each([true, undefined])('applies the attachment limit when enabled is %p', (enabled) => {
    const config = { enabled, maxFileSize: 10, maxFileCount: 5 };

    expect(isUploadFileButtonVisible(config, 4)).toBe(true);
    expect(isUploadFileButtonVisible(config, 5)).toBe(false);
    expect(isUploadFileButtonVisible(config, 6)).toBe(false);
  });

  it('restores the button after an attachment is removed below the limit', () => {
    const config = { enabled: true, maxFileCount: 5 };

    expect(isUploadFileButtonVisible(config, 5)).toBe(false);
    expect(isUploadFileButtonVisible(config, 4)).toBe(true);
  });

  it('does not restore an explicitly disabled button after removing attachments', () => {
    const config = { enabled: false, maxFileCount: 5 };

    expect(isUploadFileButtonVisible(config, 5)).toBe(false);
    expect(isUploadFileButtonVisible(config, 4)).toBe(false);
    expect(isUploadFileButtonVisible(config, 0)).toBe(false);
  });

  it.each([undefined, 0, -1])('does not impose an attachment limit for maxFileCount=%p', (maxFileCount) => {
    expect(isUploadFileButtonVisible({ enabled: true, maxFileCount }, 10)).toBe(true);
  });
});

describe('upload count and size limits', () => {
  it.each([undefined, null, {}, { maxFileSize: 0, maxFileCount: 0 }])(
    'does not impose limits for missing or zero configuration: %p',
    (config) => {
      expect(isUploadFileCountExceeded(config, 100)).toBe(false);
      expect(isUploadFileSizeExceeded(config, 100 * 1024 * 1024)).toBe(false);
    }
  );

  it('enforces the count limit independently of an unlimited file size', () => {
    const config = { maxFileCount: 5, maxFileSize: 0 };

    expect(isUploadFileCountExceeded(config, 4)).toBe(false);
    expect(isUploadFileCountExceeded(config, 5)).toBe(false);
    expect(isUploadFileCountExceeded(config, 6)).toBe(true);
    expect(isUploadFileSizeExceeded(config, 100 * 1024 * 1024)).toBe(false);
  });

  it('enforces the size limit independently of an unlimited file count', () => {
    const config = { maxFileCount: 0, maxFileSize: 10 };
    const sizeLimit = 10 * 1024 * 1024;

    expect(isUploadFileCountExceeded(config, 100)).toBe(false);
    expect(isUploadFileSizeExceeded(config, sizeLimit - 1)).toBe(false);
    expect(isUploadFileSizeExceeded(config, sizeLimit)).toBe(false);
    expect(isUploadFileSizeExceeded(config, sizeLimit + 1)).toBe(true);
  });
});
