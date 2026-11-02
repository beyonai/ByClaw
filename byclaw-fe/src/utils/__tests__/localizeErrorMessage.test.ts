import { localizeErrorMessage } from '../localizeErrorMessage';

describe('localizeErrorMessage', () => {
  it('uses localized fallback for foreign-language and empty errors', () => {
    expect(localizeErrorMessage('Connection refused', '请求失败', 'zh-CN')).toBe('请求失败');
    expect(localizeErrorMessage('OpenClaw请求失败: Connection refused', '请求失败', 'zh-CN')).toBe('请求失败');
    expect(localizeErrorMessage('服务不可用', 'Request failed', 'en-US')).toBe('Request failed');
    expect(localizeErrorMessage('', '请求失败', 'zh-CN')).toBe('请求失败');
  });

  it('preserves details already written in the selected language', () => {
    expect(localizeErrorMessage('资源不存在', '请求失败', 'zh-CN')).toBe('资源不存在');
    expect(localizeErrorMessage('resourceId 不能为空', '请求失败', 'zh-CN')).toBe('resourceId 不能为空');
    expect(localizeErrorMessage('Resource not found', 'Request failed', 'en-US')).toBe('Resource not found');
  });
});
