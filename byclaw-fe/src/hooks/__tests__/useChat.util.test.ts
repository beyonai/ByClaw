jest.mock('@/utils/messgae', () => ({
  isTextContentType: jest.fn((type: string | number) => [`1002`, `1001`].includes(`${type}`)),
}));

import { buildSubstance, substanceHandler } from '../useChat/util';
import { SSEMessageType, SSEEventStatus } from '@/constants/message';

describe('hooks/useChat/util', () => {
  describe('buildSubstance', () => {
    it('concatenates plain text when orderId is missing', () => {
      expect(buildSubstance('hello', ' world', '-1')).toBe('hello world');
      expect(buildSubstance(['a'] as any, 'b', '-1')).toEqual(['a', 'b']);
    });

    it('creates a new ordered node when lastSubstance is empty', () => {
      expect(buildSubstance(undefined, 'hello', '-1', '-1', '1')).toEqual([
        { text: 'hello', parentOrderId: '-1', orderId: '1' },
      ]);
    });

    it('appends substance to existing top-level node with same orderId', () => {
      const result = buildSubstance(
        [{ text: 'hello', parentOrderId: '-1', orderId: '1' }] as any,
        ' world',
        '-1',
        '-1',
        '1'
      );

      expect(result).toEqual([{ text: 'hello world', parentOrderId: '-1', orderId: '1' }]);
    });

    it('inserts child nodes under parent orderId', () => {
      const result = buildSubstance(
        [{ text: 'root', parentOrderId: '-1', orderId: '1' }] as any,
        'child',
        '-1',
        '1',
        '2'
      );

      expect(result).toEqual([
        {
          text: 'root',
          parentOrderId: '-1',
          orderId: '1',
          children: [{ text: 'child', parentOrderId: '1', orderId: '2' }],
        },
      ]);
    });
  });

  describe('substanceHandler', () => {
    it('creates a new message item when previous item is not reusable', () => {
      const newMessageItem = {
        contentType: SSEMessageType.text,
        status: SSEEventStatus.query,
        content: {
          substance: 'hello',
          orderId: '1',
          parentOrderId: '-1',
        },
      };

      expect(substanceHandler(newMessageItem as any)).toEqual({
        contentType: SSEMessageType.text,
        status: SSEEventStatus.query,
        content: {
          substance: [{ text: 'hello', orderId: '1', parentOrderId: '-1' }],
          orderId: '1',
          parentOrderId: '-1',
        },
      });
    });

    it('merges text substance into the last text message item', () => {
      const lastMessageItem = {
        contentType: SSEMessageType.text,
        content: {
          substance: 'hello',
        },
      };
      const newMessageItem = {
        contentType: SSEMessageType.text,
        content: {
          substance: ' world',
        },
      };

      const result = substanceHandler(newMessageItem as any, lastMessageItem as any);
      expect(result).toBeUndefined();
      expect(lastMessageItem.content.substance).toBe('hello world');
    });
  });
});
