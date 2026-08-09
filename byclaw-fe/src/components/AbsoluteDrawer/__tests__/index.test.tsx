let mockDrawerType: unknown = 'skillGroupDetail';

jest.mock('antd', () => ({
  Drawer: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: { emit: jest.fn() } }),
}));

jest.mock('@/components/Resources/components/SkillGroupDetailDrawer', () => ({
  __esModule: true,
  default: () => <div data-testid="skill-group-detail-drawer" />,
}));

jest.mock('@/components/wisdomPen/MaterialIframe', () => () => null);
jest.mock('@/components/MessagesComp/Iframe/IframeRender', () => () => null);

jest.mock('../useEventEmitter', () => ({
  __esModule: true,
  default: () => ({
    drawerCfg: { title: 'Group' },
    drawerType: mockDrawerType,
    contentPayload: { groupId: '101' },
    driverOpen: jest.fn(),
  }),
}));

import React from 'react';
import { render, screen } from '@testing-library/react';
import AbsoluteDrawer from '..';

it('opens the skill group detail content for the EventEmitter drawer type', () => {
  render(<AbsoluteDrawer />);

  expect(screen.getByTestId('skill-group-detail-drawer')).toBeInTheDocument();
});

it('does not throw for a malformed EventEmitter drawer type payload', () => {
  mockDrawerType = { invalid: true };

  expect(() => render(<AbsoluteDrawer />)).not.toThrow();
  expect(screen.queryByTestId('skill-group-detail-drawer')).not.toBeInTheDocument();

  mockDrawerType = 'skillGroupDetail';
});
