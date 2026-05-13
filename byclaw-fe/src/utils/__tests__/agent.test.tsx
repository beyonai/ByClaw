jest.mock('@umijs/max', () => ({
  getLocale: jest.fn(() => 'zh-CN'),
}));

jest.mock('@/components/AntdIcon', () => ({
  __esModule: true,
  default: (props: any) => ({ type: 'AntdIcon', props }),
}));

jest.mock('@/utils', () => ({
  getPublicPath: jest.fn(() => '/app/'),
}));

jest.mock('@/utils/file', () => ({
  isBase64: jest.fn((value: string) => value === 'Zm9v'),
}));

import {
  canJumpAgent,
  getAgentAvatarUrl,
  getAgentPath,
  getAvatarUrl,
  getDefaultAgentAvatar,
  getDefaultAssistantAvatar,
  getWriterEditorUrl,
  isSandboxAgent,
} from '../agent';

describe('utils/agent', () => {
  it('returns default avatars', () => {
    expect(getDefaultAgentAvatar()).toBe('beyond/logout.png');
    expect(getDefaultAssistantAvatar()).toBe('beyond/logo256.svg');
  });

  it('normalizes agent avatar urls for public path, beyond assets, http, base64 and oss paths', () => {
    expect(getAgentAvatarUrl('')).toBe('/app/beyond/logo256.svg');
    expect(getAgentAvatarUrl('default')).toBe('/app/beyond/logo256.svg');
    expect(getAgentAvatarUrl('/app/a.png')).toBe('/app/a.png');
    expect(getAgentAvatarUrl('beyond/logo.png')).toBe('/app/beyond/logo.png');
    expect(getAgentAvatarUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(getAgentAvatarUrl('Zm9v')).toBe('Zm9v');
    expect(getAgentAvatarUrl('folder/a.png')).toBe('/byaiService/folder/a.png');
    expect(getAgentAvatarUrl('/byaiService/folder/a.png')).toBe('/byaiService/folder/a.png');
  });

  it('normalizes generic avatar urls', () => {
    expect(getAvatarUrl()).toBe('/app/beyond/logo256.svg');
    expect(getAvatarUrl('default')).toBe('/app/beyond/logo256.svg');
    expect(getAvatarUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(getAvatarUrl('/folder/a.png')).toBe('/byaiService/folder/a.png');
    expect(getAvatarUrl('beyond/a.png')).toBe('/app/beyond/a.png');
  });

  it('computes agent paths for sandbox, special types and default employee route', () => {
    expect(getAgentPath({ createType: 'FROM_SANDBOX' } as any)).toBe('/sandbox');
    expect(getAgentPath({ agentType: '014' } as any)).toBe('/searchAndQuery');
    expect(getAgentPath({ agentType: '015' } as any)).toBe('/functionCloud');
    expect(getAgentPath({ agentType: '001' } as any)).toBe('/employees');
  });

  it('identifies sandbox and jump capability correctly', () => {
    expect(isSandboxAgent({ createType: 'FROM_SANDBOX' } as any)).toBe(true);
    expect(canJumpAgent({ grantType: '1' } as any)).toBe(true);
    expect(canJumpAgent({ agentHomeUrl: 'https://home' } as any)).toBe(false);
    expect(canJumpAgent({} as any)).toBe(true);
  });

  it('builds writer editor url with expected query params', () => {
    Object.defineProperty(window, 'location', {
      value: { origin: 'https://example.com' },
      writable: true,
      configurable: true,
    });

    const url = new URL(
      getWriterEditorUrl({
        sessionId: 's1',
        docId: 'd1',
        templateId: 't1',
        messageId: 'm1',
      })
    );

    expect(url.pathname).toBe('/aiwrite/write');
    expect(url.searchParams.get('sessionId')).toBe('s1');
    expect(url.searchParams.get('docId')).toBe('d1');
    expect(url.searchParams.get('templateId')).toBe('t1');
    expect(url.searchParams.get('messageId')).toBe('m1');
    expect(url.searchParams.get('language')).toBe('zh-CN');
  });
});
