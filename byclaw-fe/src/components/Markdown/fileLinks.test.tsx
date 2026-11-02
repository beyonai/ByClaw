import { render, screen } from '@testing-library/react';
import Markdown from './index';
import type { IMessage } from '@/typescript/message';

jest.mock('@/hooks/useGlobal', () => () => ({ sessionId: '101' }));
jest.mock('./hooks/useActions', () => () => {});
jest.mock('./jsonRenderer', () => () => null);
jest.mock('./katex/showdown-katex', () => () => []);
jest.mock('./aTag', () => ({ domNode, sessionId, messageId }: any) => (
  <span data-testid="file-link" data-session={sessionId} data-message={messageId}>
    {domNode.attribs.href}
  </span>
));

it('uses the message session instead of the active parent session for file links', () => {
  render(<Markdown text="[报告](report.txt)" msg={{ sessionId: '202', messageId: 'reply-202' } as IMessage} />);
  expect(screen.getByTestId('file-link')).toHaveAttribute('data-session', '202');
  expect(screen.getByTestId('file-link')).toHaveAttribute('data-message', 'reply-202');
});

it('uses the current session for legacy messages that lack a session ID', () => {
  render(<Markdown text="[报告](report.txt)" msg={{ msgId: 'legacy' } as IMessage} />);
  expect(screen.getByTestId('file-link')).toHaveAttribute('data-session', '101');
});

it('does not bind standalone Markdown to the active conversation', () => {
  render(<Markdown text="[报告](report.txt)" />);
  expect(screen.getByTestId('file-link')).not.toHaveAttribute('data-session');
});
