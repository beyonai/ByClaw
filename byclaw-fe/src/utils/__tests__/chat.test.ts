/**
 * 聊天工具函数测试
 */
import type { ISandboxesInfo } from '@/models/common/useAppStore';
import CookieUtil from '../cookie';
import { getDisplayUserNameInChat, getVNCUrl } from '../chat';

describe('getVNCUrl', () => {
  const sandbox = (status: string, endpoint: string): ISandboxesInfo => ({
    userCode: 'test-user',
    sandboxId: `${status}-sandbox`,
    sandboxType: 'byclaw',
    status,
    instanceEndpoints: { vnc: endpoint },
  });

  afterEach(() => CookieUtil.delete('novncUrl'));

  it('selects the RUNNING endpoint after a STARTING sandbox and preserves its token', () => {
    const url = getVNCUrl([
      sandbox('STARTING', '/v1/sandboxes/starting/proxy/8081?token=starting-test-token'),
      sandbox('RUNNING', '/v1/sandboxes/running/proxy/8081?token=running-test-token'),
    ]);

    expect(url).toBe(
      `${window.location.origin}/v1/sandboxes/running/proxy/8081/?token=running-test-token&autoconnect=true&resize=scale`
    );
    expect(CookieUtil.get('novncUrl')).toBe(url);
  });

  it.each(['STARTING', 'STOPPED', 'FAILED'])('does not use a %s sandbox', (status) => {
    expect(getVNCUrl([sandbox(status, '/v1/sandboxes/inactive/proxy/8081')])).toBe('');
  });

  it('returns an empty URL when no RUNNING sandbox has a VNC endpoint', () => {
    expect(getVNCUrl([])).toBe('');
    expect(getVNCUrl([sandbox('RUNNING', '')])).toBe('');
  });

  it('uses an absolute endpoint with its custom path and query parameters', () => {
    expect(getVNCUrl([sandbox('RUNNING', 'https://vnc.example/desktop/vnc.html?token=test-token&resize=remote')])).toBe(
      'https://vnc.example/desktop/vnc.html?token=test-token&resize=scale&autoconnect=true'
    );
  });
});

describe('Chat Utils', () => {
  describe('getDisplayUserNameInChat', () => {
    it('should return last two characters of name', () => {
      expect(getDisplayUserNameInChat('张三')).toBe('张三');
      expect(getDisplayUserNameInChat('李四五六')).toBe('五六');
      expect(getDisplayUserNameInChat('王五')).toBe('王五');
    });

    it('should handle empty or invalid names', () => {
      expect(getDisplayUserNameInChat('')).toBe('');
      expect(getDisplayUserNameInChat(null as any)).toBe('');
      expect(getDisplayUserNameInChat(undefined as any)).toBe('');
    });
  });
});
