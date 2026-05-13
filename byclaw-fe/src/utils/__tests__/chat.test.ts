/**
 * 聊天工具函数测试
 */
import { getDisplayUserNameInChat } from '../chat';

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
