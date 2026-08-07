import { closeChatResourceTab, upsertChatResourceTab, type ChatResourceTab } from '../tabState';

const tab = (key: string, content = key): ChatResourceTab => ({ key, title: key.toUpperCase(), content });

describe('chat resource workspace tab state', () => {
  it('updates an existing resource tab instead of creating a duplicate', () => {
    const tabs = upsertChatResourceTab([tab('file')], tab('file', 'latest preview'));

    expect(tabs).toHaveLength(1);
    expect(tabs[0].content).toBe('latest preview');
  });

  it('selects the neighboring tab when the active tab closes', () => {
    expect(closeChatResourceTab([tab('a'), tab('b'), tab('c')], 'b', 'b')).toEqual({
      tabs: [tab('a'), tab('c')],
      activeKey: 'c',
    });
    expect(closeChatResourceTab([tab('a'), tab('b')], 'b', 'b')).toEqual({
      tabs: [tab('a')],
      activeKey: 'a',
    });
  });
});
