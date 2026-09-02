import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import FileChanges, { getDisplayPath, parseFileChanges } from './index';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, number>) => {
      const messages: Record<string, string> = {
        'fileChanges.ariaLabel': 'File changes',
        'fileChanges.title': `Edited ${values?.count} files`,
        'fileChanges.collapse': 'Collapse',
        'fileChanges.showMore': `Show ${values?.count} more files`,
      };
      return messages[id];
    },
  }),
}));

const payload = {
  type: 'file_changes',
  version: 2,
  sessionId: '11194452',
  summary: { total: 4, added: 1, modified: 2, deleted: 1 },
  files: [
    { uuid: '1', path: '/tmp/.sessions/11194452/README.md', changeType: 'added', additions: 8, deletions: 0 },
    { uuid: '2', path: '/tmp/.sessions/11194452/src/a.ts', changeType: 'modified', additions: 80, deletions: 37 },
    { uuid: '3', path: '/tmp/.sessions/11194452/src/b.ts', changeType: 'deleted', additions: 0, deletions: 9 },
    { uuid: '4', path: '/tmp/.sessions/11194452/src/c.ts', changeType: 'modified', additions: 28, deletions: 9 },
  ],
};

describe('FileChanges', () => {
  it('parses the SSE JSON string and normalizes the session-relative path', () => {
    expect(parseFileChanges(JSON.stringify(payload))?.files).toHaveLength(4);
    expect(getDisplayPath(payload.files[0].path, payload.sessionId)).toBe('README.md');
    expect(parseFileChanges('{invalid')).toBeNull();
  });

  it('renders totals and expands files beyond the first three', () => {
    render(<FileChanges messageListItemContent={{ substance: JSON.stringify(payload) }} />);

    expect(screen.getByText('Edited 4 files')).toBeInTheDocument();
    expect(screen.getByText('+116')).toBeInTheDocument();
    expect(screen.getByText('-55')).toBeInTheDocument();
    expect(screen.queryByText('src/c.ts')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Show 1 more files/ }));
    expect(screen.getByText('src/c.ts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Collapse/ })).toBeInTheDocument();
  });

  it('renders nothing for an invalid payload', () => {
    const { container } = render(<FileChanges messageListItemContent={{ substance: 'not-json' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
