import { createEditor } from 'slate';
import { withEditableNavigation, withMention } from '..';

const invalidResource = {
  type: 'resource',
  id: 'skill-1',
  name: 'Old Skill',
  resourceName: 'Old Skill',
  resourceType: 'SKILL',
  requiresAgentResourceReplacement: true,
  children: [{ text: '' }],
} as const;

describe('withEditableNavigation', () => {
  it('keeps the caret before following text when Backspace removes an invalid resource', () => {
    const editor = withEditableNavigation(withMention(createEditor()));
    editor.children = [
      {
        type: 'paragraph',
        children: [
          {
            type: 'mention',
            agentId: 'agent-1',
            name: 'Employee One',
            resourceType: 'DIG_EMPLOYEE',
            children: [{ text: '' }],
          },
          invalidResource,
          { text: '你好' },
        ],
      },
    ] as any;
    editor.selection = { anchor: { path: [0, 2], offset: 0 }, focus: { path: [0, 2], offset: 0 } };

    editor.deleteBackward('character');

    const children = (editor.children[0] as any).children;
    expect(children.some((node: any) => node.type === 'resource')).toBe(false);
    const followingTextIndex = children.findIndex((node: any) => node.text === '你好');
    expect(editor.selection).toEqual({
      anchor: { path: [0, followingTextIndex], offset: 0 },
      focus: { path: [0, followingTextIndex], offset: 0 },
    });
  });

  it('keeps the caret after preceding text when Delete removes an invalid resource', () => {
    const editor = withEditableNavigation(withMention(createEditor()));
    editor.children = [
      {
        type: 'paragraph',
        children: [{ text: '你好' }, invalidResource, { text: '继续' }],
      },
    ] as any;
    editor.selection = { anchor: { path: [0, 0], offset: 2 }, focus: { path: [0, 0], offset: 2 } };

    editor.deleteForward('character');

    expect(editor.children[0]).toMatchObject({ children: [{ text: '你好继续' }] });
    expect(editor.selection).toEqual({
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 2 },
    });
  });
});
