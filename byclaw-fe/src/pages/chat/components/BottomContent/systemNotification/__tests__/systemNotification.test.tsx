import React from 'react';
import { render, screen } from '@testing-library/react';

import NotificationComp from '../NotificationComp';
import VersionComp from '../VersionComp';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => {
      const messages: Record<string, string> = {
        'systemNotification.unnamedNotification': 'Unnamed notification',
        'systemNotification.priority.high': 'High',
        'systemNotification.versionNotice': 'Version notification',
      };
      return messages[id] || id;
    },
  }),
}));

describe('system notification i18n', () => {
  it('renders localized version notification fallback text and biz type label', () => {
    render(<VersionComp item={{ id: 'version-1', title: '', content: '', createTime: '', bizType: 2 } as any} />);

    expect(screen.getByText('Unnamed notification')).toBeInTheDocument();
    expect(screen.getByText('Version notification')).toBeInTheDocument();
  });

  it('renders localized notification fallback title and priority label', () => {
    render(
      <NotificationComp
        item={{
          id: 'notice-1',
          title: '',
          content: 'notice content',
          createTime: '',
          priority: 3,
        }}
      />
    );

    expect(screen.getByText('Unnamed notification')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });
});
