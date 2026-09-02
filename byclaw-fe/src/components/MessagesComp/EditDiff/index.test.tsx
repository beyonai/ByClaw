import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import EditDiff, { parseEditDiff } from './index';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) =>
      ({
        'editDiff.title': '文件修改',
        'editDiff.phase.applied': '已应用',
        'common.copy': '复制',
      }[id] || id),
  }),
}));

const payload = {
  type: 'edit_diff',
  schemaVersion: 1,
  eventId: 'call-1',
  phase: 'applied',
  operation: 'edit',
  sessionId: '100',
  files: [
    {
      path: 'src/a.ts',
      absolutePath: '/workspace/src/a.ts',
      changeType: 'modified',
      oldText: 'const a = 1;',
      newText: 'const a = 2;',
      additions: 1,
      deletions: 1,
      binary: false,
    },
  ],
} as const;

describe('EditDiff', () => {
  it('parses the universal versioned event from object or JSON', () => {
    expect(parseEditDiff(payload)?.eventId).toBe('call-1');
    expect(parseEditDiff(JSON.stringify(payload))?.files).toHaveLength(1);
    expect(parseEditDiff({ ...payload, schemaVersion: 2 })).toBeNull();
  });

  it('renders a DSH-style inline Edit tool card with expandable diff details', () => {
    render(<EditDiff messageListItemContent={{ substance: payload }} />);
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('src/a.ts')).toBeInTheDocument();
    expect(screen.getByText('/workspace/src/a.ts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument();
    expect(screen.getByText('const a = 1;')).toBeInTheDocument();
    expect(screen.getByText('const a = 2;')).toBeInTheDocument();
    expect(screen.getByText('+1 −1 · 1 file')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '收起 Edit src/a.ts' }));
    expect(screen.queryByText('/workspace/src/a.ts')).not.toBeInTheDocument();
  });
});
